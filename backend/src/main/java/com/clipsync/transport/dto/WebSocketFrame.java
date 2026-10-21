package com.clipsync.transport.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.JsonNode;

@JsonIgnoreProperties(ignoreUnknown = true)
public record WebSocketFrame(
    int v,
    String action,
    String requestId,
    String sessionId,
    String deviceId,
    String pairingCode,
    String storageMode,
    String publicSigningKeyB64,
    String publicHpkeKeyB64,
    JsonNode header,
    JsonNode payload,
    String snapshotSignature,
    JsonNode keyEnvelopes,
    Integer retentionDays,
    String targetDeviceId,
    JsonNode signal
) {
}
