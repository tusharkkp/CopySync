package com.clipsync.device;

import com.clipsync.common.DynamoDbSchemaConstants;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.*;

import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

import static com.clipsync.common.DynamoDbSchemaConstants.*;

public class DynamoDbDeviceRepository implements DeviceRepository {

    private final DynamoDbClient dynamoDb;
    private final String tableName;

    public DynamoDbDeviceRepository(DynamoDbClient dynamoDb) {
        this(dynamoDb, REGISTRY_TABLE_NAME);
    }

    public DynamoDbDeviceRepository(DynamoDbClient dynamoDb, String tableName) {
        this.dynamoDb = dynamoDb;
        this.tableName = tableName;
    }

    @Override
    public void save(Device device) {
        Map<String, AttributeValue> item = new HashMap<>();
        item.put(ATTR_PK, AttributeValue.builder().s(PK_SESSION_PREFIX + device.sessionId()).build());
        item.put(ATTR_SK, AttributeValue.builder().s(SK_DEVICE_PREFIX + device.deviceId()).build());
        item.put(ATTR_SESSION_ID, AttributeValue.builder().s(device.sessionId()).build());
        item.put(ATTR_DEVICE_ID, AttributeValue.builder().s(device.deviceId()).build());
        item.put(ATTR_PUBLIC_SIGNING_KEY, AttributeValue.builder().s(device.publicSigningKeyB64()).build());
        item.put(ATTR_PUBLIC_HPKE_KEY, AttributeValue.builder().s(device.publicHpkeKeyB64()).build());
        item.put(ATTR_DEVICE_ROLE, AttributeValue.builder().s(device.role().name()).build());
        item.put(ATTR_STATUS, AttributeValue.builder().s(device.status().name()).build());
        item.put(ATTR_JOINED_AT, AttributeValue.builder().s(device.joinedAt().toString()).build());

        PutItemRequest request = PutItemRequest.builder()
            .tableName(tableName)
            .item(item)
            .build();

        dynamoDb.putItem(request);
    }

    @Override
    public Optional<Device> findBySessionAndDeviceId(String sessionId, String deviceId) {
        Map<String, AttributeValue> key = new HashMap<>();
        key.put(ATTR_PK, AttributeValue.builder().s(PK_SESSION_PREFIX + sessionId).build());
        key.put(ATTR_SK, AttributeValue.builder().s(SK_DEVICE_PREFIX + deviceId).build());

        GetItemRequest request = GetItemRequest.builder()
            .tableName(tableName)
            .key(key)
            .consistentRead(true)
            .build();

        GetItemResponse response = dynamoDb.getItem(request);
        if (!response.hasItem() || response.item().isEmpty()) {
            return Optional.empty();
        }

        return Optional.of(mapToDevice(response.item()));
    }

    @Override
    public List<Device> findActiveDevices(String sessionId) {
        QueryRequest request = QueryRequest.builder()
            .tableName(tableName)
            .keyConditionExpression(ATTR_PK + " = :pk AND begins_with(" + ATTR_SK + ", :skPrefix)")
            .filterExpression("#st = :active")
            .expressionAttributeNames(Map.of("#st", ATTR_STATUS))
            .expressionAttributeValues(Map.of(
                ":pk", AttributeValue.builder().s(PK_SESSION_PREFIX + sessionId).build(),
                ":skPrefix", AttributeValue.builder().s(SK_DEVICE_PREFIX).build(),
                ":active", AttributeValue.builder().s(DeviceStatus.ACTIVE.name()).build()
            ))
            .consistentRead(true)
            .build();

        QueryResponse response = dynamoDb.query(request);
        return response.items().stream()
            .map(this::mapToDevice)
            .collect(Collectors.toList());
    }

    @Override
    public void revokeDevice(String sessionId, String deviceId) {
        Map<String, AttributeValue> key = new HashMap<>();
        key.put(ATTR_PK, AttributeValue.builder().s(PK_SESSION_PREFIX + sessionId).build());
        key.put(ATTR_SK, AttributeValue.builder().s(SK_DEVICE_PREFIX + deviceId).build());

        UpdateItemRequest request = UpdateItemRequest.builder()
            .tableName(tableName)
            .key(key)
            .updateExpression("SET #st = :revoked")
            .expressionAttributeNames(Map.of("#st", ATTR_STATUS))
            .expressionAttributeValues(Map.of(":revoked", AttributeValue.builder().s(DeviceStatus.REVOKED.name()).build()))
            .build();

        dynamoDb.updateItem(request);
    }

    @Override
    public void deleteAllForSession(String sessionId) {
        QueryRequest query = QueryRequest.builder()
            .tableName(tableName)
            .keyConditionExpression(ATTR_PK + " = :pk AND begins_with(" + ATTR_SK + ", :skPrefix)")
            .expressionAttributeValues(Map.of(
                ":pk", AttributeValue.builder().s(PK_SESSION_PREFIX + sessionId).build(),
                ":skPrefix", AttributeValue.builder().s(SK_DEVICE_PREFIX).build()
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

    private Device mapToDevice(Map<String, AttributeValue> item) {
        return new Device(
            item.get(ATTR_DEVICE_ID).s(),
            item.get(ATTR_SESSION_ID).s(),
            item.get(ATTR_PUBLIC_SIGNING_KEY).s(),
            item.get(ATTR_PUBLIC_HPKE_KEY).s(),
            DeviceRole.valueOf(item.get(ATTR_DEVICE_ROLE).s()),
            DeviceStatus.valueOf(item.get(ATTR_STATUS).s()),
            Instant.parse(item.get(ATTR_JOINED_AT).s())
        );
    }
}
