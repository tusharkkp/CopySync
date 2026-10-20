package com.clipsync.pairing;

import com.clipsync.common.DynamoDbSchemaConstants;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.*;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

import static com.clipsync.common.DynamoDbSchemaConstants.*;

public class DynamoDbPairingRepository implements PairingRepository {

    private final DynamoDbClient dynamoDb;
    private final String tableName;

    public DynamoDbPairingRepository(DynamoDbClient dynamoDb) {
        this(dynamoDb, REGISTRY_TABLE_NAME);
    }

    public DynamoDbPairingRepository(DynamoDbClient dynamoDb, String tableName) {
        this.dynamoDb = dynamoDb;
        this.tableName = tableName;
    }

    @Override
    public void save(PairingToken token) {
        Map<String, AttributeValue> item = new HashMap<>();
        item.put(ATTR_PK, AttributeValue.builder().s(PK_SESSION_PREFIX + token.sessionId()).build());
        item.put(ATTR_SK, AttributeValue.builder().s(SK_PAIRING_PREFIX + token.tokenHash()).build());
        item.put(ATTR_SESSION_ID, AttributeValue.builder().s(token.sessionId()).build());
        item.put(ATTR_TOKEN_HASH, AttributeValue.builder().s(token.tokenHash()).build());
        item.put(ATTR_INITIATOR_DEVICE_ID, AttributeValue.builder().s(token.initiatorDeviceId()).build());
        item.put(ATTR_EXPIRES_AT, AttributeValue.builder().s(token.expiresAt().toString()).build());
        item.put(ATTR_ATTEMPT_COUNT, AttributeValue.builder().n(String.valueOf(token.attemptCount())).build());
        item.put(ATTR_CONSUMED, AttributeValue.builder().bool(token.consumed()).build());
        if (token.ttl() > 0) {
            item.put(ATTR_TTL, AttributeValue.builder().n(String.valueOf(token.ttl())).build());
        }

        PutItemRequest request = PutItemRequest.builder()
            .tableName(tableName)
            .item(item)
            .build();

        dynamoDb.putItem(request);
    }

    @Override
    public Optional<PairingToken> findBySessionId(String sessionId) {
        QueryRequest request = QueryRequest.builder()
            .tableName(tableName)
            .keyConditionExpression(ATTR_PK + " = :pk AND begins_with(" + ATTR_SK + ", :skPrefix)")
            .expressionAttributeValues(Map.of(
                ":pk", AttributeValue.builder().s(PK_SESSION_PREFIX + sessionId).build(),
                ":skPrefix", AttributeValue.builder().s(SK_PAIRING_PREFIX).build()
            ))
            .consistentRead(true)
            .limit(1)
            .build();

        QueryResponse response = dynamoDb.query(request);
        if (!response.hasItems() || response.items().isEmpty()) {
            return Optional.empty();
        }

        return Optional.of(mapToPairingToken(response.items().getFirst()));
    }

    @Override
    public boolean consumeIfValid(String sessionId, String tokenHash) {
        Map<String, AttributeValue> key = Map.of(
            ATTR_PK, AttributeValue.builder().s(PK_SESSION_PREFIX + sessionId).build(),
            ATTR_SK, AttributeValue.builder().s(SK_PAIRING_PREFIX + tokenHash).build()
        );

        UpdateItemRequest request = UpdateItemRequest.builder()
            .tableName(tableName)
            .key(key)
            .updateExpression("SET #c = :trueVal")
            .conditionExpression("attribute_exists(" + ATTR_PK + ") AND #c = :falseVal AND #a < :maxAttempts")
            .expressionAttributeNames(Map.of(
                "#c", ATTR_CONSUMED,
                "#a", ATTR_ATTEMPT_COUNT
            ))
            .expressionAttributeValues(Map.of(
                ":trueVal", AttributeValue.builder().bool(true).build(),
                ":falseVal", AttributeValue.builder().bool(false).build(),
                ":maxAttempts", AttributeValue.builder().n(String.valueOf(PairingToken.MAX_ATTEMPTS)).build()
            ))
            .build();

        try {
            dynamoDb.updateItem(request);
            return true;
        } catch (ConditionalCheckFailedException e) {
            return false;
        }
    }

    @Override
    public int recordFailedAttempt(String sessionId) {
        Optional<PairingToken> current = findBySessionId(sessionId);
        if (current.isEmpty()) {
            return 0;
        }

        Map<String, AttributeValue> key = Map.of(
            ATTR_PK, AttributeValue.builder().s(PK_SESSION_PREFIX + sessionId).build(),
            ATTR_SK, AttributeValue.builder().s(SK_PAIRING_PREFIX + current.get().tokenHash()).build()
        );

        UpdateItemRequest request = UpdateItemRequest.builder()
            .tableName(tableName)
            .key(key)
            .updateExpression("ADD #a :one")
            .expressionAttributeNames(Map.of("#a", ATTR_ATTEMPT_COUNT))
            .expressionAttributeValues(Map.of(":one", AttributeValue.builder().n("1").build()))
            .returnValues(ReturnValue.ALL_NEW)
            .build();

        UpdateItemResponse response = dynamoDb.updateItem(request);
        return Integer.parseInt(response.attributes().get(ATTR_ATTEMPT_COUNT).n());
    }

    @Override
    public void delete(String sessionId) {
        Optional<PairingToken> current = findBySessionId(sessionId);
        if (current.isEmpty()) {
            return;
        }

        Map<String, AttributeValue> key = Map.of(
            ATTR_PK, AttributeValue.builder().s(PK_SESSION_PREFIX + sessionId).build(),
            ATTR_SK, AttributeValue.builder().s(SK_PAIRING_PREFIX + current.get().tokenHash()).build()
        );

        dynamoDb.deleteItem(DeleteItemRequest.builder().tableName(tableName).key(key).build());
    }

    private PairingToken mapToPairingToken(Map<String, AttributeValue> item) {
        return new PairingToken(
            item.get(ATTR_SESSION_ID).s(),
            item.get(ATTR_TOKEN_HASH).s(),
            item.get(ATTR_INITIATOR_DEVICE_ID).s(),
            Instant.parse(item.get(ATTR_EXPIRES_AT).s()),
            Integer.parseInt(item.get(ATTR_ATTEMPT_COUNT).n()),
            item.get(ATTR_CONSUMED).bool(),
            item.containsKey(ATTR_TTL) ? Long.parseLong(item.get(ATTR_TTL).n()) : 0L
        );
    }
}
