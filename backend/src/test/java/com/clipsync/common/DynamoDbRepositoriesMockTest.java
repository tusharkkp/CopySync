package com.clipsync.common;

import com.clipsync.connection.Connection;
import com.clipsync.connection.DynamoDbConnectionRepository;
import com.clipsync.device.Device;
import com.clipsync.device.DeviceRole;
import com.clipsync.device.DeviceStatus;
import com.clipsync.device.DynamoDbDeviceRepository;
import com.clipsync.pairing.DynamoDbPairingRepository;
import com.clipsync.pairing.PairingToken;
import com.clipsync.session.DynamoDbSessionRepository;
import com.clipsync.session.Session;
import com.clipsync.session.SessionStatus;
import com.clipsync.session.StorageMode;
import com.clipsync.storage.ClipboardSnapshot;
import com.clipsync.storage.DynamoDbClipboardRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.*;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;

import static com.clipsync.common.DynamoDbSchemaConstants.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@DisplayName("UNIT: DynamoDB Adapter Attribute Mapping & Contract Tests")
class DynamoDbRepositoriesMockTest {

    private DynamoDbClient dynamoDb;

    @BeforeEach
    void setUp() {
        dynamoDb = mock(DynamoDbClient.class);
    }

    @Test
    @DisplayName("DDB-MAP-01: Session save & find item mapping")
    void testSessionItemMapping() {
        DynamoDbSessionRepository repo = new DynamoDbSessionRepository(dynamoDb);
        Session session = Session.createDefault("s1", StorageMode.TEMPORARY);

        repo.save(session);

        ArgumentCaptor<PutItemRequest> captor = ArgumentCaptor.forClass(PutItemRequest.class);
        verify(dynamoDb).putItem(captor.capture());
        Map<String, AttributeValue> item = captor.getValue().item();

        assertThat(item.get(ATTR_PK).s()).isEqualTo("SESSION#s1");
        assertThat(item.get(ATTR_SK).s()).isEqualTo("METADATA");
        assertThat(item.get(ATTR_STORAGE_MODE).s()).isEqualTo("TEMPORARY");
        assertThat(item.get(ATTR_KEY_EPOCH).n()).isEqualTo("1");

        // Mock getItem response
        GetItemResponse mockResp = GetItemResponse.builder().item(item).build();
        when(dynamoDb.getItem(any(GetItemRequest.class))).thenReturn(mockResp);

        Optional<Session> loaded = repo.findById("s1");
        assertThat(loaded).isPresent();
        assertThat(loaded.get().sessionId()).isEqualTo("s1");
    }

    @Test
    @DisplayName("DDB-MAP-02: DEC-008 Inverted connection mapping writes 2 items (forward & inverted)")
    void testConnectionDualItemWrites() {
        DynamoDbConnectionRepository repo = new DynamoDbConnectionRepository(dynamoDb);
        Connection conn = new Connection("c1", "s1", "d1", Instant.now(), 1000L);

        repo.save(conn);

        ArgumentCaptor<PutItemRequest> captor = ArgumentCaptor.forClass(PutItemRequest.class);
        verify(dynamoDb, times(2)).putItem(captor.capture());

        var items = captor.getAllValues().stream().map(PutItemRequest::item).toList();

        // One item has PK=CONNECTION#c1, SK=SESSION#s1
        boolean hasInverted = items.stream().anyMatch(i ->
            i.get(ATTR_PK).s().equals("CONNECTION#c1") && i.get(ATTR_SK).s().equals("SESSION#s1")
        );
        // One item has PK=SESSION#s1, SK=CONNECTION#c1
        boolean hasForward = items.stream().anyMatch(i ->
            i.get(ATTR_PK).s().equals("SESSION#s1") && i.get(ATTR_SK).s().equals("CONNECTION#c1")
        );

        assertThat(hasInverted).isTrue();
        assertThat(hasForward).isTrue();
    }

    @Test
    @DisplayName("DDB-MAP-03: Pairing single-use conditional update verification")
    void testPairingConditionalUpdate() {
        DynamoDbPairingRepository repo = new DynamoDbPairingRepository(dynamoDb);

        when(dynamoDb.updateItem(any(UpdateItemRequest.class))).thenReturn(UpdateItemResponse.builder().build());
        boolean success = repo.consumeIfValid("s1", "tokenhash123");
        assertThat(success).isTrue();

        ArgumentCaptor<UpdateItemRequest> captor = ArgumentCaptor.forClass(UpdateItemRequest.class);
        verify(dynamoDb).updateItem(captor.capture());
        UpdateItemRequest req = captor.getValue();

        assertThat(req.conditionExpression()).contains("#c = :falseVal");
        assertThat(req.key().get(ATTR_PK).s()).isEqualTo("SESSION#s1");
        assertThat(req.key().get(ATTR_SK).s()).isEqualTo("PAIRING#tokenhash123");

        // Simulate ConditionalCheckFailedException
        when(dynamoDb.updateItem(any(UpdateItemRequest.class))).thenThrow(ConditionalCheckFailedException.builder().build());
        boolean failed = repo.consumeIfValid("s1", "tokenhash123");
        assertThat(failed).isFalse();
    }

    @Test
    @DisplayName("DDB-MAP-04: Clipboard zero-padded logical clock formatting in SK")
    void testClipboardPaddedClock() {
        DynamoDbClipboardRepository repo = new DynamoDbClipboardRepository(dynamoDb);
        Session session = Session.createDefault("s1", StorageMode.TEMPORARY);

        ClipboardSnapshot snapshot = new ClipboardSnapshot(
            "s1", "m42", "dev-1", 42L, "m41", 1,
            "text/plain", 10, "cipher", "nonce", "sig", "[]",
            Instant.now(), Instant.now().plusSeconds(600), 0
        );

        repo.save(session, snapshot);

        ArgumentCaptor<PutItemRequest> captor = ArgumentCaptor.forClass(PutItemRequest.class);
        verify(dynamoDb).putItem(captor.capture());
        Map<String, AttributeValue> item = captor.getValue().item();

        assertThat(item.get(ATTR_PK).s()).isEqualTo("SESSION#s1");
        // Verify 19-digit padding: ITEM#0000000000000000042#m42
        assertThat(item.get(ATTR_SK).s()).isEqualTo("ITEM#0000000000000000042#m42");
    }

    @Test
    @DisplayName("DDB-MAP-05: Device registration & query mapping")
    void testDeviceMapping() {
        DynamoDbDeviceRepository repo = new DynamoDbDeviceRepository(dynamoDb);
        Device device = new Device("dev-1", "s1", "sign-key", "hpke-key", DeviceRole.INITIATOR, DeviceStatus.ACTIVE, Instant.now());

        repo.save(device);

        ArgumentCaptor<PutItemRequest> captor = ArgumentCaptor.forClass(PutItemRequest.class);
        verify(dynamoDb).putItem(captor.capture());
        Map<String, AttributeValue> item = captor.getValue().item();

        assertThat(item.get(ATTR_PK).s()).isEqualTo("SESSION#s1");
        assertThat(item.get(ATTR_SK).s()).isEqualTo("DEVICE#dev-1");
        assertThat(item.get(ATTR_PUBLIC_SIGNING_KEY).s()).isEqualTo("sign-key");
        assertThat(item.get(ATTR_PUBLIC_HPKE_KEY).s()).isEqualTo("hpke-key");
    }
}
