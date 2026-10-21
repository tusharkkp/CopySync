package com.clipsync.transport;

import com.amazonaws.services.lambda.runtime.events.APIGatewayV2WebSocketEvent;
import com.amazonaws.services.lambda.runtime.events.APIGatewayV2WebSocketResponse;
import com.clipsync.connection.InMemoryConnectionRepository;
import com.clipsync.device.InMemoryDeviceRepository;
import com.clipsync.pairing.InMemoryPairingRepository;
import com.clipsync.pairing.PairingService;
import com.clipsync.session.InMemorySessionRepository;
import com.clipsync.session.Session;
import com.clipsync.session.StorageMode;
import com.clipsync.storage.InMemoryClipboardRepository;
import com.clipsync.transport.dto.WebSocketResponse;
import com.clipsync.transport.router.ClipSyncRouter;
import com.clipsync.transport.sender.InMemoryWebSocketSender;
import com.clipsync.transport.validation.FrameValidator;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

@DisplayName("TRANSPORT: WebSocket Route Dispatching & Broadcast Suite")
class ClipSyncRouterTest {

    private InMemorySessionRepository sessionRepo;
    private InMemoryDeviceRepository deviceRepo;
    private InMemoryConnectionRepository connectionRepo;
    private InMemoryPairingRepository pairingRepo;
    private InMemoryClipboardRepository clipboardRepo;
    private PairingService pairingService;
    private InMemoryWebSocketSender sender;
    private FrameValidator validator;
    private ObjectMapper objectMapper;
    private ClipSyncRouter router;

    @BeforeEach
    void setUp() {
        sessionRepo = new InMemorySessionRepository();
        deviceRepo = new InMemoryDeviceRepository();
        connectionRepo = new InMemoryConnectionRepository();
        pairingRepo = new InMemoryPairingRepository();
        clipboardRepo = new InMemoryClipboardRepository();
        pairingService = new PairingService(pairingRepo);
        sender = new InMemoryWebSocketSender();
        validator = new FrameValidator();
        objectMapper = new ObjectMapper();

        router = new ClipSyncRouter(
            sessionRepo,
            deviceRepo,
            connectionRepo,
            pairingService,
            clipboardRepo,
            sender,
            validator,
            objectMapper
        );
    }

    private APIGatewayV2WebSocketEvent createEvent(String routeKey, String connectionId, String body) {
        APIGatewayV2WebSocketEvent event = new APIGatewayV2WebSocketEvent();
        APIGatewayV2WebSocketEvent.RequestContext context = new APIGatewayV2WebSocketEvent.RequestContext();
        context.setRouteKey(routeKey);
        context.setConnectionId(connectionId);
        context.setDomainName("localhost");
        context.setStage("dev");
        event.setRequestContext(context);
        event.setBody(body);
        return event;
    }

    @Test
    @DisplayName("ROUTE: $connect registers connection mapping")
    void testConnect() {
        APIGatewayV2WebSocketEvent event = createEvent("$connect", "conn-001", null);
        APIGatewayV2WebSocketResponse response = router.handle(event);

        assertThat(response.getStatusCode()).isEqualTo(200);
        assertThat(connectionRepo.findByConnectionId("conn-001")).isPresent();
    }

    @Test
    @DisplayName("ROUTE: $disconnect prunes connection mapping")
    void testDisconnect() {
        // First connect
        router.handle(createEvent("$connect", "conn-002", null));
        assertThat(connectionRepo.findByConnectionId("conn-002")).isPresent();

        // Disconnect
        APIGatewayV2WebSocketResponse response = router.handle(createEvent("$disconnect", "conn-002", null));
        assertThat(response.getStatusCode()).isEqualTo(200);
        assertThat(connectionRepo.findByConnectionId("conn-002")).isEmpty();
    }

