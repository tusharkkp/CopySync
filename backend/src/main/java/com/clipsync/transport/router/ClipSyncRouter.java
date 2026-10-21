package com.clipsync.transport.router;

import com.amazonaws.services.lambda.runtime.events.APIGatewayV2WebSocketEvent;
import com.amazonaws.services.lambda.runtime.events.APIGatewayV2WebSocketResponse;
import com.clipsync.connection.Connection;
import com.clipsync.connection.ConnectionRepository;
import com.clipsync.device.Device;
import com.clipsync.device.DeviceRole;
import com.clipsync.device.DeviceStatus;
import com.clipsync.device.DeviceRepository;
import com.clipsync.pairing.PairingService;
import com.clipsync.session.Session;
import com.clipsync.session.SessionRepository;
import com.clipsync.session.SessionStatus;
import com.clipsync.session.StorageMode;
import com.clipsync.storage.ClipboardRepository;
import com.clipsync.storage.ClipboardSnapshot;
import com.clipsync.transport.dto.WebSocketFrame;
import com.clipsync.transport.dto.WebSocketResponse;
import com.clipsync.transport.sender.WebSocketSender;
import com.clipsync.transport.validation.FrameValidator;
import com.clipsync.transport.validation.ProtocolErrorCode;
import com.clipsync.transport.validation.ValidationException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

public class ClipSyncRouter {

    private final SessionRepository sessionRepository;
    private final DeviceRepository deviceRepository;
    private final ConnectionRepository connectionRepository;
    private final PairingService pairingService;
    private final ClipboardRepository clipboardRepository;
    private final WebSocketSender webSocketSender;
    private final FrameValidator frameValidator;
    private final ObjectMapper objectMapper;
    private final SecureRandom secureRandom = new SecureRandom();

    public ClipSyncRouter(
        SessionRepository sessionRepository,
        DeviceRepository deviceRepository,
        ConnectionRepository connectionRepository,
        PairingService pairingService,
        ClipboardRepository clipboardRepository,
        WebSocketSender webSocketSender,
        FrameValidator frameValidator,
        ObjectMapper objectMapper
    ) {
        this.sessionRepository = sessionRepository;
        this.deviceRepository = deviceRepository;
        this.connectionRepository = connectionRepository;
        this.pairingService = pairingService;
        this.clipboardRepository = clipboardRepository;
        this.webSocketSender = webSocketSender;
        this.frameValidator = frameValidator;
        this.objectMapper = objectMapper;
    }

    public APIGatewayV2WebSocketResponse handle(APIGatewayV2WebSocketEvent event) {
        String routeKey = (event.getRequestContext() != null) ? event.getRequestContext().getRouteKey() : null;
        String connectionId = (event.getRequestContext() != null) ? event.getRequestContext().getConnectionId() : null;

        if (routeKey == null) {
            routeKey = "$default";
        }

        try {
            switch (routeKey) {
                case "$connect":
                    return handleConnect(connectionId);
                case "$disconnect":
                    return handleDisconnect(connectionId);
                case "$default":
                default:
                    return handleFrame(connectionId, event.getBody());
            }
        } catch (ValidationException ve) {
            return buildErrorResponse(400, "unknown", null, ve.getErrorCode(), ve.getMessage());
        } catch (Exception e) {
            return buildErrorResponse(500, "unknown", null, ProtocolErrorCode.INTERNAL_SERVER_ERROR, "An internal error occurred");
        }
    }

    private APIGatewayV2WebSocketResponse handleConnect(String connectionId) {
        if (connectionId != null) {
            long ttl = Instant.now().getEpochSecond() + (2 * 3600); // 2-hour TTL
            Connection conn = new Connection(connectionId, "UNBOUND", "UNBOUND", Instant.now(), ttl);
            connectionRepository.save(conn);
        }
        APIGatewayV2WebSocketResponse resp = new APIGatewayV2WebSocketResponse();
        resp.setStatusCode(200);
        return resp;
    }

    private APIGatewayV2WebSocketResponse handleDisconnect(String connectionId) {
        if (connectionId != null) {
            connectionRepository.remove(connectionId);
        }
        APIGatewayV2WebSocketResponse resp = new APIGatewayV2WebSocketResponse();
        resp.setStatusCode(200);
        return resp;
    }

