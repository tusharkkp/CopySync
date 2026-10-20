package com.clipsync.session;

import java.time.Instant;
import java.util.Objects;

public record Session(
    String sessionId,
    StorageMode storageMode,
    int retentionDays,
    int keyEpoch,
    SessionStatus status,
    Instant createdAt,
    long ttl
) {
    public Session {
        Objects.requireNonNull(sessionId, "sessionId must not be null");
        Objects.requireNonNull(storageMode, "storageMode must not be null");
        Objects.requireNonNull(status, "status must not be null");
        if (createdAt == null) {
            createdAt = Instant.now();
        }
        if (keyEpoch < 1) {
            throw new IllegalArgumentException("keyEpoch must be >= 1");
        }
    }

    public static Session createDefault(String sessionId, StorageMode mode) {
        Instant now = Instant.now();
        // 24-hour default session TTL
        long defaultTtl = now.getEpochSecond() + (24 * 3600);
        return new Session(sessionId, mode, 0, 1, SessionStatus.ACTIVE, now, defaultTtl);
    }
}