    @Test
    @DisplayName("ROUTE: session.create creates session, pairing code, and initiator device")
    void testSessionCreate() throws Exception {
        router.handle(createEvent("$connect", "conn-init", null));

        String body = """
            {
              "v": 1,
              "action": "session.create",
              "requestId": "req-c1",
              "sessionId": "sess-new-01",
              "deviceId": "dev-init",
              "publicSigningKeyB64": "sign-key-a",
              "publicHpkeKeyB64": "hpke-key-a",
              "storageMode": "TEMPORARY"
            }
            """;

        APIGatewayV2WebSocketResponse response = router.handle(createEvent("session.create", "conn-init", body));
        assertThat(response.getStatusCode()).isEqualTo(200);

        WebSocketResponse resp = objectMapper.readValue(response.getBody(), WebSocketResponse.class);
        assertThat(resp.status()).isEqualTo("OK");
        assertThat(resp.action()).isEqualTo("session.create");
        assertThat(resp.data()).isNotNull();
        assertThat(resp.data().get("pairingCode").asText()).hasSize(6);

        // Verify session and device in repositories
        assertThat(sessionRepo.findById("sess-new-01")).isPresent();
        assertThat(deviceRepo.findBySessionAndDeviceId("sess-new-01", "dev-init")).isPresent();
    }

    @Test
    @DisplayName("ROUTE: session.join verifies pairing code and notifies initiator")
    void testSessionJoin() throws Exception {
        // Initiator setup
        router.handle(createEvent("$connect", "conn-init", null));
        String createBody = """
            {
              "v": 1,
              "action": "session.create",
              "requestId": "req-c1",
              "sessionId": "sess-join-test",
              "deviceId": "dev-init",
              "publicSigningKeyB64": "sign-a",
              "publicHpkeKeyB64": "hpke-a",
              "storageMode": "TEMPORARY"
            }
            """;
        APIGatewayV2WebSocketResponse createResp = router.handle(createEvent("session.create", "conn-init", createBody));
        WebSocketResponse createData = objectMapper.readValue(createResp.getBody(), WebSocketResponse.class);
        String pairingCode = createData.data().get("pairingCode").asText();

        // Joiner connects
        router.handle(createEvent("$connect", "conn-joiner", null));
        String joinBody = """
            {
              "v": 1,
              "action": "session.join",
              "requestId": "req-j1",
              "sessionId": "sess-join-test",
              "deviceId": "dev-joiner",
              "pairingCode": "%s",
              "publicSigningKeyB64": "sign-b",
              "publicHpkeKeyB64": "hpke-b"
            }
            """.formatted(pairingCode);

        APIGatewayV2WebSocketResponse joinResp = router.handle(createEvent("session.join", "conn-joiner", joinBody));
        assertThat(joinResp.getStatusCode()).isEqualTo(200);

        WebSocketResponse joinData = objectMapper.readValue(joinResp.getBody(), WebSocketResponse.class);
        assertThat(joinData.status()).isEqualTo("OK");

        // Verify joiner device registered
        assertThat(deviceRepo.findBySessionAndDeviceId("sess-join-test", "dev-joiner")).isPresent();

        // Verify initiator received peer.joined notification
        assertThat(sender.getSentMessages("conn-init")).isNotEmpty();
        assertThat(sender.getSentMessages("conn-init").getFirst()).contains("peer.joined");
    }

