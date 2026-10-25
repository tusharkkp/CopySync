package com.clipsync.transport.validation;

import com.clipsync.transport.dto.WebSocketFrame;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.util.Set;

public class FrameValidator {

    public static final int MAX_FRAME_BYTES = 32 * 1024;      // 32 KiB API Gateway frame limit
    public static final int MAX_SNAPSHOT_BYTES = 64 * 1024;   // 64 KiB ClipSync snapshot limit

    private static final Set<String> ALLOWED_ACTIONS = Set.of(
        "$connect",
        "$disconnect",
        "$default",
        "session.create",
        "session.join",
        "session.join_auto",
        "ip.announce",
        "ip.probe",
        "clipboard.update",
        "clipboard.read",
        "signaling.offer",
        "signaling.answer",
        "signaling.ice",
        "session.close",
        "sync.resume",
        "device.revoke"
    );

    private final ObjectMapper objectMapper;

    public FrameValidator() {
        this(new ObjectMapper());
    }

    public FrameValidator(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public WebSocketFrame validateJson(String json) {
        if (json == null || json.isBlank()) {
            throw new ValidationException(ProtocolErrorCode.MALFORMED_JSON, "Frame body must not be empty");
        }

        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_FRAME_BYTES) {
            throw new ValidationException(
                ProtocolErrorCode.PAYLOAD_TOO_LARGE,
                "WebSocket frame size (" + bytes.length + " bytes) exceeds maximum limit of " + MAX_FRAME_BYTES + " bytes"
            );
        }

        WebSocketFrame frame;
        try {
            frame = objectMapper.readValue(json, WebSocketFrame.class);
        } catch (JsonProcessingException e) {
            throw new ValidationException(ProtocolErrorCode.MALFORMED_JSON, "Failed to parse JSON body");
        }

        // Validate Version
        if (frame.v() != 1) {
            throw new ValidationException(
                ProtocolErrorCode.INVALID_VERSION,
                "Unsupported protocol version: " + frame.v() + " (only version 1 is supported)"
            );
        }

        // Validate Action Whitelist
        if (frame.action() == null || !ALLOWED_ACTIONS.contains(frame.action())) {
            throw new ValidationException(
                ProtocolErrorCode.UNKNOWN_ACTION,
                "Unrecognized action: " + frame.action()
            );
        }

        // If clipboard snapshot is present, enforce <= 64 KiB
        if (frame.header() != null && frame.header().has("plaintextBytes")) {
            int plaintextBytes = frame.header().get("plaintextBytes").asInt();
            if (plaintextBytes > MAX_SNAPSHOT_BYTES) {
                throw new ValidationException(
                    ProtocolErrorCode.PAYLOAD_TOO_LARGE,
                    "Snapshot plaintextBytes exceeds 64 KiB limit: " + plaintextBytes
                );
            }
        }

        return frame;
    }
}
