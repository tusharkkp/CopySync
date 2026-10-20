package com.clipsync.pairing;

import java.util.Optional;

public interface PairingRepository {
    void save(PairingToken token);
    Optional<PairingToken> findBySessionId(String sessionId);
    boolean consumeIfValid(String sessionId, String tokenHash);
    int recordFailedAttempt(String sessionId);
    void delete(String sessionId);
}
