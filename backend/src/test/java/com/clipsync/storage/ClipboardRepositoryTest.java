package com.clipsync.storage;

import com.clipsync.session.Session;
import com.clipsync.session.StorageMode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

@DisplayName("SEC-STORAGE: Clipboard Invariant & Expiry Suite")
class ClipboardRepositoryTest {

    private InMemoryClipboardRepository repository;

    @BeforeEach
    void setUp() {
        repository = new InMemoryClipboardRepository();
    }

    @Test
    @DisplayName("SEC-10: Logical expiry on read - expired temporary snapshot is suppressed")
    void expiredTemporarySnapshotIsSuppressedOnRead() {
        String sessionId = "sess-temp-01";
        Session session = Session.createDefault(sessionId, StorageMode.TEMPORARY);

        // Snapshot expired 5 seconds ago
        Instant past = Instant.now().minusSeconds(5);
        ClipboardSnapshot expiredSnapshot = new ClipboardSnapshot(
            sessionId,
            "msg-001",
            "dev-alpha",
            1L,
            "msg-000",
            1,
            "text/plain;charset=utf-8",
            42,
            "ciphertext-base64url",
            "nonce-base64url",
            "sig-base64url",
            "[]",
            Instant.now().minusSeconds(605),
            past, // expiresAt in the past
            past.getEpochSecond()
        );

        repository.save(session, expiredSnapshot);

        // Even though physically present in table, logical read check must suppress it!
        Optional<ClipboardSnapshot> result = repository.findLatest(session);
        assertThat(result).isEmpty();
    }

    @Test
    @DisplayName("SEC-P6: Canary string safety - opaque ciphertext preserved without leaking plaintext")
    void canaryPlaintextSafetyAndCiphertextFidelity() {
        String sessionId = "sess-canary-01";
        Session session = Session.createDefault(sessionId, StorageMode.TEMPORARY);

        String canaryCiphertext = "CIPHERTEXT_CANARY_ENCRYPTED_9f3a";
        String canaryNonce = "NONCE_9f3a";
        String canarySignature = "SIGNATURE_9f3a";

        ClipboardSnapshot snapshot = new ClipboardSnapshot(
            sessionId,
            "msg-002",
            "dev-alpha",
            1L,
            "msg-000",
            1,
            "text/plain;charset=utf-8",
            100,
            canaryCiphertext,
            canaryNonce,
            canarySignature,
            "[]",
            Instant.now(),
            Instant.now().plusSeconds(600),
            Instant.now().plusSeconds(600).getEpochSecond()
        );

        repository.save(session, snapshot);

        Optional<ClipboardSnapshot> retrieved = repository.findLatest(session);
        assertThat(retrieved).isPresent();
        assertThat(retrieved.get().payloadCiphertext()).isEqualTo(canaryCiphertext);
        assertThat(retrieved.get().payloadNonce()).isEqualTo(canaryNonce);
        assertThat(retrieved.get().snapshotSignature()).isEqualTo(canarySignature);

        // Raw canary plaintext CLIPSYNC_CANARY_9f3a must NEVER appear
        assertThat(retrieved.get().payloadCiphertext()).doesNotContain("CLIPSYNC_CANARY_9f3a");
    }

    @Test
    @DisplayName("EPHEMERAL mode: Snapshots are never persisted to storage")
    void ephemeralModeNeverPersistsSnapshots() {
        String sessionId = "sess-ephemeral-01";
        Session session = Session.createDefault(sessionId, StorageMode.EPHEMERAL);

        ClipboardSnapshot snapshot = new ClipboardSnapshot(
            sessionId,
            "msg-003",
            "dev-alpha",
            1L,
            "msg-000",
            1,
            "text/plain;charset=utf-8",
            25,
            "ephemeral-ciphertext",
            "ephemeral-nonce",
            "ephemeral-sig",
            "[]",
            Instant.now(),
            null,
            0
        );

        repository.save(session, snapshot);

        // Repository must have 0 persisted items for this session
        Optional<ClipboardSnapshot> retrieved = repository.findLatest(session);
        assertThat(retrieved).isEmpty();
    }
}
