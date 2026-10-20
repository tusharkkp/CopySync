package com.clipsync.pairing;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Optional;

public class PairingService {

    private final PairingRepository pairingRepository;

    public PairingService(PairingRepository pairingRepository) {
        this.pairingRepository = pairingRepository;
    }

    public PairingToken createPairingToken(
        String sessionId,
        String initiatorDeviceId,
        String rawToken,
        Duration validity
    ) {
        String tokenHash = hashToken(rawToken);
        Instant now = Instant.now();
        Instant expiresAt = now.plus(validity);
        long ttl = expiresAt.getEpochSecond();

        PairingToken token = new PairingToken(
            sessionId,
            tokenHash,
            initiatorDeviceId,
            expiresAt,
            0,
            false,
            ttl
        );

        pairingRepository.save(token);
        return token;
    }

    public boolean verifyAndConsumeToken(String sessionId, String rawToken) {
        Optional<PairingToken> opt = pairingRepository.findBySessionId(sessionId);
        if (opt.isEmpty()) {
            return false;
        }

        PairingToken current = opt.get();

        // Check logical expiry and existing lockout/consumption
        if (current.isExpired() || current.isLockedOut() || current.consumed()) {
            return false;
        }

        String presentedHash = hashToken(rawToken);

        // Constant-time hash comparison
        if (!MessageDigest.isEqual(
            presentedHash.getBytes(StandardCharsets.UTF_8),
            current.tokenHash().getBytes(StandardCharsets.UTF_8)
        )) {
            // Record failed attempt (triggers lockout upon reaching MAX_ATTEMPTS)
            pairingRepository.recordFailedAttempt(sessionId);
            return false;
        }

        // Attempt single-use consumption via conditional write
        return pairingRepository.consumeIfValid(sessionId, presentedHash);
    }

    public String hashToken(String rawToken) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(rawToken.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 algorithm not available in JVM", e);
        }
    }
}