    private APIGatewayV2WebSocketResponse handleFrame(String connectionId, String body) {
        WebSocketFrame frame = frameValidator.validateJson(body);

        return switch (frame.action()) {
            case "session.create" -> handleSessionCreate(connectionId, frame);
            case "session.join" -> handleSessionJoin(connectionId, frame);
            case "session.close" -> handleSessionClose(connectionId, frame);
            case "sync.resume" -> handleSyncResume(connectionId, frame);
            case "clipboard.update" -> handleClipboardUpdate(connectionId, frame, body);
            case "clipboard.read" -> handleClipboardRead(connectionId, frame);
            case "signaling.offer", "signaling.answer", "signaling.ice" -> handleSignaling(connectionId, frame, body);
            default -> buildErrorResponse(400, frame.action(), frame.requestId(), ProtocolErrorCode.UNKNOWN_ACTION, "Unrecognized action");
        };
    }

    private APIGatewayV2WebSocketResponse handleSessionCreate(String connectionId, WebSocketFrame frame) {
        String sessionId = (frame.sessionId() != null && !frame.sessionId().isBlank())
            ? frame.sessionId()
            : "sess-" + secureRandom.nextInt(1_000_000, 9_999_999);

        StorageMode mode = StorageMode.TEMPORARY;
        if (frame.storageMode() != null) {
            try {
                mode = StorageMode.valueOf(frame.storageMode().toUpperCase());
            } catch (IllegalArgumentException ignored) {}
        }

        int retentionDays = (frame.retentionDays() != null && frame.retentionDays() > 0)
            ? frame.retentionDays()
            : (mode == StorageMode.HISTORY ? 30 : 0);

        Session session = Session.create(sessionId, mode, retentionDays);
        sessionRepository.save(session);

        // Generate 6-digit numeric pairing code
        int codeInt = secureRandom.nextInt(100_000, 999_999);
        String pairingCode = String.valueOf(codeInt);

        // Store hashed pairing token
        pairingService.createPairingToken(sessionId, frame.deviceId(), pairingCode, Duration.ofMinutes(5));

        // Register initiator device
        if (frame.deviceId() != null && frame.publicSigningKeyB64() != null && frame.publicHpkeKeyB64() != null) {
            Device initiator = new Device(
                frame.deviceId(),
                sessionId,
                frame.publicSigningKeyB64(),
                frame.publicHpkeKeyB64(),
                DeviceRole.INITIATOR,
                DeviceStatus.ACTIVE,
                Instant.now()
            );
            deviceRepository.save(initiator);

            // Bind connection to sessionId and deviceId
            if (connectionId != null) {
                long ttl = Instant.now().getEpochSecond() + (2 * 3600);
                connectionRepository.save(new Connection(connectionId, sessionId, frame.deviceId(), Instant.now(), ttl));
            }
        }

        ObjectNode data = objectMapper.createObjectNode();
        data.put("sessionId", sessionId);
        data.put("pairingCode", pairingCode);
        data.put("storageMode", mode.name());
        data.put("retentionDays", retentionDays);
        data.put("keyEpoch", session.keyEpoch());

        return buildOkResponse(frame.action(), frame.requestId(), data);
    }

