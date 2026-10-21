package com.clipsync.transport;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import com.amazonaws.services.lambda.runtime.events.APIGatewayV2WebSocketEvent;
import com.amazonaws.services.lambda.runtime.events.APIGatewayV2WebSocketResponse;
import com.clipsync.transport.router.ClipSyncRouter;
import org.springframework.stereotype.Component;

import java.util.function.Function;

/**
 * Consolidated AWS Lambda WebSocket Handler for ClipSync.
 * Implements DEC-009: Single entrypoint routing all API Gateway WebSocket routes.
 */
@Component("clipSyncWebSocketHandler")
public class ClipSyncWebSocketHandler implements RequestHandler<APIGatewayV2WebSocketEvent, APIGatewayV2WebSocketResponse>,
        Function<APIGatewayV2WebSocketEvent, APIGatewayV2WebSocketResponse> {

    private final ClipSyncRouter router;

    public ClipSyncWebSocketHandler(ClipSyncRouter router) {
        this.router = router;
    }

    @Override
    public APIGatewayV2WebSocketResponse handleRequest(APIGatewayV2WebSocketEvent event, Context context) {
        return router.handle(event);
    }

    @Override
    public APIGatewayV2WebSocketResponse apply(APIGatewayV2WebSocketEvent event) {
        return router.handle(event);
    }
}
