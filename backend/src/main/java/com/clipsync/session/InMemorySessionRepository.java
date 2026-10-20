package com.clipsync.session;

import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

public class InMemorySessionRepository implements SessionRepository {

    private final Map<String, Session> store = new ConcurrentHashMap<>();

    @Override
    public void save(Session session) {
        store.put(session.sessionId(), session);
    }

    @Override
    public Optional<Session> findById(String sessionId) {
        return Optional.ofNullable(store.get(sessionId));
    }

    @Override
    public Session advanceKeyEpoch(String sessionId) {
        return store.compute(sessionId, (id, current) -> {
            if (current == null) {
                throw new IllegalStateException("Session not found: " + sessionId);
            }
            return new Session(
                current.sessionId(),
                current.storageMode(),
                current.retentionDays(),
                current.keyEpoch() + 1,
                current.status(),
                current.createdAt(),
                current.ttl()
            );
        });
    }

    @Override
    public void updateStatus(String sessionId, SessionStatus status) {
        store.computeIfPresent(sessionId, (id, current) -> new Session(
            current.sessionId(),
            current.storageMode(),
            current.retentionDays(),
            current.keyEpoch(),
            status,
            current.createdAt(),
            current.ttl()
        ));
    }

    @Override
    public void delete(String sessionId) {
        store.remove(sessionId);
    }
}