    private APIGatewayV2WebSocketResponse handleSessionJoin(String connectionId, WebSocketFrame frame) {
        if (frame.sessionId() == null || frame.pairingCode() == null) {
            return buildErrorResponse(400, frame.action(), frame.requestId(), ProtocolErrorCode.MISSING_PARAMETER, "sessionId and pairingCode required");
        }

        Optional<Session> optSession = sessionRepository.findById(frame.sessionId());
        if (optSession.isEmpty()) {
            return buildErrorResponse(404, frame.action(), frame.requestId(), ProtocolErrorCode.SESSION_NOT_FOUND, "Session not found");
        }

        Session session = optSession.get();
        if (session.status() == SessionStatus.LOCKED_OUT) {
            return buildErrorResponse(403, frame.action(), frame.requestId(), ProtocolErrorCode.SESSION_LOCKED_OUT, "Session is permanently locked out due to multiple failed pairing attempts");
        }

        // Verify and consume pairing code (SEC-P1, SEC-P2, SEC-P3)
        boolean consumed = pairingService.verifyAndConsumeToken(frame.sessionId(), frame.pairingCode());
        if (!consumed) {
            return buildErrorResponse(401, frame.action(), frame.requestId(), ProtocolErrorCode.INVALID_PAIRING_CODE, "Invalid or expired pairing code");
        }

        // Register joiner device
        if (frame.deviceId() != null && frame.publicSigningKeyB64() != null && frame.publicHpkeKeyB64() != null) {
            Device joiner = new Device(
                frame.deviceId(),
                frame.sessionId(),
                frame.publicSigningKeyB64(),
                frame.publicHpkeKeyB64(),
                DeviceRole.JOINER,
                DeviceStatus.ACTIVE,
                Instant.now()
            );
            deviceRepository.save(joiner);

            if (connectionId != null) {
                long ttl = Instant.now().getEpochSecond() + (2 * 3600);
                connectionRepository.save(new Connection(connectionId, frame.sessionId(), frame.deviceId(), Instant.now(), ttl));
            }

            // Notify peers in the session that a new device has joined
            List<Connection> peers = connectionRepository.findActiveBySessionId(frame.sessionId());
            ObjectNode notify = objectMapper.createObjectNode();
            notify.put("v", 1);
            notify.put("action", "peer.joined");
            notify.put("deviceId", frame.deviceId());
            notify.put("publicSigningKeyB64", frame.publicSigningKeyB64());
            notify.put("publicHpkeKeyB64", frame.publicHpkeKeyB64());

            String notifyJson = notify.toString();
            for (Connection p : peers) {
                if (!p.connectionId().equals(connectionId)) {
                    webSocketSender.postToConnection(p.connectionId(), notifyJson);
                }
            }
        }

        ObjectNode data = objectMapper.createObjectNode();
        data.put("sessionId", session.sessionId());
        data.put("status", "ACTIVE");
        data.put("keyEpoch", session.keyEpoch());

        return buildOkResponse(frame.action(), frame.requestId(), data);
    }

    private APIGatewayV2WebSocketResponse handleClipboardUpdate(String connectionId, WebSocketFrame frame, String rawBody) {
        if (frame.sessionId() == null || frame.header() == null || frame.payload() == null) {
            return buildErrorResponse(400, frame.action(), frame.requestId(), ProtocolErrorCode.MISSING_PARAMETER, "Header and payload required");
        }

        Optional<Session> optSession = sessionRepository.findById(frame.sessionId());
        if (optSession.isEmpty()) {
            return buildErrorResponse(404, frame.action(), frame.requestId(), ProtocolErrorCode.SESSION_NOT_FOUND, "Session not found");
        }

        Session session = optSession.get();

        JsonNode header = frame.header();
        JsonNode payload = frame.payload();

        String messageId = header.get("messageId").asText();
        String senderDeviceId = header.get("senderDeviceId").asText();
        long logicalClock = header.get("logicalClock").asLong();
        String baseRevisionId = header.has("baseRevisionId") ? header.get("baseRevisionId").asText() : "";
        int keyEpoch = header.has("keyEpoch") ? header.get("keyEpoch").asInt() : 1;
        String contentType = header.has("contentType") ? header.get("contentType").asText() : "text/plain";
        int plaintextBytes = header.has("plaintextBytes") ? header.get("plaintextBytes").asInt() : 0;

        String ciphertext = payload.get("ciphertext").asText();
        String nonce = payload.get("nonce").asText();
        String signature = frame.snapshotSignature() != null ? frame.snapshotSignature() : "";
        String keyEnvelopesJson = frame.keyEnvelopes() != null ? frame.keyEnvelopes().toString() : "[]";

        Instant now = Instant.now();
        Instant expiresAt = null;
        if (session.storageMode() == StorageMode.TEMPORARY) {
            expiresAt = now.plusSeconds(600);
        } else if (session.storageMode() == StorageMode.HISTORY) {
            int days = session.retentionDays() > 0 ? session.retentionDays() : 30;
            expiresAt = now.plus(Duration.ofDays(days));
        }
        long ttl = (expiresAt != null) ? expiresAt.getEpochSecond() : 0L;

        ClipboardSnapshot snapshot = new ClipboardSnapshot(
            session.sessionId(),
            messageId,
            senderDeviceId,
            logicalClock,
            baseRevisionId,
            keyEpoch,
            contentType,
            plaintextBytes,
            ciphertext,
            nonce,
            signature,
            keyEnvelopesJson,
            now,
            expiresAt,
            ttl
        );

        // Save snapshot (if temporary/history; ephemeral mode ignores)
        clipboardRepository.save(session, snapshot);

        // Broadcast to all other peers in session
        List<Connection> peers = connectionRepository.findActiveBySessionId(session.sessionId());
        for (Connection peer : peers) {
            if (!peer.connectionId().equals(connectionId)) {
                webSocketSender.postToConnection(peer.connectionId(), rawBody);
            }
        }

        ObjectNode data = objectMapper.createObjectNode();
        data.put("status", "OK");
        data.put("messageId", messageId);
        data.put("logicalClock", logicalClock);

        return buildOkResponse(frame.action(), frame.requestId(), data);
    }

