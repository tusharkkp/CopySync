package com.clipsync.storage;

import com.clipsync.session.Session;
import com.clipsync.session.StorageMode;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

public class InMemoryClipboardRepository implements ClipboardRepository {

    // sessionId -> list of snapshots
    private final Map<String, List<ClipboardSnapshot>> store = new ConcurrentHashMap<>();

    @Override
    public void save(Session session, ClipboardSnapshot snapshot) {
        if (session.storageMode() == StorageMode.EPHEMERAL) {
            // Ephemeral mode persists NOTHING
            return;
        }

        store.compute(session.sessionId(), (id, list) -> {
            List<ClipboardSnapshot> current = (list == null) ? new ArrayList<>() : new ArrayList<>(list);
            current.add(snapshot);
            return current;
        });
    }

    @Override
    public Optional<ClipboardSnapshot> findLatest(Session session) {
        if (session.storageMode() == StorageMode.EPHEMERAL) {
            return Optional.empty();
        }

        List<ClipboardSnapshot> snapshots = store.get(session.sessionId());
        if (snapshots == null || snapshots.isEmpty()) {
            return Optional.empty();
        }

        // Latest by logical clock
        ClipboardSnapshot latest = snapshots.stream()
            .max(Comparator.comparingLong(ClipboardSnapshot::logicalClock))
            .orElse(null);

        if (latest == null) {
            return Optional.empty();
        }

        // SEC-10: Strict read-time logical expiry check
        if (latest.isExpired()) {
            return Optional.empty();
        }

        return Optional.of(latest);
    }

    @Override
    public List<ClipboardSnapshot> listRevisions(Session session) {
        if (session.storageMode() == StorageMode.EPHEMERAL) {
            return Collections.emptyList();
        }

        List<ClipboardSnapshot> snapshots = store.get(session.sessionId());
        if (snapshots == null) {
            return Collections.emptyList();
        }

        return snapshots.stream()
            .filter(s -> !s.isExpired())
            .sorted(Comparator.comparingLong(ClipboardSnapshot::logicalClock))
            .collect(Collectors.toList());
    }

    @Override
    public void deleteAllForSession(String sessionId) {
        store.remove(sessionId);
    }
}
