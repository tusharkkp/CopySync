package com.clipsync.discovery;

import com.clipsync.common.DynamoDbSchemaConstants;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.*;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

import static com.clipsync.common.DynamoDbSchemaConstants.*;

public class DynamoDbIpDiscoveryRepository implements IpDiscoveryRepository {

    private final DynamoDbClient dynamoDb;
    private final String tableName;

    public DynamoDbIpDiscoveryRepository(DynamoDbClient dynamoDb) {
        this(dynamoDb, REGISTRY_TABLE_NAME);
    }

    public DynamoDbIpDiscoveryRepository(DynamoDbClient dynamoDb, String tableName) {
        this.dynamoDb = dynamoDb;
        this.tableName = tableName;
    }

    @Override
    public void save(IpDiscoveryRecord record) {
        Map<String, AttributeValue> item = new HashMap<>();
        item.put(ATTR_PK, AttributeValue.builder().s(record.ipHash()).build());
        item.put(ATTR_SK, AttributeValue.builder().s(SK_IP_DISCOVERY).build());
        item.put(ATTR_SESSION_ID, AttributeValue.builder().s(record.sessionId()).build());
        item.put(ATTR_DEVICE_ID, AttributeValue.builder().s(record.hostDeviceId()).build());
        if (record.hostDeviceName() != null) {
            item.put(ATTR_DEVICE_NAME, AttributeValue.builder().s(record.hostDeviceName()).build());
        }
        if (record.publicSigningKeyB64() != null) {
            item.put(ATTR_PUBLIC_SIGNING_KEY, AttributeValue.builder().s(record.publicSigningKeyB64()).build());
        }
        if (record.publicHpkeKeyB64() != null) {
            item.put(ATTR_PUBLIC_HPKE_KEY, AttributeValue.builder().s(record.publicHpkeKeyB64()).build());
        }
        if (record.autoPairingToken() != null) {
            item.put(ATTR_AUTO_PAIRING_TOKEN, AttributeValue.builder().s(record.autoPairingToken()).build());
        }
        item.put(ATTR_EXPIRES_AT, AttributeValue.builder().s(record.expiresAt().toString()).build());
        if (record.ttl() > 0) {
            item.put(ATTR_TTL, AttributeValue.builder().n(String.valueOf(record.ttl())).build());
        }

        PutItemRequest request = PutItemRequest.builder()
            .tableName(tableName)
            .item(item)
            .build();

        dynamoDb.putItem(request);
    }

    @Override
    public Optional<IpDiscoveryRecord> findByIpHash(String ipHash) {
        GetItemRequest request = GetItemRequest.builder()
            .tableName(tableName)
            .key(Map.of(
                ATTR_PK, AttributeValue.builder().s(ipHash).build(),
                ATTR_SK, AttributeValue.builder().s(SK_IP_DISCOVERY).build()
            ))
            .consistentRead(true)
            .build();

        GetItemResponse response = dynamoDb.getItem(request);
        if (!response.hasItem() || response.item().isEmpty()) {
            return Optional.empty();
        }

        Map<String, AttributeValue> item = response.item();
        Instant expiresAt = Instant.parse(item.get(ATTR_EXPIRES_AT).s());
        if (Instant.now().isAfter(expiresAt)) {
            return Optional.empty();
        }

        long ttl = item.containsKey(ATTR_TTL) ? Long.parseLong(item.get(ATTR_TTL).n()) : 0L;
        String deviceName = item.containsKey(ATTR_DEVICE_NAME) ? item.get(ATTR_DEVICE_NAME).s() : "Nearby Device";
        String signingKey = item.containsKey(ATTR_PUBLIC_SIGNING_KEY) ? item.get(ATTR_PUBLIC_SIGNING_KEY).s() : null;
        String hpkeKey = item.containsKey(ATTR_PUBLIC_HPKE_KEY) ? item.get(ATTR_PUBLIC_HPKE_KEY).s() : null;
        String autoToken = item.containsKey(ATTR_AUTO_PAIRING_TOKEN) ? item.get(ATTR_AUTO_PAIRING_TOKEN).s() : null;

        return Optional.of(new IpDiscoveryRecord(
            item.get(ATTR_PK).s(),
            item.get(ATTR_SESSION_ID).s(),
            item.get(ATTR_DEVICE_ID).s(),
            deviceName,
            signingKey,
            hpkeKey,
            autoToken,
            expiresAt,
            ttl
        ));
    }

    @Override
    public void delete(String ipHash) {
        DeleteItemRequest request = DeleteItemRequest.builder()
            .tableName(tableName)
            .key(Map.of(
                ATTR_PK, AttributeValue.builder().s(ipHash).build(),
                ATTR_SK, AttributeValue.builder().s(SK_IP_DISCOVERY).build()
            ))
            .build();

        dynamoDb.deleteItem(request);
    }
}
