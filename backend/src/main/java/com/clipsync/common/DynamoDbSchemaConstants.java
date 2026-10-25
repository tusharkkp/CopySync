package com.clipsync.common;

/**
 * DynamoDB schema constants for Single-Table Design across ClipSyncRegistry and ClipSyncClipboard.
 * Conforms to ADR-013 and DEC-008 (GSI elimination).
 */
public final class DynamoDbSchemaConstants {

    private DynamoDbSchemaConstants() {}

    public static final String REGISTRY_TABLE_NAME = "ClipSyncRegistry";
    public static final String CLIPBOARD_TABLE_NAME = "ClipSyncClipboard";

    // Primary Key Attribute Names
    public static final String ATTR_PK = "PK";
    public static final String ATTR_SK = "SK";

    // PK Prefixes
    public static final String PK_SESSION_PREFIX = "SESSION#";
    public static final String PK_CONNECTION_PREFIX = "CONNECTION#";
    public static final String PK_IP_PREFIX = "IP#";

    // SK Prefixes & Constants
    public static final String SK_METADATA = "METADATA";
    public static final String SK_DEVICE_PREFIX = "DEVICE#";
    public static final String SK_CONNECTION_PREFIX = "CONNECTION#";
    public static final String SK_PAIRING_PREFIX = "PAIRING#";
    public static final String SK_ITEM_PREFIX = "ITEM#";
    public static final String SK_IP_DISCOVERY = "DISCOVERY";

    // Common Attributes
    public static final String ATTR_SESSION_ID = "sessionId";
    public static final String ATTR_DEVICE_ID = "deviceId";
    public static final String ATTR_CONNECTION_ID = "connectionId";
    public static final String ATTR_STORAGE_MODE = "storageMode";
    public static final String ATTR_RETENTION_DAYS = "retentionDays";
    public static final String ATTR_KEY_EPOCH = "keyEpoch";
    public static final String ATTR_STATUS = "status";
    public static final String ATTR_CREATED_AT = "createdAt";
    public static final String ATTR_JOINED_AT = "joinedAt";
    public static final String ATTR_CONNECTED_AT = "connectedAt";
    public static final String ATTR_EXPIRES_AT = "expiresAt";
    public static final String ATTR_TTL = "ttl";

    // Device Attributes
    public static final String ATTR_PUBLIC_SIGNING_KEY = "publicSigningKeyB64";
    public static final String ATTR_PUBLIC_HPKE_KEY = "publicHpkeKeyB64";
    public static final String ATTR_DEVICE_ROLE = "role";
    public static final String ATTR_DEVICE_NAME = "deviceName";

    // Pairing Attributes
    public static final String ATTR_INITIATOR_DEVICE_ID = "initiatorDeviceId";
    public static final String ATTR_TOKEN_HASH = "tokenHash";
    public static final String ATTR_ATTEMPT_COUNT = "attemptCount";
    public static final String ATTR_CONSUMED = "consumed";
    public static final String ATTR_AUTO_PAIRING_TOKEN = "autoPairingToken";

    // Clipboard Attributes
    public static final String ATTR_MESSAGE_ID = "messageId";
    public static final String ATTR_SENDER_DEVICE_ID = "senderDeviceId";
    public static final String ATTR_LOGICAL_CLOCK = "logicalClock";
    public static final String ATTR_BASE_REVISION_ID = "baseRevisionId";
    public static final String ATTR_CONTENT_TYPE = "contentType";
    public static final String ATTR_PLAINTEXT_BYTES = "plaintextBytes";
    public static final String ATTR_PAYLOAD_CIPHERTEXT = "payloadCiphertext";
    public static final String ATTR_PAYLOAD_NONCE = "payloadNonce";
    public static final String ATTR_SNAPSHOT_SIGNATURE = "snapshotSignature";
    public static final String ATTR_KEY_ENVELOPES_JSON = "keyEnvelopesJson";
}