    private APIGatewayV2WebSocketResponse handleClipboardRead(String connectionId, WebSocketFrame frame) {
        if (frame.sessionId() == null) {
            return buildErrorResponse(400, frame.action(), frame.requestId(), ProtocolErrorCode.MISSING_PARAMETER, "sessionId required");
        }

        Optional<Session> optSession = sessionRepository.findById(frame.sessionId());
        if (optSession.isEmpty()) {
            return buildErrorResponse(404, frame.action(), frame.requestId(), ProtocolErrorCode.SESSION_NOT_FOUND, "Session not found");
        }

        Optional<ClipboardSnapshot> snapshot = clipboardRepository.findLatest(optSession.get());
        ObjectNode data = objectMapper.createObjectNode();
        if (snapshot.isPresent()) {
            ClipboardSnapshot s = snapshot.get();
            data.put("messageId", s.messageId());
            data.put("logicalClock", s.logicalClock());
            data.put("payloadCiphertext", s.payloadCiphertext());
            data.put("payloadNonce", s.payloadNonce());
            data.put("snapshotSignature", s.snapshotSignature());
        }

        return buildOkResponse(frame.action(), frame.requestId(), data);
    }

    private APIGatewayV2WebSocketResponse handleSessionClose(String connectionId, WebSocketFrame frame) {
        if (frame.sessionId() == null) {
            return buildErrorResponse(400, frame.action(), frame.requestId(), ProtocolErrorCode.MISSING_PARAMETER, "sessionId required");
        }

        String sessionId = frame.sessionId();

        // 1. Delete all clipboard snapshots from ClipSyncClipboard
        clipboardRepository.deleteAllForSession(sessionId);

        // 2. Delete all devices for session
        deviceRepository.deleteAllForSession(sessionId);

        // 3. Delete pairing token
        pairingService.deletePairingToken(sessionId);

        // 4. Disconnect and remove active connections
        List<Connection> peers = connectionRepository.findActiveBySessionId(sessionId);
        for (Connection peer : peers) {
            connectionRepository.remove(peer.connectionId());
        }

        // 5. Delete session from ClipSyncRegistry
        sessionRepository.delete(sessionId);

        ObjectNode data = objectMapper.createObjectNode();
        data.put("status", "CLOSED");
        data.put("sessionId", sessionId);

        return buildOkResponse(frame.action(), frame.requestId(), data);
    }

