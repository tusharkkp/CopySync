package com.clipsync.session;

import java.util.Optional;

public interface SessionRepository {
    void save(Session session);
    Optional<Session> findById(String sessionId);
    Session advanceKeyEpoch(String sessionId);
    void updateStatus(String sessionId, SessionStatus status);
    void delete(String sessionId);
}
