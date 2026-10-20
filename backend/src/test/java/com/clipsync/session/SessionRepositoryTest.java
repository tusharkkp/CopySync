package com.clipsync.session;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@DisplayName("SESSION: Session Repository & Epoch Management")
class SessionRepositoryTest {

    private InMemorySessionRepository repository;

    @BeforeEach
    void setUp() {
        repository = new InMemorySessionRepository();
    }

    @Test
    @DisplayName("SESS-01: Create, save and retrieve session")
    void createAndRetrieveSession() {
        String sessionId = "sess-alpha-99";
        Session session = Session.createDefault(sessionId, StorageMode.TEMPORARY);

        repository.save(session);

        Optional<Session> retrieved = repository.findById(sessionId);
        assertThat(retrieved).isPresent();
        assertThat(retrieved.get().sessionId()).isEqualTo(sessionId);
        assertThat(retrieved.get().storageMode()).isEqualTo(StorageMode.TEMPORARY);
        assertThat(retrieved.get().keyEpoch()).isEqualTo(1);
        assertThat(retrieved.get().status()).isEqualTo(SessionStatus.ACTIVE);
    }

    @Test
    @DisplayName("SESS-02: Advance key epoch monotonically on device revocation")
    void advanceKeyEpochMonotonically() {
        String sessionId = "sess-epoch-test";
        Session session = Session.createDefault(sessionId, StorageMode.HISTORY);
        repository.save(session);

        Session updatedEpoch = repository.advanceKeyEpoch(sessionId);
        assertThat(updatedEpoch.keyEpoch()).isEqualTo(2);

        Session retrieved = repository.findById(sessionId).orElseThrow();
        assertThat(retrieved.keyEpoch()).isEqualTo(2);
    }

    @Test
    @DisplayName("SESS-03: Session status transition to LOCKED_OUT or CLOSED")
    void updateSessionStatus() {
        String sessionId = "sess-status-test";
        Session session = Session.createDefault(sessionId, StorageMode.EPHEMERAL);
        repository.save(session);

        repository.updateStatus(sessionId, SessionStatus.LOCKED_OUT);

        Session retrieved = repository.findById(sessionId).orElseThrow();
        assertThat(retrieved.status()).isEqualTo(SessionStatus.LOCKED_OUT);
    }
}
