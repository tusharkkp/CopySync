package com.clipsync.storage;

import com.clipsync.common.DynamoDbSchemaConstants;
import com.clipsync.session.Session;
import com.clipsync.session.StorageMode;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.*;

import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

import static com.clipsync.common.DynamoDbSchemaConstants.*;

public class DynamoDbClipboardRepository implements ClipboardRepository {

    private final DynamoDbClient dynamoDb;
    private final String tableName;

    public DynamoDbClipboardRepository(DynamoDbClient dynamoDb) {
        this(dynamoDb, CLIPBOARD_TABLE_NAME);
    }

    public DynamoDbClipboardRepository(DynamoDbClient dynamoDb, String tableName) {
        this.dynamoDb = dynamoDb;
        this.tableName = tableName;
    }

    @Override
    public void save(Session session, ClipboardSnapshot snapshot) {
        if (session.storageMode() == StorageMode.EPHEMERAL) {
            // Ephemeral snapshots are never written to DynamoDB
            return;
        }

        // Zero-pad logical clock to 19 digits for deterministic lexicographical sort
        String paddedClock = String.format("%019d", snapshot.logicalClock());
        String sk = SK_ITEM_PREFIX + paddedClock + "#" + snapshot.messageId();

        Map<String, AttributeValue> item = new HashMap<>();
        item.put(ATTR_PK, AttributeValue.builder().s(PK_SESSION_PREFIX + session.sessionId()).build());
        item.put(ATTR_SK, AttributeValue.builder().s(sk).build());
        item.put(ATTR_SESSION_ID, AttributeValue.builder().s(session.sessionId()).build());
        item.put(ATTR_MESSAGE_ID, AttributeValue.builder().s(snapshot.messageId()).build());
        item.put(ATTR_SENDER_DEVICE_ID, AttributeValue.builder().s(snapshot.senderDeviceId()).build());
        item.put(ATTR_LOGICAL_CLOCK, AttributeValue.builder().n(String.valueOf(snapshot.logicalClock())).build());
        item.put(ATTR_BASE_REVISION_ID, AttributeValue.builder().s(snapshot.baseRevisionId()).build());
        item.put(ATTR_KEY_EPOCH, AttributeValue.builder().n(String.valueOf(snapshot.keyEpoch())).build());
        item.put(ATTR_CONTENT_TYPE, AttributeValue.builder().s(snapshot.contentType()).build());
        item.put(ATTR_PLAINTEXT_BYTES, AttributeValue.builder().n(String.valueOf(snapshot.plaintextBytes())).build());
        item.put(ATTR_PAYLOAD_CIPHERTEXT, AttributeValue.builder().s(snapshot.payloadCiphertext()).build());
        item.put(ATTR_PAYLOAD_NONCE, AttributeValue.builder().s(snapshot.payloadNonce()).build());
        item.put(ATTR_SNAPSHOT_SIGNATURE, AttributeValue.builder().s(snapshot.snapshotSignature()).build());
        item.put(ATTR_KEY_ENVELOPES_JSON, AttributeValue.builder().s(snapshot.keyEnvelopesJson()).build());
        item.put(ATTR_CREATED_AT, AttributeValue.builder().s(snapshot.createdAt().toString()).build());

        if (snapshot.expiresAt() != null) {
            item.put(ATTR_EXPIRES_AT, AttributeValue.builder().s(snapshot.expiresAt().toString()).build());
        }
        if (snapshot.ttl() > 0) {
            item.put(ATTR_TTL, AttributeValue.builder().n(String.valueOf(snapshot.ttl())).build());
        }

        PutItemRequest request = PutItemRequest.builder()
            .tableName(tableName)
            .item(item)
            .build();

        dynamoDb.putItem(request);
    }

