package com.clipsync.pairing;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

@DisplayName("SEC-PAIRING: Pairing Security Invariants & Lockout Suite")
class PairingSecurityTest {

    private InMemoryPairingRepository repository;
    private PairingService pairingService;

    @BeforeEach
    void setUp() {
        repository = new InMemoryPairingRepository();
        pairingService = new PairingService(repository);
    }

    @Test
    @DisplayName("SEC-P1: Single-use pairing token cannot be consumed twice")
    void tokenCannotBeConsumedTwice() {
        String sessionId = "sess-12345";
        String initiatorDeviceId = "dev-alpha";
        String rawToken = "948215";

        PairingToken token = pairingService.createPairingToken(sessionId, initiatorDeviceId, rawToken, Duration.ofMinutes(5));
        assertThat(token.consumed()).isFalse();

        // First consumption succeeds
        boolean firstConsume = pairingService.verifyAndConsumeToken(sessionId, rawToken);
        assertThat(firstConsume).isTrue();

        // Second consumption must fail (conditional check)
        boolean secondConsume = pairingService.verifyAndConsumeToken(sessionId, rawToken);
        assertThat(secondConsume).isFalse();
    }

    @Test
    @DisplayName("SEC-P2: 3 consecutive invalid attempts lock out session permanently")
    void bruteForceMitigationLocksSessionAfterThreeFailedAttempts() {
        String sessionId = "sess-lockout-test";
        String initiatorDeviceId = "dev-alpha";
        String validToken = "123456";

        pairingService.createPairingToken(sessionId, initiatorDeviceId, validToken, Duration.ofMinutes(5));

        // Attempt 1: wrong code
        boolean attempt1 = pairingService.verifyAndConsumeToken(sessionId, "000001");
        assertThat(attempt1).isFalse();
        Optional<PairingToken> state1 = repository.findBySessionId(sessionId);
        assertThat(state1).isPresent();
        assertThat(state1.get().attemptCount()).isEqualTo(1);
        assertThat(state1.get().isLockedOut()).isFalse();

        // Attempt 2: wrong code
        boolean attempt2 = pairingService.verifyAndConsumeToken(sessionId, "000002");
        assertThat(attempt2).isFalse();
        Optional<PairingToken> state2 = repository.findBySessionId(sessionId);
        assertThat(state2).isPresent();
        assertThat(state2.get().attemptCount()).isEqualTo(2);
        assertThat(state2.get().isLockedOut()).isFalse();

        // Attempt 3: wrong code -> Lockout triggered
        boolean attempt3 = pairingService.verifyAndConsumeToken(sessionId, "000003");
        assertThat(attempt3).isFalse();
        Optional<PairingToken> state3 = repository.findBySessionId(sessionId);
        assertThat(state3).isPresent();
        assertThat(state3.get().attemptCount()).isEqualTo(3);
        assertThat(state3.get().isLockedOut()).isTrue();

        // Attempt 4: Even with the CORRECT token now, pairing is rejected due to lockout
        boolean attempt4 = pairingService.verifyAndConsumeToken(sessionId, validToken);
        assertThat(attempt4).isFalse();
    }

    @Test
    @DisplayName("SEC-P3: Pairing tokens are hashed with SHA-256 at rest (raw token never stored)")
    void rawTokenNeverStoredAtRest() {
        String sessionId = "sess-hash-test";
        String initiatorDeviceId = "dev-alpha";
        String rawToken = "SECRET_PIN_7890";

        pairingService.createPairingToken(sessionId, initiatorDeviceId, rawToken, Duration.ofMinutes(5));

        Optional<PairingToken> stored = repository.findBySessionId(sessionId);
        assertThat(stored).isPresent();

        // Stored tokenHash must NOT equal raw token
        assertThat(stored.get().tokenHash()).isNotEqualTo(rawToken);
        // Stored tokenHash must match SHA-256 of raw token
        String expectedHash = pairingService.hashToken(rawToken);
        assertThat(stored.get().tokenHash()).isEqualTo(expectedHash);
        assertThat(stored.get().tokenHash()).hasSize(64); // SHA-256 hex length
    }

    @Test
    @DisplayName("SEC-P4: Expired pairing tokens (> 5 min) are rejected even if unconsumed")
    void expiredTokensAreRejected() {
        String sessionId = "sess-expiry-test";
        String initiatorDeviceId = "dev-alpha";
        String rawToken = "555123";

        // Create an already-expired token (-10 seconds)
        Instant past = Instant.now().minusSeconds(10);
        String tokenHash = pairingService.hashToken(rawToken);
        PairingToken expiredToken = new PairingToken(
            sessionId,
            tokenHash,
            initiatorDeviceId,
            past,
            0,
            false,
            past.getEpochSecond()
        );
        repository.save(expiredToken);

        // Verification must reject expired token
        boolean consumed = pairingService.verifyAndConsumeToken(sessionId, rawToken);
        assertThat(consumed).isFalse();
    }
}
