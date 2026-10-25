package com.clipsync.common;

import com.clipsync.connection.ConnectionRepository;
import com.clipsync.connection.DynamoDbConnectionRepository;
import com.clipsync.device.DeviceRepository;
import com.clipsync.device.DynamoDbDeviceRepository;
import com.clipsync.pairing.DynamoDbPairingRepository;
import com.clipsync.pairing.PairingRepository;
import com.clipsync.pairing.PairingService;
import com.clipsync.session.DynamoDbSessionRepository;
import com.clipsync.session.SessionRepository;
import com.clipsync.storage.ClipboardRepository;
import com.clipsync.storage.DynamoDbClipboardRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.DynamoDbClientBuilder;

import java.net.URI;

@Configuration
public class DynamoDbConfig {

    @Value("${clipsync.dynamodb.endpoint:}")
    private String endpointOverride;

    @Value("${clipsync.aws.region:ap-south-1}")
    private String awsRegion;

    @Bean
    public DynamoDbClient dynamoDbClient() {
        DynamoDbClientBuilder builder = DynamoDbClient.builder()
            .region(Region.of(awsRegion))
            .httpClientBuilder(UrlConnectionHttpClient.builder());

        if (endpointOverride != null && !endpointOverride.isBlank()) {
            builder.endpointOverride(URI.create(endpointOverride))
                .credentialsProvider(StaticCredentialsProvider.create(
                    AwsBasicCredentials.create("localKey", "localSecret")
                ));
        } else {
            builder.credentialsProvider(DefaultCredentialsProvider.create());
        }

        return builder.build();
    }

    @Value("${clipsync.dynamodb.table.registry:ClipSyncRegistry}")
    private String registryTableName;

    @Value("${clipsync.dynamodb.table.clipboard:ClipSyncClipboard}")
    private String clipboardTableName;

    @Bean
    public SessionRepository sessionRepository(DynamoDbClient client) {
        return new DynamoDbSessionRepository(client, registryTableName);
    }

    @Bean
    public DeviceRepository deviceRepository(DynamoDbClient client) {
        return new DynamoDbDeviceRepository(client, registryTableName);
    }

    @Bean
    public ConnectionRepository connectionRepository(DynamoDbClient client) {
        return new DynamoDbConnectionRepository(client, registryTableName);
    }

    @Bean
    public PairingRepository pairingRepository(DynamoDbClient client) {
        return new DynamoDbPairingRepository(client, registryTableName);
    }

    @Bean
    public PairingService pairingService(PairingRepository pairingRepository) {
        return new PairingService(pairingRepository);
    }

    @Bean
    public ClipboardRepository clipboardRepository(DynamoDbClient client) {
        return new DynamoDbClipboardRepository(client, clipboardTableName);
    }

    @Value("${clipsync.apigateway.endpoint:}")
    private String apiGatewayEndpoint;

    @Bean
    public com.fasterxml.jackson.databind.ObjectMapper objectMapper() {
        return new com.fasterxml.jackson.databind.ObjectMapper();
    }

    @Bean
    public com.clipsync.transport.validation.FrameValidator frameValidator(com.fasterxml.jackson.databind.ObjectMapper objectMapper) {
        return new com.clipsync.transport.validation.FrameValidator(objectMapper);
    }

    @Bean
    public com.clipsync.transport.sender.WebSocketSender webSocketSender(ConnectionRepository connectionRepository) {
        if (apiGatewayEndpoint != null && !apiGatewayEndpoint.isBlank()) {
            software.amazon.awssdk.services.apigatewaymanagementapi.ApiGatewayManagementApiClient client =
                software.amazon.awssdk.services.apigatewaymanagementapi.ApiGatewayManagementApiClient.builder()
                    .endpointOverride(URI.create(apiGatewayEndpoint))
                    .region(Region.of(awsRegion))
                    .credentialsProvider(DefaultCredentialsProvider.create())
                    .httpClientBuilder(UrlConnectionHttpClient.builder())
                    .build();
            return new com.clipsync.transport.sender.ApiGatewayWebSocketSender(client, connectionRepository);
        }
        return new com.clipsync.transport.sender.InMemoryWebSocketSender();
    }

    @Bean
    public com.clipsync.discovery.IpDiscoveryRepository ipDiscoveryRepository(DynamoDbClient client) {
        return new com.clipsync.discovery.DynamoDbIpDiscoveryRepository(client, registryTableName);
    }

    @Bean
    public com.clipsync.transport.router.ClipSyncRouter clipSyncRouter(
        SessionRepository sessionRepository,
        DeviceRepository deviceRepository,
        ConnectionRepository connectionRepository,
        PairingService pairingService,
        ClipboardRepository clipboardRepository,
        com.clipsync.transport.sender.WebSocketSender webSocketSender,
        com.clipsync.transport.validation.FrameValidator frameValidator,
        com.fasterxml.jackson.databind.ObjectMapper objectMapper,
        com.clipsync.discovery.IpDiscoveryRepository ipDiscoveryRepository
    ) {
        return new com.clipsync.transport.router.ClipSyncRouter(
            sessionRepository,
            deviceRepository,
            connectionRepository,
            pairingService,
            clipboardRepository,
            webSocketSender,
            frameValidator,
            objectMapper,
            ipDiscoveryRepository
        );
    }
}