    @Test
    @DisplayName("ROUTE: clipboard.update stores snapshot and broadcasts to peers")
    void testClipboardUpdateAndBroadcast() throws Exception {
        // Connect two devices in same session
        router.handle(createEvent("$connect", "conn-dev-a", null));
        router.handle(createEvent("$connect", "conn-dev-b", null));

        // Create session
        String createBody = """
            {
              "v": 1,
              "action": "session.create",
              "requestId": "req-c2",
              "sessionId": "sess-sync-01",
              "deviceId": "dev-a",
              "publicSigningKeyB64": "sign-a",
              "publicHpkeKeyB64": "hpke-a",
              "storageMode": "TEMPORARY"
            }
            """;
        APIGatewayV2WebSocketResponse cResp = router.handle(createEvent("session.create", "conn-dev-a", createBody));
        String code = objectMapper.readValue(cResp.getBody(), WebSocketResponse.class).data().get("pairingCode").asText();

        // Device B joins
        String joinBody = """
            {
              "v": 1,
              "action": "session.join",
              "requestId": "req-j2",
              "sessionId": "sess-sync-01",
              "deviceId": "dev-b",
              "pairingCode": "%s",
              "publicSigningKeyB64": "sign-b",
              "publicHpkeKeyB64": "hpke-b"
            }
            """.formatted(code);
        router.handle(createEvent("session.join", "conn-dev-b", joinBody));

        // Device A sends clipboard update
        String updateBody = """
            {
              "v": 1,
              "action": "clipboard.update",
              "requestId": "req-u1",
              "sessionId": "sess-sync-01",
              "deviceId": "dev-a",
              "header": {
                "sessionId": "sess-sync-01",
                "messageId": "msg-001",
                "senderDeviceId": "dev-a",
                "baseRevisionId": "msg-000",
                "logicalClock": 1,
                "keyEpoch": 1,
                "contentType": "text/plain;charset=utf-8",
                "plaintextBytes": 42
              },
              "payload": {
                "algorithm": "A256GCM",
                "nonce": "nonce123",
                "ciphertext": "cipher123"
              },
              "snapshotSignature": "sig123",
              "keyEnvelopes": []
            }
            """;

        APIGatewayV2WebSocketResponse updateResp = router.handle(createEvent("clipboard.update", "conn-dev-a", updateBody));
        assertThat(updateResp.getStatusCode()).isEqualTo(200);

        // Verify Device B received the broadcast update envelope
        assertThat(sender.getSentMessages("conn-dev-b")).isNotEmpty();
        String devBMsg = sender.getSentMessages("conn-dev-b").getFirst();
        assertThat(devBMsg).contains("clipboard.update");
        assertThat(devBMsg).contains("cipher123");

        // Verify Device A did NOT receive its own broadcast (no echo loop)
        long echoCount = sender.getSentMessages("conn-dev-a").stream()
            .filter(m -> m.contains("clipboard.update"))
            .count();
        assertThat(echoCount).isEqualTo(0);
    }

    @Test
    @DisplayName("ROUTE: session.create stores custom retentionDays for HISTORY mode")
    void testSessionCreateHistoryRetention() throws Exception {
        router.handle(createEvent("$connect", "conn-hist", null));

        String body = """
            {
              "v": 1,
              "action": "session.create",
              "requestId": "req-h1",
              "sessionId": "sess-hist-custom",
              "deviceId": "dev-hist",
              "publicSigningKeyB64": "sign-key-h",
              "publicHpkeKeyB64": "hpke-key-h",
              "storageMode": "HISTORY",
              "retentionDays": 14
            }
            """;

        APIGatewayV2WebSocketResponse response = router.handle(createEvent("session.create", "conn-hist", body));
        assertThat(response.getStatusCode()).isEqualTo(200);

        WebSocketResponse resp = objectMapper.readValue(response.getBody(), WebSocketResponse.class);
        assertThat(resp.status()).isEqualTo("OK");
        assertThat(resp.data().get("storageMode").asText()).isEqualTo("HISTORY");
        assertThat(resp.data().get("retentionDays").asInt()).isEqualTo(14);

        var sessionOpt = sessionRepo.findById("sess-hist-custom");
        assertThat(sessionOpt).isPresent();
        assertThat(sessionOpt.get().retentionDays()).isEqualTo(14);
    }

