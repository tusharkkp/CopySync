package com.clipsync.transport.sender;

import com.clipsync.connection.ConnectionRepository;
import software.amazon.awssdk.core.SdkBytes;
import software.amazon.awssdk.services.apigatewaymanagementapi.ApiGatewayManagementApiClient;
import software.amazon.awssdk.services.apigatewaymanagementapi.model.GoneException;
import software.amazon.awssdk.services.apigatewaymanagementapi.model.PostToConnectionRequest;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class ApiGatewayWebSocketSender implements WebSocketSender {

    private static final Logger log = LoggerFactory.getLogger(ApiGatewayWebSocketSender.class);

    private final ApiGatewayManagementApiClient client;
    private final ConnectionRepository connectionRepository;

    public ApiGatewayWebSocketSender(
        ApiGatewayManagementApiClient client,
        ConnectionRepository connectionRepository
    ) {
        this.client = client;
        this.connectionRepository = connectionRepository;
    }

    @Override
    public void postToConnection(String connectionId, String payloadJson) {
        try {
            PostToConnectionRequest request = PostToConnectionRequest.builder()
                .connectionId(connectionId)
                .data(SdkBytes.fromUtf8String(payloadJson))
                .build();
            client.postToConnection(request);
        } catch (GoneException e) {
            // SEC-W5: Automatically prune dead/disconnected connection
            log.info("Connection {} gone (HTTP 410); pruning from repository", connectionId);
            connectionRepository.remove(connectionId);
        } catch (Exception e) {
            log.warn("Failed to post to connection {}: {}", connectionId, e.getMessage(), e);
        }
    }
}
