package com.clipsync.storage;

import com.clipsync.session.Session;

import java.util.List;
import java.util.Optional;

public interface ClipboardRepository {
    void save(Session session, ClipboardSnapshot snapshot);
    Optional<ClipboardSnapshot> findLatest(Session session);
    List<ClipboardSnapshot> listRevisions(Session session);
    void deleteAllForSession(String sessionId);
}
