package com.clipsync.transport.sender;

import com.clipsync.connection.ConnectionRepository;
import software.amazon.awssdk.core.SdkBytes;
import software.amazon.awssdk.services.apigatewaymanagementapi.ApiGatewayManagementApiClient;
import software.amazon.awssdk.services.apigatewaymanagementapi.model.GoneException;
import software.amazon.awssdk.services.apigatewaymanagementapi.model.PostToConnectionRequest;

public class ApiGatewayWebSocketSender implements WebSocketSender {

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
            connectionRepository.remove(connectionId);
        } catch (Exception e) {
            // Log warning or silently fail without breaking caller
        }
    }
}
