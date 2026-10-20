package com.clipsync.connection;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

public class InMemoryConnectionRepository implements ConnectionRepository {

    // Inverted mapping: connectionId -> Connection (O(1) lookups)
    private final Map<String, Connection> connectionStore = new ConcurrentHashMap<>();

    @Override
    public void save(Connection connection) {
        connectionStore.put(connection.connectionId(), connection);
    }

    @Override
    public Optional<Connection> findByConnectionId(String connectionId) {
        return Optional.ofNullable(connectionStore.get(connectionId));
    }

    @Override
    public List<Connection> findActiveBySessionId(String sessionId) {
        return connectionStore.values().stream()
            .filter(c -> c.sessionId().equals(sessionId))
            .collect(Collectors.toList());
    }

    @Override
    public void remove(String connectionId) {
        connectionStore.remove(connectionId);
    }
}