    @Test
    @DisplayName("ROUTE: sync.resume retrieves latest snapshot and revisions for HISTORY session")
    void testSyncResumeHistory() throws Exception {
        router.handle(createEvent("$connect", "conn-resume", null));

        // Create HISTORY session
        String createBody = """
            {
              "v": 1,
              "action": "session.create",
              "requestId": "req-c3",
              "sessionId": "sess-resume-01",
              "deviceId": "dev-res-1",
              "publicSigningKeyB64": "sign-1",
              "publicHpkeKeyB64": "hpke-1",
              "storageMode": "HISTORY",
              "retentionDays": 7
            }
            """;
        router.handle(createEvent("session.create", "conn-resume", createBody));

        // Add 2 clipboard updates
        String up1 = """
            {
              "v": 1,
              "action": "clipboard.update",
              "requestId": "req-u1",
              "sessionId": "sess-resume-01",
              "deviceId": "dev-res-1",
              "header": {"sessionId": "sess-resume-01", "messageId": "msg-001", "senderDeviceId": "dev-res-1", "baseRevisionId": "", "logicalClock": 1, "keyEpoch": 1, "contentType": "text/plain", "plaintextBytes": 5},
              "payload": {"algorithm": "A256GCM", "nonce": "n1", "ciphertext": "c1"},
              "snapshotSignature": "s1",
              "keyEnvelopes": []
            }
            """;
        router.handle(createEvent("clipboard.update", "conn-resume", up1));

        String up2 = """
            {
              "v": 1,
              "action": "clipboard.update",
              "requestId": "req-u2",
              "sessionId": "sess-resume-01",
              "deviceId": "dev-res-1",
              "header": {"sessionId": "sess-resume-01", "messageId": "msg-002", "senderDeviceId": "dev-res-1", "baseRevisionId": "msg-001", "logicalClock": 2, "keyEpoch": 1, "contentType": "text/plain", "plaintextBytes": 10},
              "payload": {"algorithm": "A256GCM", "nonce": "n2", "ciphertext": "c2"},
              "snapshotSignature": "s2",
              "keyEnvelopes": []
            }
            """;
        router.handle(createEvent("clipboard.update", "conn-resume", up2));

        // Call sync.resume
        String resumeBody = """
            {
              "v": 1,
              "action": "sync.resume",
              "requestId": "req-res-check",
              "sessionId": "sess-resume-01"
            }
            """;
        APIGatewayV2WebSocketResponse resumeResp = router.handle(createEvent("sync.resume", "conn-resume", resumeBody));
        assertThat(resumeResp.getStatusCode()).isEqualTo(200);

        WebSocketResponse resData = objectMapper.readValue(resumeResp.getBody(), WebSocketResponse.class);
        assertThat(resData.status()).isEqualTo("OK");
        assertThat(resData.data().get("storageMode").asText()).isEqualTo("HISTORY");
        assertThat(resData.data().get("retentionDays").asInt()).isEqualTo(7);
        assertThat(resData.data().get("latestSnapshot").get("messageId").asText()).isEqualTo("msg-002");
        assertThat(resData.data().get("revisions").size()).isEqualTo(2);
    }