    @Override
    public Optional<ClipboardSnapshot> findLatest(Session session) {
        if (session.storageMode() == StorageMode.EPHEMERAL) {
            return Optional.empty();
        }

        QueryRequest request = QueryRequest.builder()
            .tableName(tableName)
            .keyConditionExpression(ATTR_PK + " = :pk AND begins_with(" + ATTR_SK + ", :skPrefix)")
            .expressionAttributeValues(Map.of(
                ":pk", AttributeValue.builder().s(PK_SESSION_PREFIX + session.sessionId()).build(),
                ":skPrefix", AttributeValue.builder().s(SK_ITEM_PREFIX).build()
            ))
            .scanIndexForward(false) // Descending order (latest logicalClock first)
            .limit(1)
            .consistentRead(true)
            .build();

        QueryResponse response = dynamoDb.query(request);
        if (!response.hasItems() || response.items().isEmpty()) {
            return Optional.empty();
        }

        ClipboardSnapshot snapshot = mapToSnapshot(response.items().getFirst());

        // SEC-10: Strict read-time logical expiry suppression
        if (snapshot.isExpired()) {
            return Optional.empty();
        }

        return Optional.of(snapshot);
    }

    @Override
    public List<ClipboardSnapshot> listRevisions(Session session) {
        if (session.storageMode() == StorageMode.EPHEMERAL) {
            return Collections.emptyList();
        }

        QueryRequest request = QueryRequest.builder()
            .tableName(tableName)
            .keyConditionExpression(ATTR_PK + " = :pk AND begins_with(" + ATTR_SK + ", :skPrefix)")
            .expressionAttributeValues(Map.of(
                ":pk", AttributeValue.builder().s(PK_SESSION_PREFIX + session.sessionId()).build(),
                ":skPrefix", AttributeValue.builder().s(SK_ITEM_PREFIX).build()
            ))
            .scanIndexForward(true)
            .consistentRead(true)
            .build();

        QueryResponse response = dynamoDb.query(request);
        return response.items().stream()
            .map(this::mapToSnapshot)
            .filter(s -> !s.isExpired()) // SEC-10: Suppress expired snapshots
            .collect(Collectors.toList());
    }

    @Override
    public void deleteAllForSession(String sessionId) {
        QueryRequest query = QueryRequest.builder()
            .tableName(tableName)
            .keyConditionExpression(ATTR_PK + " = :pk AND begins_with(" + ATTR_SK + ", :skPrefix)")
            .expressionAttributeValues(Map.of(
                ":pk", AttributeValue.builder().s(PK_SESSION_PREFIX + sessionId).build(),
                ":skPrefix", AttributeValue.builder().s(SK_ITEM_PREFIX).build()
            ))
            .build();

        QueryResponse response = dynamoDb.query(query);
        for (Map<String, AttributeValue> item : response.items()) {
            Map<String, AttributeValue> key = Map.of(
                ATTR_PK, item.get(ATTR_PK),
                ATTR_SK, item.get(ATTR_SK)
            );
            dynamoDb.deleteItem(DeleteItemRequest.builder().tableName(tableName).key(key).build());
        }
    }

    private ClipboardSnapshot mapToSnapshot(Map<String, AttributeValue> item) {
        return new ClipboardSnapshot(
            item.get(ATTR_SESSION_ID).s(),
            item.get(ATTR_MESSAGE_ID).s(),
            item.get(ATTR_SENDER_DEVICE_ID).s(),
            Long.parseLong(item.get(ATTR_LOGICAL_CLOCK).n()),
            item.get(ATTR_BASE_REVISION_ID).s(),
            Integer.parseInt(item.get(ATTR_KEY_EPOCH).n()),
            item.get(ATTR_CONTENT_TYPE).s(),
            Integer.parseInt(item.get(ATTR_PLAINTEXT_BYTES).n()),
            item.get(ATTR_PAYLOAD_CIPHERTEXT).s(),
            item.get(ATTR_PAYLOAD_NONCE).s(),
            item.get(ATTR_SNAPSHOT_SIGNATURE).s(),
            item.get(ATTR_KEY_ENVELOPES_JSON).s(),
            Instant.parse(item.get(ATTR_CREATED_AT).s()),
            item.containsKey(ATTR_EXPIRES_AT) ? Instant.parse(item.get(ATTR_EXPIRES_AT).s()) : null,
            item.containsKey(ATTR_TTL) ? Long.parseLong(item.get(ATTR_TTL).n()) : 0L
        );
    }
}
