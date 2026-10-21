package com.clipsync.transport.validation;

public final class ProtocolErrorCode {

    private ProtocolErrorCode() {}

    public static final String INVALID_VERSION = "INVALID_VERSION";
    public static final String UNKNOWN_ACTION = "UNKNOWN_ACTION";
    public static final String MALFORMED_JSON = "MALFORMED_JSON";
    public static final String PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE";
    public static final String MISSING_PARAMETER = "MISSING_PARAMETER";
    public static final String UNAUTHORIZED = "UNAUTHORIZED";
    public static final String SESSION_NOT_FOUND = "SESSION_NOT_FOUND";
    public static final String SESSION_LOCKED_OUT = "SESSION_LOCKED_OUT";
    public static final String INVALID_PAIRING_CODE = "INVALID_PAIRING_CODE";
    public static final String DEVICE_NOT_FOUND = "DEVICE_NOT_FOUND";
    public static final String DEVICE_REVOKED = "DEVICE_REVOKED";
    public static final String INTERNAL_SERVER_ERROR = "INTERNAL_SERVER_ERROR";
}
