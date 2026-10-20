package com.clipsync.storage;

import java.time.Instant;
import java.util.Objects;

public record ClipboardSnapshot(
    String sessionId,
    String messageId,
    String senderDeviceId,
    long logicalClock,
    String baseRevisionId,
    int keyEpoch,
    String contentType,
    int plaintextBytes,
    String payloadCiphertext,
    String payloadNonce,
    String snapshotSignature,
    String keyEnvelopesJson,
    Instant createdAt,
    Instant expiresAt,
    long ttl
) {
    public ClipboardSnapshot {
        Objects.requireNonNull(sessionId, "sessionId must not be null");
        Objects.requireNonNull(messageId, "messageId must not be null");
        Objects.requireNonNull(senderDeviceId, "senderDeviceId must not be null");
        Objects.requireNonNull(payloadCiphertext, "payloadCiphertext must not be null");
        Objects.requireNonNull(payloadNonce, "payloadNonce must not be null");
        Objects.requireNonNull(snapshotSignature, "snapshotSignature must not be null");
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }

    public boolean isExpired() {
        return expiresAt != null && Instant.now().isAfter(expiresAt);
    }
}
