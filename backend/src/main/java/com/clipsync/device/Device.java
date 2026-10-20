package com.clipsync.device;

import java.time.Instant;
import java.util.Objects;

public record Device(
    String deviceId,
    String sessionId,
    String publicSigningKeyB64,
    String publicHpkeKeyB64,
    DeviceRole role,
    DeviceStatus status,
    Instant joinedAt
) {
    public Device {
        Objects.requireNonNull(deviceId, "deviceId must not be null");
        Objects.requireNonNull(sessionId, "sessionId must not be null");
        Objects.requireNonNull(publicSigningKeyB64, "publicSigningKeyB64 must not be null");
        Objects.requireNonNull(publicHpkeKeyB64, "publicHpkeKeyB64 must not be null");
        Objects.requireNonNull(role, "role must not be null");
        Objects.requireNonNull(status, "status must not be null");
        if (joinedAt == null) {
            joinedAt = Instant.now();
        }
    }
}
