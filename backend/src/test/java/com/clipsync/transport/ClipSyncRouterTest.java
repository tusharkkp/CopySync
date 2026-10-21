package com.clipsync.transport;

import com.amazonaws.services.lambda.runtime.events.APIGatewayV2WebSocketEvent;
import com.amazonaws.services.lambda.runtime.events.APIGatewayV2WebSocketResponse;
import com.clipsync.connection.InMemoryConnectionRepository;
import com.clipsync.device.InMemoryDeviceRepository;
import com.clipsync.pairing.InMemoryPairingRepository;
import com.clipsync.pairing.PairingService;
import com.clipsync.session.InMemorySessionRepository;
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
}
