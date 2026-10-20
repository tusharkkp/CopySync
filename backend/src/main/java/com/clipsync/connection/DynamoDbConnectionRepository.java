package com.clipsync.connection;

import com.clipsync.common.DynamoDbSchemaConstants;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.*;

import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

import static com.clipsync.common.DynamoDbSchemaConstants.*;

/**
 * DynamoDB Connection Repository implementing DEC-008.
 * Stores inverted connection mapping (PK=CONNECTION#cid, SK=SESSION#sid) to allow O(1)
 * lookups on $disconnect without requiring an expensive Global Secondary Index (GSI).
 */
public class DynamoDbConnectionRepository implements ConnectionRepository {

    private final DynamoDbClient dynamoDb;
    private final String tableName;

    public DynamoDbConnectionRepository(DynamoDbClient dynamoDb) {
        this(dynamoDb, REGISTRY_TABLE_NAME);
    }

    public DynamoDbConnectionRepository(DynamoDbClient dynamoDb, String tableName) {
        this.dynamoDb = dynamoDb;
        this.tableName = tableName;
    }

    @Override
    public void save(Connection connection) {
        // Item 1: Inverted mapping (for O(1) $disconnect & inbound lookup)
        Map<String, AttributeValue> invertedItem = new HashMap<>();
        invertedItem.put(ATTR_PK, AttributeValue.builder().s(PK_CONNECTION_PREFIX + connection.connectionId()).build());
        invertedItem.put(ATTR_SK, AttributeValue.builder().s(PK_SESSION_PREFIX + connection.sessionId()).build());
        populateAttributes(invertedItem, connection);

        // Item 2: Forward mapping (for session broadcast queries)
        Map<String, AttributeValue> forwardItem = new HashMap<>();
        forwardItem.put(ATTR_PK, AttributeValue.builder().s(PK_SESSION_PREFIX + connection.sessionId()).build());
        forwardItem.put(ATTR_SK, AttributeValue.builder().s(SK_CONNECTION_PREFIX + connection.connectionId()).build());
        populateAttributes(forwardItem, connection);

        dynamoDb.putItem(PutItemRequest.builder().tableName(tableName).item(invertedItem).build());
        dynamoDb.putItem(PutItemRequest.builder().tableName(tableName).item(forwardItem).build());
    }

    private void populateAttributes(Map<String, AttributeValue> item, Connection connection) {
        item.put(ATTR_CONNECTION_ID, AttributeValue.builder().s(connection.connectionId()).build());
        item.put(ATTR_SESSION_ID, AttributeValue.builder().s(connection.sessionId()).build());
        item.put(ATTR_DEVICE_ID, AttributeValue.builder().s(connection.deviceId()).build());
        item.put(ATTR_CONNECTED_AT, AttributeValue.builder().s(connection.connectedAt().toString()).build());
        if (connection.ttl() > 0) {
            item.put(ATTR_TTL, AttributeValue.builder().n(String.valueOf(connection.ttl())).build());
        }
    }

    @Override
    public Optional<Connection> findByConnectionId(String connectionId) {
        QueryRequest request = QueryRequest.builder()
            .tableName(tableName)
            .keyConditionExpression(ATTR_PK + " = :pk AND begins_with(" + ATTR_SK + ", :skPrefix)")
            .expressionAttributeValues(Map.of(
                ":pk", AttributeValue.builder().s(PK_CONNECTION_PREFIX + connectionId).build(),
                ":skPrefix", AttributeValue.builder().s(PK_SESSION_PREFIX).build()
            ))
            .consistentRead(true)
            .limit(1)
            .build();

        QueryResponse response = dynamoDb.query(request);
        if (!response.hasItems() || response.items().isEmpty()) {
            return Optional.empty();
        }

        return Optional.of(mapToConnection(response.items().getFirst()));
    }

    @Override
    public List<Connection> findActiveBySessionId(String sessionId) {
        QueryRequest request = QueryRequest.builder()
            .tableName(tableName)
            .keyConditionExpression(ATTR_PK + " = :pk AND begins_with(" + ATTR_SK + ", :skPrefix)")
            .expressionAttributeValues(Map.of(
                ":pk", AttributeValue.builder().s(PK_SESSION_PREFIX + sessionId).build(),
                ":skPrefix", AttributeValue.builder().s(SK_CONNECTION_PREFIX).build()
            ))
            .consistentRead(true)
            .build();

        QueryResponse response = dynamoDb.query(request);
        return response.items().stream()
            .map(this::mapToConnection)
            .collect(Collectors.toList());
    }

    @Override
    public void remove(String connectionId) {
        Optional<Connection> existing = findByConnectionId(connectionId);
        if (existing.isEmpty()) {
            return;
        }

        Connection conn = existing.get();

        // Delete Inverted mapping
        Map<String, AttributeValue> invertedKey = Map.of(
            ATTR_PK, AttributeValue.builder().s(PK_CONNECTION_PREFIX + conn.connectionId()).build(),
            ATTR_SK, AttributeValue.builder().s(PK_SESSION_PREFIX + conn.sessionId()).build()
        );
        dynamoDb.deleteItem(DeleteItemRequest.builder().tableName(tableName).key(invertedKey).build());

        // Delete Forward mapping
        Map<String, AttributeValue> forwardKey = Map.of(
            ATTR_PK, AttributeValue.builder().s(PK_SESSION_PREFIX + conn.sessionId()).build(),
            ATTR_SK, AttributeValue.builder().s(SK_CONNECTION_PREFIX + conn.connectionId()).build()
        );
        dynamoDb.deleteItem(DeleteItemRequest.builder().tableName(tableName).key(forwardKey).build());
    }

    private Connection mapToConnection(Map<String, AttributeValue> item) {
        return new Connection(
            item.get(ATTR_CONNECTION_ID).s(),
            item.get(ATTR_SESSION_ID).s(),
            item.get(ATTR_DEVICE_ID).s(),
            Instant.parse(item.get(ATTR_CONNECTED_AT).s()),
            item.containsKey(ATTR_TTL) ? Long.parseLong(item.get(ATTR_TTL).n()) : 0L
        );
    }
}
