package com.clipsync.connection;

import java.time.Instant;
import java.util.Objects;

public record Connection(
    String connectionId,
    String sessionId,
    String deviceId,
    Instant connectedAt,
    long ttl
) {
    public Connection {
        Objects.requireNonNull(connectionId, "connectionId must not be null");
        Objects.requireNonNull(sessionId, "sessionId must not be null");
        Objects.requireNonNull(deviceId, "deviceId must not be null");
        if (connectedAt == null) {
            connectedAt = Instant.now();
        }
    }
}
