package com.clipsync.transport.sender;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

public class InMemoryWebSocketSender implements WebSocketSender {

    private final Map<String, List<String>> sentMessages = new ConcurrentHashMap<>();

    @Override
    public void postToConnection(String connectionId, String payloadJson) {
        sentMessages.computeIfAbsent(connectionId, k -> new ArrayList<>()).add(payloadJson);
    }

    public List<String> getSentMessages(String connectionId) {
        return sentMessages.getOrDefault(connectionId, Collections.emptyList());
    }

    public void clear() {
        sentMessages.clear();
    }
}
