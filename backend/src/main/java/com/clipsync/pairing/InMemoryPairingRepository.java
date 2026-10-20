package com.clipsync.pairing;

import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

public class InMemoryPairingRepository implements PairingRepository {

    private final Map<String, PairingToken> store = new ConcurrentHashMap<>();

    @Override
    public void save(PairingToken token) {
        store.put(token.sessionId(), token);
    }

    @Override
    public Optional<PairingToken> findBySessionId(String sessionId) {
        return Optional.ofNullable(store.get(sessionId));
    }

    @Override
    public synchronized boolean consumeIfValid(String sessionId, String tokenHash) {
        PairingToken current = store.get(sessionId);
        if (current == null) {
            return false;
        }

        if (!current.tokenHash().equals(tokenHash) || current.consumed() || current.isLockedOut() || current.isExpired()) {
            return false;
        }

        PairingToken updated = new PairingToken(
            current.sessionId(),
            current.tokenHash(),
            current.initiatorDeviceId(),
            current.expiresAt(),
            current.attemptCount(),
            true, // consumed
            current.ttl()
        );
        store.put(sessionId, updated);
        return true;
    }

    @Override
    public synchronized int recordFailedAttempt(String sessionId) {
        PairingToken current = store.get(sessionId);
        if (current == null) {
            return 0;
        }

        int newAttempts = current.attemptCount() + 1;
        PairingToken updated = new PairingToken(
            current.sessionId(),
            current.tokenHash(),
            current.initiatorDeviceId(),
            current.expiresAt(),
            newAttempts,
            current.consumed(),
            current.ttl()
        );
        store.put(sessionId, updated);
        return newAttempts;
    }

    @Override
    public void delete(String sessionId) {
        store.remove(sessionId);
    }
}
