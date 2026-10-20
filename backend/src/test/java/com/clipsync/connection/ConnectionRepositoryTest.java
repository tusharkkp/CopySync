package com.clipsync.connection;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

@DisplayName("DEC-008: Connection Repository Inverted Mapping Suite")
class ConnectionRepositoryTest {

    private InMemoryConnectionRepository repository;

    @BeforeEach
    void setUp() {
        repository = new InMemoryConnectionRepository();
    }

    @Test
    @DisplayName("CONN-01: O(1) Inverted lookup by connectionId (DEC-008)")
    void invertedLookupByConnectionId() {
        String connectionId = "conn-xyz-789";
        String sessionId = "sess-conn-01";
        String deviceId = "dev-alpha";

        Connection conn = new Connection(
            connectionId,
            sessionId,
            deviceId,
            Instant.now(),
            Instant.now().getEpochSecond() + 7200
        );

        repository.save(conn);

        Optional<Connection> retrieved = repository.findByConnectionId(connectionId);
        assertThat(retrieved).isPresent();
        assertThat(retrieved.get().sessionId()).isEqualTo(sessionId);
        assertThat(retrieved.get().deviceId()).isEqualTo(deviceId);
    }

    @Test
    @DisplayName("CONN-02: Query active connections for session broadcast")
    void queryActiveConnectionsForSession() {
        String sessionId = "sess-broadcast-01";

        Connection c1 = new Connection("c1", sessionId, "dev-alpha", Instant.now(), 0);
        Connection c2 = new Connection("c2", sessionId, "dev-beta", Instant.now(), 0);
        Connection cOther = new Connection("c3", "other-sess", "dev-gamma", Instant.now(), 0);

        repository.save(c1);
        repository.save(c2);
        repository.save(cOther);

        List<Connection> peers = repository.findActiveBySessionId(sessionId);
        assertThat(peers).hasSize(2);
        assertThat(peers).extracting(Connection::connectionId).containsExactlyInAnyOrder("c1", "c2");
    }

    @Test
    @DisplayName("CONN-03: Remove connection on disconnect cleans up mapping")
    void removeConnectionOnDisconnect() {
        Connection conn = new Connection("c-disconnect", "sess-dc", "dev-1", Instant.now(), 0);
        repository.save(conn);

        assertThat(repository.findByConnectionId("c-disconnect")).isPresent();
        repository.remove("c-disconnect");
        assertThat(repository.findByConnectionId("c-disconnect")).isEmpty();
    }
}
