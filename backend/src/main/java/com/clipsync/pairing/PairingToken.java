package com.clipsync.pairing;

import java.time.Instant;
import java.util.Objects;

public record PairingToken(
    String sessionId,
    String tokenHash,
    String initiatorDeviceId,
    Instant expiresAt,
    int attemptCount,
    boolean consumed,
    long ttl
) {
    public static final int MAX_ATTEMPTS = 3;

    public PairingToken {
        Objects.requireNonNull(sessionId, "sessionId must not be null");
        Objects.requireNonNull(tokenHash, "tokenHash must not be null");
        Objects.requireNonNull(initiatorDeviceId, "initiatorDeviceId must not be null");
        Objects.requireNonNull(expiresAt, "expiresAt must not be null");
    }

    public boolean isExpired() {
        return Instant.now().isAfter(expiresAt);
    }

    public boolean isLockedOut() {
        return attemptCount >= MAX_ATTEMPTS;
    }
}
