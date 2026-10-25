package com.clipsync.discovery;

import java.time.Instant;

/**
 * Ephemeral discovery record stored in DynamoDB under the hashed IP partition key.
 * Used for zero-friction same-router local peer discovery while keeping E2EE keys intact.
 */
public record IpDiscoveryRecord(
    String ipHash,              // e.g. "IP#<sha256(sourceIp)>"
    String sessionId,
    String hostDeviceId,
    String hostDeviceName,
    String publicSigningKeyB64,
    String publicHpkeKeyB64,
    String autoPairingToken,
    Instant expiresAt,
    long ttl
) {
    public boolean isExpired() {
        return Instant.now().isAfter(expiresAt);
    }
}
