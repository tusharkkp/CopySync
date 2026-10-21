package com.clipsync.transport.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record WebSocketResponse(
    int v,
    String action,
    String requestId,
    String status,
    JsonNode data,
    String errorCode,
    String errorMessage
) {
    public static WebSocketResponse ok(String action, String requestId, JsonNode data) {
        return new WebSocketResponse(1, action, requestId, "OK", data, null, null);
    }

    public static WebSocketResponse error(String action, String requestId, String errorCode, String errorMessage) {
        return new WebSocketResponse(1, action, requestId, "ERROR", null, errorCode, errorMessage);
    }
}
