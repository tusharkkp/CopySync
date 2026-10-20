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

    @Bean
    public SessionRepository sessionRepository(DynamoDbClient client) {
        return new DynamoDbSessionRepository(client);
    }

    @Bean
    public DeviceRepository deviceRepository(DynamoDbClient client) {
        return new DynamoDbDeviceRepository(client);
    }

    @Bean
    public ConnectionRepository connectionRepository(DynamoDbClient client) {
        return new DynamoDbConnectionRepository(client);
    }

    @Bean
    public PairingRepository pairingRepository(DynamoDbClient client) {
        return new DynamoDbPairingRepository(client);
    }

    @Bean
    public PairingService pairingService(PairingRepository pairingRepository) {
        return new PairingService(pairingRepository);
    }

    @Bean
    public ClipboardRepository clipboardRepository(DynamoDbClient client) {
        return new DynamoDbClipboardRepository(client);
    }
}
