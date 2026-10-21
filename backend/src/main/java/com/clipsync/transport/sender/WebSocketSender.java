package com.clipsync.transport.sender;

public interface WebSocketSender {
    void postToConnection(String connectionId, String payloadJson);
}