    @Test
    @DisplayName("ROUTE: session.close purges all session data, devices, tokens, and connections")
    void testSessionClosePurgesAllData() throws Exception {
        router.handle(createEvent("$connect", "conn-close-test", null));

        // Create session
        String createBody = """
            {
              "v": 1,
              "action": "session.create",
              "requestId": "req-close-init",
              "sessionId": "sess-to-close",
              "deviceId": "dev-to-close",
              "publicSigningKeyB64": "sign-x",
              "publicHpkeKeyB64": "hpke-x",
              "storageMode": "TEMPORARY"
            }
            """;
        APIGatewayV2WebSocketResponse cResp = router.handle(createEvent("session.create", "conn-close-test", createBody));
        WebSocketResponse cData = objectMapper.readValue(cResp.getBody(), WebSocketResponse.class);
        String code = cData.data().get("pairingCode").asText();

        // Add a snapshot
        String up = """
            {
              "v": 1,
              "action": "clipboard.update",
              "requestId": "req-up",
              "sessionId": "sess-to-close",
              "deviceId": "dev-to-close",
              "header": {"sessionId": "sess-to-close", "messageId": "msg-001", "senderDeviceId": "dev-to-close", "baseRevisionId": "", "logicalClock": 1, "keyEpoch": 1, "contentType": "text/plain", "plaintextBytes": 5},
              "payload": {"algorithm": "A256GCM", "nonce": "n1", "ciphertext": "c1"},
              "snapshotSignature": "s1",
              "keyEnvelopes": []
            }
            """;
        router.handle(createEvent("clipboard.update", "conn-close-test", up));

        // Verify data exists prior to close
        assertThat(sessionRepo.findById("sess-to-close")).isPresent();
        assertThat(deviceRepo.findBySessionAndDeviceId("sess-to-close", "dev-to-close")).isPresent();
        assertThat(pairingRepo.findBySessionId("sess-to-close")).isPresent();

        // Close session
        String closeBody = """
            {
              "v": 1,
              "action": "session.close",
              "requestId": "req-close-exec",
              "sessionId": "sess-to-close"
            }
            """;
        APIGatewayV2WebSocketResponse closeResp = router.handle(createEvent("session.close", "conn-close-test", closeBody));
        assertThat(closeResp.getStatusCode()).isEqualTo(200);

        WebSocketResponse closeData = objectMapper.readValue(closeResp.getBody(), WebSocketResponse.class);
        assertThat(closeData.status()).isEqualTo("OK");
        assertThat(closeData.data().get("status").asText()).isEqualTo("CLOSED");

        // Verify full purge across repositories
        assertThat(sessionRepo.findById("sess-to-close")).isEmpty();
        assertThat(deviceRepo.findBySessionAndDeviceId("sess-to-close", "dev-to-close")).isEmpty();
        assertThat(pairingRepo.findBySessionId("sess-to-close")).isEmpty();
        assertThat(clipboardRepo.listRevisions(Session.createDefault("sess-to-close", StorageMode.TEMPORARY))).isEmpty();
    }

