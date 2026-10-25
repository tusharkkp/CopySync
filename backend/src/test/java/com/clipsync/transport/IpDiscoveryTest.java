package com.clipsync.transport;

import com.amazonaws.services.lambda.runtime.events.APIGatewayV2WebSocketEvent;
import com.amazonaws.services.lambda.runtime.events.APIGatewayV2WebSocketResponse;
import com.clipsync.connection.InMemoryConnectionRepository;
import com.clipsync.device.InMemoryDeviceRepository;
import com.clipsync.discovery.InMemoryIpDiscoveryRepository;
import com.clipsync.pairing.InMemoryPairingRepository;
import com.clipsync.pairing.PairingService;
import com.clipsync.session.InMemorySessionRepository;
import com.clipsync.session.Session;
import com.clipsync.session.StorageMode;
import com.clipsync.storage.InMemoryClipboardRepository;
import com.clipsync.transport.router.ClipSyncRouter;
import com.clipsync.transport.sender.InMemoryWebSocketSender;
import com.clipsync.transport.validation.FrameValidator;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

@DisplayName("DISCOVERY: Same-IP Auto-Discovery & Zero-Code Pairing Suite")
class IpDiscoveryTest {

    private InMemorySessionRepository sessionRepo;
    private InMemoryDeviceRepository deviceRepo;
    private InMemoryConnectionRepository connectionRepo;
    private InMemoryPairingRepository pairingRepo;
    private InMemoryClipboardRepository clipboardRepo;
    private InMemoryIpDiscoveryRepository discoveryRepo;
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
        discoveryRepo = new InMemoryIpDiscoveryRepository();
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
            objectMapper,
            discoveryRepo
        );
    }

    private APIGatewayV2WebSocketEvent createEvent(String routeKey, String connId, String body, String sourceIp) {
        APIGatewayV2WebSocketEvent event = new APIGatewayV2WebSocketEvent();
        APIGatewayV2WebSocketEvent.RequestContext ctx = new APIGatewayV2WebSocketEvent.RequestContext();
        APIGatewayV2WebSocketEvent.RequestIdentity identity = new APIGatewayV2WebSocketEvent.RequestIdentity();
        identity.setSourceIp(sourceIp);
        ctx.setIdentity(identity);
        ctx.setRouteKey(routeKey);
        ctx.setConnectionId(connId);
        event.setRequestContext(ctx);
        event.setBody(body);
        return event;
    }

    @Test
    @DisplayName("Device A announces session on IP, Device B on same IP probes and finds it")
    void testSameIpDiscoveryAndAutoPair() throws Exception {
        // 1. Host creates session and registers initiator device
        sessionRepo.save(Session.create("sess-wifi-01", StorageMode.EPHEMERAL, 0));
        deviceRepo.save(new com.clipsync.device.Device(
            "dev-laptop-a",
            "sess-wifi-01",
            "key-signing-a",
            "key-hpke-a",
            com.clipsync.device.DeviceRole.INITIATOR,
            com.clipsync.device.DeviceStatus.ACTIVE,
            java.time.Instant.now()
        ));

        // 2. Host announces session on public IP 203.0.113.50
        String announceJson = """
            {
                "v": 1,
                "action": "ip.announce",
                "requestId": "req-ann-1",
                "sessionId": "sess-wifi-01",
                "deviceId": "dev-laptop-a",
                "deviceName": "MacBook Pro",
                "publicSigningKeyB64": "key-signing-a",
                "publicHpkeKeyB64": "key-hpke-a"
            }
            """;
        APIGatewayV2WebSocketEvent eventA = createEvent("$default", "conn-a", announceJson, "203.0.113.50");
        APIGatewayV2WebSocketResponse respA = router.handle(eventA);
        assertThat(respA.getStatusCode()).isEqualTo(200);

        JsonNode bodyNodeA = objectMapper.readTree(respA.getBody());
        assertThat(bodyNodeA.get("status").asText()).isEqualTo("OK");
        String autoToken = bodyNodeA.get("data").get("autoPairingToken").asText();
        assertThat(autoToken).startsWith("autotok-");

        // 3. Peer on SAME IP probes for active session
        String probeJson = """
            {
                "v": 1,
                "action": "ip.probe",
                "requestId": "req-prb-1",
                "deviceId": "dev-laptop-b"
            }
            """;
        APIGatewayV2WebSocketEvent eventB = createEvent("$default", "conn-b", probeJson, "203.0.113.50");
        APIGatewayV2WebSocketResponse respB = router.handle(eventB);
        assertThat(respB.getStatusCode()).isEqualTo(200);

        JsonNode bodyNodeB = objectMapper.readTree(respB.getBody());
        assertThat(bodyNodeB.get("data").get("found").asBoolean()).isTrue();
        assertThat(bodyNodeB.get("data").get("sessionId").asText()).isEqualTo("sess-wifi-01");
        assertThat(bodyNodeB.get("data").get("hostDeviceId").asText()).isEqualTo("dev-laptop-a");
        assertThat(bodyNodeB.get("data").get("hostDeviceName").asText()).isEqualTo("MacBook Pro");
        assertThat(bodyNodeB.get("data").get("autoPairingToken").asText()).isEqualTo(autoToken);

        // 4. Peer B auto-joins the session without manual code
        String joinAutoJson = """
            {
                "v": 1,
                "action": "session.join_auto",
                "requestId": "req-jauto-1",
                "sessionId": "sess-wifi-01",
                "deviceId": "dev-laptop-b",
                "deviceName": "ThinkPad",
                "autoPairingToken": "%s",
                "publicSigningKeyB64": "key-signing-b",
                "publicHpkeKeyB64": "key-hpke-b"
            }
            """.formatted(autoToken);

        APIGatewayV2WebSocketEvent eventBJoin = createEvent("$default", "conn-b", joinAutoJson, "203.0.113.50");
        APIGatewayV2WebSocketResponse respBJoin = router.handle(eventBJoin);
        assertThat(respBJoin.getStatusCode()).isEqualTo(200);

        JsonNode bodyNodeBJoin = objectMapper.readTree(respBJoin.getBody());
        assertThat(bodyNodeBJoin.get("status").asText()).isEqualTo("OK");
        assertThat(bodyNodeBJoin.get("data").get("status").asText()).isEqualTo("ACTIVE");

        // 5. Host A should have received peer.joined notification and both devices are active
        assertThat(deviceRepo.findActiveDevices("sess-wifi-01")).hasSize(2);
    }

    @Test
    @DisplayName("Device on DIFFERENT IP cannot discover or auto-join session")
    void testDifferentIpCannotDiscoverOrAutoJoin() throws Exception {
        sessionRepo.save(Session.create("sess-wifi-02", StorageMode.EPHEMERAL, 0));

        // Announce on IP 203.0.113.50
        String announceJson = """
            {
                "v": 1,
                "action": "ip.announce",
                "requestId": "req-ann-2",
                "sessionId": "sess-wifi-02",
                "deviceId": "dev-laptop-a",
                "publicSigningKeyB64": "key-signing-a",
                "publicHpkeKeyB64": "key-hpke-a"
            }
            """;
        APIGatewayV2WebSocketEvent eventA = createEvent("$default", "conn-a", announceJson, "203.0.113.50");
        APIGatewayV2WebSocketResponse respA = router.handle(eventA);
        JsonNode bodyA = objectMapper.readTree(respA.getBody());
        String autoToken = bodyA.get("data").get("autoPairingToken").asText();

        // Probe from DIFFERENT IP 198.51.100.99
        String probeJson = """
            {
                "v": 1,
                "action": "ip.probe",
                "requestId": "req-prb-2",
                "deviceId": "dev-stranger"
            }
            """;
        APIGatewayV2WebSocketEvent eventDiff = createEvent("$default", "conn-diff", probeJson, "198.51.100.99");
        APIGatewayV2WebSocketResponse respDiff = router.handle(eventDiff);
        JsonNode bodyDiff = objectMapper.readTree(respDiff.getBody());
        assertThat(bodyDiff.get("data").get("found").asBoolean()).isFalse();

        // Attempting to auto-join from different IP fails with 401
        String joinDiffJson = """
            {
                "v": 1,
                "action": "session.join_auto",
                "requestId": "req-jauto-diff",
                "sessionId": "sess-wifi-02",
                "deviceId": "dev-stranger",
                "autoPairingToken": "%s",
                "publicSigningKeyB64": "key-signing-x",
                "publicHpkeKeyB64": "key-hpke-x"
            }
            """.formatted(autoToken);

        APIGatewayV2WebSocketEvent eventDiffJoin = createEvent("$default", "conn-diff", joinDiffJson, "198.51.100.99");
        APIGatewayV2WebSocketResponse respDiffJoin = router.handle(eventDiffJoin);
        assertThat(respDiffJoin.getStatusCode()).isEqualTo(401);
    }
}
