package com.clipsync.session;

import com.clipsync.common.DynamoDbSchemaConstants;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.*;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

import static com.clipsync.common.DynamoDbSchemaConstants.*;

public class DynamoDbSessionRepository implements SessionRepository {

    private final DynamoDbClient dynamoDb;
    private final String tableName;

    public DynamoDbSessionRepository(DynamoDbClient dynamoDb) {
        this(dynamoDb, REGISTRY_TABLE_NAME);
    }

    public DynamoDbSessionRepository(DynamoDbClient dynamoDb, String tableName) {
        this.dynamoDb = dynamoDb;
        this.tableName = tableName;
    }

    @Override
    public void save(Session session) {
        Map<String, AttributeValue> item = new HashMap<>();
        item.put(ATTR_PK, AttributeValue.builder().s(PK_SESSION_PREFIX + session.sessionId()).build());
        item.put(ATTR_SK, AttributeValue.builder().s(SK_METADATA).build());
        item.put(ATTR_SESSION_ID, AttributeValue.builder().s(session.sessionId()).build());
        item.put(ATTR_STORAGE_MODE, AttributeValue.builder().s(session.storageMode().name()).build());
        item.put(ATTR_RETENTION_DAYS, AttributeValue.builder().n(String.valueOf(session.retentionDays())).build());
        item.put(ATTR_KEY_EPOCH, AttributeValue.builder().n(String.valueOf(session.keyEpoch())).build());
        item.put(ATTR_STATUS, AttributeValue.builder().s(session.status().name()).build());
        item.put(ATTR_CREATED_AT, AttributeValue.builder().s(session.createdAt().toString()).build());
        if (session.ttl() > 0) {
            item.put(ATTR_TTL, AttributeValue.builder().n(String.valueOf(session.ttl())).build());
        }

        PutItemRequest request = PutItemRequest.builder()
            .tableName(tableName)
            .item(item)
            .build();

        dynamoDb.putItem(request);
    }

    @Override
    public Optional<Session> findById(String sessionId) {
        Map<String, AttributeValue> key = new HashMap<>();
        key.put(ATTR_PK, AttributeValue.builder().s(PK_SESSION_PREFIX + sessionId).build());
        key.put(ATTR_SK, AttributeValue.builder().s(SK_METADATA).build());

        GetItemRequest request = GetItemRequest.builder()
            .tableName(tableName)
            .key(key)
            .consistentRead(true)
            .build();

        GetItemResponse response = dynamoDb.getItem(request);
        if (!response.hasItem() || response.item().isEmpty()) {
            return Optional.empty();
        }

        return Optional.of(mapToSession(response.item()));
    }

    @Override
    public Session advanceKeyEpoch(String sessionId) {
        Map<String, AttributeValue> key = new HashMap<>();
        key.put(ATTR_PK, AttributeValue.builder().s(PK_SESSION_PREFIX + sessionId).build());
        key.put(ATTR_SK, AttributeValue.builder().s(SK_METADATA).build());

        UpdateItemRequest request = UpdateItemRequest.builder()
            .tableName(tableName)
            .key(key)
            .updateExpression("ADD " + ATTR_KEY_EPOCH + " :one")
            .expressionAttributeValues(Map.of(":one", AttributeValue.builder().n("1").build()))
            .returnValues(ReturnValue.ALL_NEW)
            .build();

        UpdateItemResponse response = dynamoDb.updateItem(request);
        return mapToSession(response.attributes());
    }

    @Override
    public void updateStatus(String sessionId, SessionStatus status) {
        Map<String, AttributeValue> key = new HashMap<>();
        key.put(ATTR_PK, AttributeValue.builder().s(PK_SESSION_PREFIX + sessionId).build());
        key.put(ATTR_SK, AttributeValue.builder().s(SK_METADATA).build());

        UpdateItemRequest request = UpdateItemRequest.builder()
            .tableName(tableName)
            .key(key)
            .updateExpression("SET #st = :status")
            .expressionAttributeNames(Map.of("#st", ATTR_STATUS))
            .expressionAttributeValues(Map.of(":status", AttributeValue.builder().s(status.name()).build()))
            .build();

        dynamoDb.updateItem(request);
    }

    @Override
    public void delete(String sessionId) {
        Map<String, AttributeValue> key = new HashMap<>();
        key.put(ATTR_PK, AttributeValue.builder().s(PK_SESSION_PREFIX + sessionId).build());
        key.put(ATTR_SK, AttributeValue.builder().s(SK_METADATA).build());

        DeleteItemRequest request = DeleteItemRequest.builder()
            .tableName(tableName)
            .key(key)
            .build();

        dynamoDb.deleteItem(request);
    }

    private Session mapToSession(Map<String, AttributeValue> item) {
        String sessionId = item.get(ATTR_SESSION_ID).s();
        StorageMode mode = StorageMode.valueOf(item.get(ATTR_STORAGE_MODE).s());
        int retention = Integer.parseInt(item.get(ATTR_RETENTION_DAYS).n());
        int epoch = Integer.parseInt(item.get(ATTR_KEY_EPOCH).n());
        SessionStatus status = SessionStatus.valueOf(item.get(ATTR_STATUS).s());
        Instant createdAt = Instant.parse(item.get(ATTR_CREATED_AT).s());
        long ttl = item.containsKey(ATTR_TTL) ? Long.parseLong(item.get(ATTR_TTL).n()) : 0L;

        return new Session(sessionId, mode, retention, epoch, status, createdAt, ttl);
    }
}
