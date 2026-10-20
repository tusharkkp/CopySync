package com.clipsync.connection;

import java.util.List;
import java.util.Optional;

public interface ConnectionRepository {
    void save(Connection connection);
    Optional<Connection> findByConnectionId(String connectionId);
    List<Connection> findActiveBySessionId(String sessionId);
    void remove(String connectionId);
}