    private APIGatewayV2WebSocketResponse handleSyncResume(String connectionId, WebSocketFrame frame) {
        if (frame.sessionId() == null) {
            return buildErrorResponse(400, frame.action(), frame.requestId(), ProtocolErrorCode.MISSING_PARAMETER, "sessionId required");
        }

        Optional<Session> optSession = sessionRepository.findById(frame.sessionId());
        if (optSession.isEmpty()) {
            return buildErrorResponse(404, frame.action(), frame.requestId(), ProtocolErrorCode.SESSION_NOT_FOUND, "Session not found");
        }

        Session session = optSession.get();
        ObjectNode data = objectMapper.createObjectNode();
        data.put("sessionId", session.sessionId());
        data.put("storageMode", session.storageMode().name());
        data.put("retentionDays", session.retentionDays());
        data.put("keyEpoch", session.keyEpoch());

        if (session.storageMode() == StorageMode.EPHEMERAL) {
            data.putNull("latestSnapshot");
            data.putArray("revisions");
            return buildOkResponse(frame.action(), frame.requestId(), data);
        }

        Optional<ClipboardSnapshot> latest = clipboardRepository.findLatest(session);
        if (latest.isPresent()) {
            ClipboardSnapshot s = latest.get();
            ObjectNode snapNode = objectMapper.createObjectNode();
            snapNode.put("messageId", s.messageId());
            snapNode.put("logicalClock", s.logicalClock());
            snapNode.put("payloadCiphertext", s.payloadCiphertext());
            snapNode.put("payloadNonce", s.payloadNonce());
            snapNode.put("snapshotSignature", s.snapshotSignature());
            snapNode.put("keyEnvelopesJson", s.keyEnvelopesJson());
            data.set("latestSnapshot", snapNode);
        } else {
            data.putNull("latestSnapshot");
        }

        if (session.storageMode() == StorageMode.HISTORY) {
            List<ClipboardSnapshot> revisions = clipboardRepository.listRevisions(session);
            ArrayNode revArray = objectMapper.createArrayNode();
            for (ClipboardSnapshot rev : revisions) {
                ObjectNode rNode = objectMapper.createObjectNode();
                rNode.put("messageId", rev.messageId());
                rNode.put("logicalClock", rev.logicalClock());
                rNode.put("createdAt", rev.createdAt().toString());
                rNode.put("payloadCiphertext", rev.payloadCiphertext());
                rNode.put("payloadNonce", rev.payloadNonce());
                rNode.put("snapshotSignature", rev.snapshotSignature());
                rNode.put("keyEnvelopesJson", rev.keyEnvelopesJson());
                revArray.add(rNode);
            }
            data.set("revisions", revArray);
        } else {
            data.putArray("revisions");
        }

        return buildOkResponse(frame.action(), frame.requestId(), data);
    }

    private APIGatewayV2WebSocketResponse handleSignaling(String connectionId, WebSocketFrame frame, String rawBody) {
        if (frame.sessionId() == null || frame.targetDeviceId() == null) {
            return buildErrorResponse(400, frame.action(), frame.requestId(), ProtocolErrorCode.MISSING_PARAMETER, "sessionId and targetDeviceId required");
        }

        List<Connection> peers = connectionRepository.findActiveBySessionId(frame.sessionId());
        for (Connection peer : peers) {
            if (peer.deviceId().equals(frame.targetDeviceId())) {
                webSocketSender.postToConnection(peer.connectionId(), rawBody);
            }
        }

        ObjectNode data = objectMapper.createObjectNode();
        data.put("relayed", true);
        data.put("targetDeviceId", frame.targetDeviceId());

        return buildOkResponse(frame.action(), frame.requestId(), data);
    }

    private APIGatewayV2WebSocketResponse buildOkResponse(String action, String requestId, JsonNode data) {
        WebSocketResponse responseDto = WebSocketResponse.ok(action, requestId, data);
        APIGatewayV2WebSocketResponse resp = new APIGatewayV2WebSocketResponse();
        resp.setStatusCode(200);
        try {
            resp.setBody(objectMapper.writeValueAsString(responseDto));
        } catch (Exception e) {
            resp.setBody("{\"status\":\"OK\"}");
        }
        return resp;
    }

    private APIGatewayV2WebSocketResponse buildErrorResponse(int statusCode, String action, String requestId, String errorCode, String errorMessage) {
        WebSocketResponse responseDto = WebSocketResponse.error(action, requestId, errorCode, errorMessage);
        APIGatewayV2WebSocketResponse resp = new APIGatewayV2WebSocketResponse();
        resp.setStatusCode(statusCode);
        try {
            resp.setBody(objectMapper.writeValueAsString(responseDto));
        } catch (Exception e) {
            resp.setBody("{\"status\":\"ERROR\",\"errorCode\":\"" + errorCode + "\"}");
        }
        return resp;
    }
}
