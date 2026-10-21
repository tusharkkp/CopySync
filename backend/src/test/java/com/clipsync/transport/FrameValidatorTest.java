package com.clipsync.transport;

import com.clipsync.transport.dto.WebSocketFrame;
import com.clipsync.transport.validation.FrameValidator;
import com.clipsync.transport.validation.ProtocolErrorCode;
import com.clipsync.transport.validation.ValidationException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@DisplayName("TRANSPORT: Frame Validation & Protocol Guardrails")
class FrameValidatorTest {

    private FrameValidator validator;

    @BeforeEach
    void setUp() {
        validator = new FrameValidator();
    }

    @Test
    @DisplayName("SEC-W1: Version must be exactly 1; reject unknown or missing version")
    void testVersionValidation() {
        // Missing / 0 version
        String invalidVersionJson = """
            {
              "v": 2,
              "action": "session.create",
              "requestId": "req-01"
            }
            """;

        assertThatThrownBy(() -> validator.validateJson(invalidVersionJson))
            .isInstanceOf(ValidationException.class)
            .hasFieldOrPropertyWithValue("errorCode", ProtocolErrorCode.INVALID_VERSION);
    }

    @Test
    @DisplayName("SEC-W2: Action must be in recognized whitelist; reject unknown action")
    void testActionWhitelist() {
        String unknownActionJson = """
            {
              "v": 1,
              "action": "admin.dropAllTables",
              "requestId": "req-02"
            }
            """;

        assertThatThrownBy(() -> validator.validateJson(unknownActionJson))
            .isInstanceOf(ValidationException.class)
            .hasFieldOrPropertyWithValue("errorCode", ProtocolErrorCode.UNKNOWN_ACTION);
    }

    @Test
    @DisplayName("SEC-W3: Frame size exceeding 32 KiB API Gateway limit is rejected")
    void testFrameSizeLimit() {
        // Create payload larger than 32 KiB (32768 bytes)
        String largePadding = "A".repeat(33000);
        String largeFrame = """
            {
              "v": 1,
              "action": "clipboard.update",
              "requestId": "req-03",
              "payload": "%s"
            }
            """.formatted(largePadding);

        assertThatThrownBy(() -> validator.validateJson(largeFrame))
            .isInstanceOf(ValidationException.class)
            .hasFieldOrPropertyWithValue("errorCode", ProtocolErrorCode.PAYLOAD_TOO_LARGE);
    }

    @Test
    @DisplayName("SEC-W4: Malformed or unparseable JSON is rejected with MALFORMED_JSON")
    void testMalformedJson() {
        String brokenJson = "{ this is not json }";

        assertThatThrownBy(() -> validator.validateJson(brokenJson))
            .isInstanceOf(ValidationException.class)
            .hasFieldOrPropertyWithValue("errorCode", ProtocolErrorCode.MALFORMED_JSON);
    }

    @Test
    @DisplayName("Valid frame parses cleanly into WebSocketFrame record")
    void testValidFrame() {
        String validJson = """
            {
              "v": 1,
              "action": "session.create",
              "requestId": "req-99",
              "sessionId": "sess-alpha",
              "deviceId": "dev-01"
            }
            """;

        WebSocketFrame frame = validator.validateJson(validJson);
        assertThat(frame.v()).isEqualTo(1);
        assertThat(frame.action()).isEqualTo("session.create");
        assertThat(frame.requestId()).isEqualTo("req-99");
        assertThat(frame.sessionId()).isEqualTo("sess-alpha");
        assertThat(frame.deviceId()).isEqualTo("dev-01");
    }

    @Test
    @DisplayName("Recognizes session.close and sync.resume actions as valid")
    void testPhase7Actions() {
        String closeJson = """
            {
              "v": 1,
              "action": "session.close",
              "requestId": "req-close",
              "sessionId": "sess-alpha"
            }
            """;
        WebSocketFrame closeFrame = validator.validateJson(closeJson);
        assertThat(closeFrame.action()).isEqualTo("session.close");

        String resumeJson = """
            {
              "v": 1,
              "action": "sync.resume",
              "requestId": "req-resume",
              "sessionId": "sess-alpha"
            }
            """;
        WebSocketFrame resumeFrame = validator.validateJson(resumeJson);
        assertThat(resumeFrame.action()).isEqualTo("sync.resume");
    }

    @Test
    @DisplayName("Recognizes device.revoke action as valid")
    void testPhase8Actions() {
        String revokeJson = """
            {
              "v": 1,
              "action": "device.revoke",
              "requestId": "req-rev",
              "sessionId": "sess-alpha",
              "deviceId": "dev-01",
              "targetDeviceId": "dev-02"
            }
            """;
        WebSocketFrame revokeFrame = validator.validateJson(revokeJson);
        assertThat(revokeFrame.action()).isEqualTo("device.revoke");
        assertThat(revokeFrame.targetDeviceId()).isEqualTo("dev-02");
    }
}
