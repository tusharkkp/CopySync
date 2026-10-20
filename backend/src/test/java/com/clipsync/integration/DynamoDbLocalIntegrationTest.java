package com.clipsync.integration;

import com.clipsync.common.DynamoDbSchemaConstants;
import com.clipsync.connection.Connection;
import com.clipsync.connection.DynamoDbConnectionRepository;
import com.clipsync.pairing.DynamoDbPairingRepository;
import com.clipsync.pairing.PairingService;
import com.clipsync.pairing.PairingToken;
import com.clipsync.session.DynamoDbSessionRepository;
import com.clipsync.session.Session;
import com.clipsync.session.StorageMode;
import com.clipsync.storage.ClipboardSnapshot;
import com.clipsync.storage.DynamoDbClipboardRepository;
import org.junit.jupiter.api.*;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.*;

import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

@DisplayName("INTEGRATION: DynamoDB Local Repository Suite")
class DynamoDbLocalIntegrationTest {

    private static final String ENDPOINT = "http://localhost:8000";
    private static final String TEST_REGISTRY = "TestRegistry";
    private static final String TEST_CLIPBOARD = "TestClipboard";

    private static DynamoDbClient client;
    private static boolean dynamoAvailable = false;

    private DynamoDbSessionRepository sessionRepo;
    private DynamoDbConnectionRepository connectionRepo;
    private DynamoDbPairingRepository pairingRepo;
    private DynamoDbClipboardRepository clipboardRepo;
    private PairingService pairingService;

    @BeforeAll
    static void checkDynamoDbLocal() {
        try {
            client = DynamoDbClient.builder()
                .endpointOverride(URI.create(ENDPOINT))
                .region(Region.AP_SOUTH_1)
                .credentialsProvider(StaticCredentialsProvider.create(
                    AwsBasicCredentials.create("dummyKey", "dummySecret")
                ))
                .httpClientBuilder(UrlConnectionHttpClient.builder())
                .build();

            // Probe endpoint
            client.listTables(ListTablesRequest.builder().limit(1).build());
            dynamoAvailable = true;

            // Create test tables if not present
            createTestTable(TEST_REGISTRY);
            createTestTable(TEST_CLIPBOARD);
        } catch (Exception e) {
            dynamoAvailable = false;
        }
    }

    private static void createTestTable(String tableName) {
        try {
            client.createTable(CreateTableRequest.builder()
                .tableName(tableName)
                .keySchema(
                    KeySchemaElement.builder().attributeName(DynamoDbSchemaConstants.ATTR_PK).keyType(KeyType.HASH).build(),
                    KeySchemaElement.builder().attributeName(DynamoDbSchemaConstants.ATTR_SK).keyType(KeyType.RANGE).build()
                )
                .attributeDefinitions(
                    AttributeDefinition.builder().attributeName(DynamoDbSchemaConstants.ATTR_PK).attributeType(ScalarAttributeType.S).build(),
                    AttributeDefinition.builder().attributeName(DynamoDbSchemaConstants.ATTR_SK).attributeType(ScalarAttributeType.S).build()
                )
                .provisionedThroughput(ProvisionedThroughput.builder().readCapacityUnits(1L).writeCapacityUnits(1L).build())
                .build());
        } catch (ResourceInUseException ignored) {
            // Table already exists
        }
    }

    @BeforeEach
    void setUp() {
        Assumptions.assumeTrue(dynamoAvailable, "DynamoDB Local is not running on http://localhost:8000; skipping live integration tests.");
        sessionRepo = new DynamoDbSessionRepository(client, TEST_REGISTRY);
        connectionRepo = new DynamoDbConnectionRepository(client, TEST_REGISTRY);
        pairingRepo = new DynamoDbPairingRepository(client, TEST_REGISTRY);
        clipboardRepo = new DynamoDbClipboardRepository(client, TEST_CLIPBOARD);
        pairingService = new PairingService(pairingRepo);
    }

    @Test
    @DisplayName("DDB-01: Session creation and atomic epoch advancement on DynamoDB Local")
    void testSessionEpochAdvancement() {
        String sessionId = "sess-ddb-" + System.currentTimeMillis();
        Session session = Session.createDefault(sessionId, StorageMode.TEMPORARY);
        sessionRepo.save(session);

        Optional<Session> loaded = sessionRepo.findById(sessionId);
        assertThat(loaded).isPresent();
        assertThat(loaded.get().keyEpoch()).isEqualTo(1);

        Session advanced = sessionRepo.advanceKeyEpoch(sessionId);
        assertThat(advanced.keyEpoch()).isEqualTo(2);

        Session reloaded = sessionRepo.findById(sessionId).orElseThrow();
        assertThat(reloaded.keyEpoch()).isEqualTo(2);
    }

    @Test
    @DisplayName("DDB-02: DEC-008 Inverted connection mapping query on DynamoDB Local")
    void testConnectionInvertedLookup() {
        String connectionId = "conn-ddb-" + System.currentTimeMillis();
        String sessionId = "sess-ddb-conn";
        Connection conn = new Connection(connectionId, sessionId, "dev-test", Instant.now(), 0);

        connectionRepo.save(conn);

        Optional<Connection> byCid = connectionRepo.findByConnectionId(connectionId);
        assertThat(byCid).isPresent();
        assertThat(byCid.get().sessionId()).isEqualTo(sessionId);

        List<Connection> peers = connectionRepo.findActiveBySessionId(sessionId);
        assertThat(peers).isNotEmpty();

        connectionRepo.remove(connectionId);
        assertThat(connectionRepo.findByConnectionId(connectionId)).isEmpty();
    }

    @Test
    @DisplayName("DDB-03: Real DynamoDB conditional write prevents double-consumption of pairing token")
    void testDynamoDbConditionalCheckSingleUse() {
        String sessionId = "sess-ddb-pairing-" + System.currentTimeMillis();
        String rawToken = "889900";

        pairingService.createPairingToken(sessionId, "dev-init", rawToken, Duration.ofMinutes(5));

        boolean first = pairingService.verifyAndConsumeToken(sessionId, rawToken);
        assertThat(first).isTrue();

        // Second consumption triggers DynamoDB ConditionalCheckFailedException -> returns false
        boolean second = pairingService.verifyAndConsumeToken(sessionId, rawToken);
        assertThat(second).isFalse();
    }

    @Test
    @DisplayName("DDB-04: Clipboard snapshot persistence and logical clock sorting on DynamoDB Local")
    void testClipboardSnapshotSorting() {
        String sessionId = "sess-ddb-clip-" + System.currentTimeMillis();
        Session session = Session.createDefault(sessionId, StorageMode.TEMPORARY);

        ClipboardSnapshot snap1 = new ClipboardSnapshot(
            sessionId, "msg-001", "dev-1", 1L, "msg-000", 1,
            "text/plain", 10, "cipher1", "nonce1", "sig1", "[]",
            Instant.now(), Instant.now().plusSeconds(600), 0
        );

        ClipboardSnapshot snap2 = new ClipboardSnapshot(
            sessionId, "msg-002", "dev-1", 2L, "msg-001", 1,
            "text/plain", 15, "cipher2", "nonce2", "sig2", "[]",
            Instant.now(), Instant.now().plusSeconds(600), 0
        );

        clipboardRepo.save(session, snap1);
        clipboardRepo.save(session, snap2);

        Optional<ClipboardSnapshot> latest = clipboardRepo.findLatest(session);
        assertThat(latest).isPresent();
        assertThat(latest.get().logicalClock()).isEqualTo(2L);
        assertThat(latest.get().messageId()).isEqualTo("msg-002");
    }
}