    @Test
    @DisplayName("ROUTE: device.revoke advances keyEpoch, disconnects target device, and broadcasts device.revoked")
    void testDeviceRevokeAdvancesKeyEpochAndBlocksRevokedDevice() throws Exception {
        // Connect initiator
        router.handle(createEvent("$connect", "conn-init-rev", null));
        String createBody = """
            {
              "v": 1,
              "action": "session.create",
              "requestId": "req-c1",
              "sessionId": "sess-rev-test",
              "deviceId": "dev-init-rev",
              "publicSigningKeyB64": "sig-init",
              "publicHpkeKeyB64": "hpke-init",
              "storageMode": "TEMPORARY"
            }
            """;
        APIGatewayV2WebSocketResponse createResp = router.handle(createEvent("session.create", "conn-init-rev", createBody));
        WebSocketResponse createData = objectMapper.readValue(createResp.getBody(), WebSocketResponse.class);
        String pairingCode = createData.data().get("pairingCode").asText();

        // Connect joiner
        router.handle(createEvent("$connect", "conn-joiner-rev", null));
        String joinBody = String.format("""
            {
              "v": 1,
              "action": "session.join",
              "requestId": "req-j1",
              "sessionId": "sess-rev-test",
              "pairingCode": "%s",
              "deviceId": "dev-joiner-rev",
              "publicSigningKeyB64": "sig-join",
              "publicHpkeKeyB64": "hpke-join"
            }
            """, pairingCode);
        router.handle(createEvent("session.join", "conn-joiner-rev", joinBody));

        // Both are active and connectionRepo has both
        assertThat(connectionRepo.findByConnectionId("conn-joiner-rev")).isPresent();
        assertThat(sessionRepo.findById("sess-rev-test").get().keyEpoch()).isEqualTo(1);

        // Initiator revokes joiner
        String revokeBody = """
            {
              "v": 1,
              "action": "device.revoke",
              "requestId": "req-rev-1",
              "sessionId": "sess-rev-test",
              "deviceId": "dev-init-rev",
              "targetDeviceId": "dev-joiner-rev"
            }
            """;
        APIGatewayV2WebSocketResponse revResp = router.handle(createEvent("device.revoke", "conn-init-rev", revokeBody));
        assertThat(revResp.getStatusCode()).isEqualTo(200);

        WebSocketResponse revData = objectMapper.readValue(revResp.getBody(), WebSocketResponse.class);
        assertThat(revData.data().get("status").asText()).isEqualTo("REVOKED");
        assertThat(revData.data().get("revokedDeviceId").asText()).isEqualTo("dev-joiner-rev");
        assertThat(revData.data().get("keyEpoch").asInt()).isEqualTo(2);

        // Session keyEpoch is now 2
        assertThat(sessionRepo.findById("sess-rev-test").get().keyEpoch()).isEqualTo(2);

        // Joiner status is REVOKED
        assertThat(deviceRepo.findBySessionAndDeviceId("sess-rev-test", "dev-joiner-rev").get().status())
            .isEqualTo(com.clipsync.device.DeviceStatus.REVOKED);

        // Joiner connection was pruned
        assertThat(connectionRepo.findByConnectionId("conn-joiner-rev")).isEmpty();

        // Verify broadcast device.revoked was sent
        assertThat(sender.getSentMessages("conn-init-rev")).anyMatch(msg -> msg.contains("device.revoked"));

        // Joiner attempts clipboard update -> rejected 403 DEVICE_REVOKED
        String joinerUpdate = """
            {
              "v": 1,
              "action": "clipboard.update",
              "requestId": "req-up-bad",
              "sessionId": "sess-rev-test",
              "deviceId": "dev-joiner-rev",
              "header": {"sessionId": "sess-rev-test", "messageId": "msg-002", "senderDeviceId": "dev-joiner-rev", "baseRevisionId": "", "logicalClock": 2, "keyEpoch": 2, "contentType": "text/plain", "plaintextBytes": 5},
              "payload": {"algorithm": "A256GCM", "nonce": "n2", "ciphertext": "c2"},
              "snapshotSignature": "s2",
              "keyEnvelopes": []
            }
            """;
        APIGatewayV2WebSocketResponse upResp = router.handle(createEvent("clipboard.update", "conn-joiner-rev", joinerUpdate));
        assertThat(upResp.getStatusCode()).isEqualTo(403);
        assertThat(upResp.getBody()).contains("DEVICE_REVOKED");

        // Initiator attempts update with stale keyEpoch 1 -> rejected 403 UNAUTHORIZED
        String staleEpochUpdate = """
            {
              "v": 1,
              "action": "clipboard.update",
              "requestId": "req-up-stale",
              "sessionId": "sess-rev-test",
              "deviceId": "dev-init-rev",
              "header": {"sessionId": "sess-rev-test", "messageId": "msg-003", "senderDeviceId": "dev-init-rev", "baseRevisionId": "", "logicalClock": 2, "keyEpoch": 1, "contentType": "text/plain", "plaintextBytes": 5},
              "payload": {"algorithm": "A256GCM", "nonce": "n3", "ciphertext": "c3"},
              "snapshotSignature": "s3",
              "keyEnvelopes": []
            }
            """;
        APIGatewayV2WebSocketResponse staleResp = router.handle(createEvent("clipboard.update", "conn-init-rev", staleEpochUpdate));
        assertThat(staleResp.getStatusCode()).isEqualTo(403);
        assertThat(staleResp.getBody()).contains("UNAUTHORIZED");

        // Joiner attempts sync.resume -> rejected 403 DEVICE_REVOKED
        String resumeBody = """
            {
              "v": 1,
              "action": "sync.resume",
              "requestId": "req-res-rev",
              "sessionId": "sess-rev-test",
              "deviceId": "dev-joiner-rev"
            }
            """;
        APIGatewayV2WebSocketResponse resResp = router.handle(createEvent("sync.resume", "conn-joiner-rev", resumeBody));
        assertThat(resResp.getStatusCode()).isEqualTo(403);
        assertThat(resResp.getBody()).contains("DEVICE_REVOKED");
    }
}
