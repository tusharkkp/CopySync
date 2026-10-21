package com.clipsync.transport;

import com.clipsync.connection.Connection;
import com.clipsync.connection.InMemoryConnectionRepository;
import com.clipsync.transport.sender.ApiGatewayWebSocketSender;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import software.amazon.awssdk.core.SdkBytes;
import software.amazon.awssdk.services.apigatewaymanagementapi.ApiGatewayManagementApiClient;
import software.amazon.awssdk.services.apigatewaymanagementapi.model.GoneException;
import software.amazon.awssdk.services.apigatewaymanagementapi.model.PostToConnectionRequest;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@DisplayName("TRANSPORT: WebSocket Sender & Dead Connection Pruning")
class ApiGatewayWebSocketSenderTest {

    private ApiGatewayManagementApiClient client;
    private InMemoryConnectionRepository connectionRepo;
    private ApiGatewayWebSocketSender sender;

    @BeforeEach
    void setUp() {
        client = mock(ApiGatewayManagementApiClient.class);
        connectionRepo = new InMemoryConnectionRepository();
        sender = new ApiGatewayWebSocketSender(client, connectionRepo);
    }

    @Test
    @DisplayName("SEND-01: Successfully posts payload to active connection")
    void testSuccessfulPost() {
        String connectionId = "conn-active-01";
        String payload = "{\"status\":\"OK\"}";

        sender.postToConnection(connectionId, payload);

        ArgumentCaptor<PostToConnectionRequest> captor = ArgumentCaptor.forClass(PostToConnectionRequest.class);
        verify(client).postToConnection(captor.capture());

        PostToConnectionRequest req = captor.getValue();
        assertThat(req.connectionId()).isEqualTo(connectionId);
        assertThat(req.data().asUtf8String()).isEqualTo(payload);
    }

    @Test
    @DisplayName("SEC-W5: Prunes dead connection from repository upon GoneException (HTTP 410)")
    void testPrunesDeadConnectionOnGoneException() {
        String connectionId = "conn-dead-01";
        connectionRepo.save(new Connection(connectionId, "sess-1", "dev-1", Instant.now(), 0));
        assertThat(connectionRepo.findByConnectionId(connectionId)).isPresent();

        // Simulate client has disconnected
        when(client.postToConnection(any(PostToConnectionRequest.class)))
            .thenThrow(GoneException.builder().message("Connection gone").build());

        sender.postToConnection(connectionId, "{\"test\":\"data\"}");

        // Connection should be automatically purged from repository
        assertThat(connectionRepo.findByConnectionId(connectionId)).isEmpty();
    }
}
