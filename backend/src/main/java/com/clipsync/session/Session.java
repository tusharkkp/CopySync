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
        return create(sessionId, mode, mode == StorageMode.HISTORY ? 30 : 0);
    }

    public static Session create(String sessionId, StorageMode mode, int retentionDays) {
        Instant now = Instant.now();
        long defaultTtl = now.getEpochSecond() + (mode == StorageMode.HISTORY
            ? (long) Math.max(1, retentionDays) * 86400L
            : (24 * 3600));
        return new Session(sessionId, mode, retentionDays, 1, SessionStatus.ACTIVE, now, defaultTtl);
    }

    public Session withIncrementedKeyEpoch() {
        return new Session(sessionId, storageMode, retentionDays, keyEpoch + 1, status, createdAt, ttl);
    }
}
