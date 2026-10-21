/**
 * ClipSync System Configuration Constants
 * Pinned per ADR-004, ADR-014, ADR-016, ADR-017, and DEC-011.
 */

export const SYNC_CONFIG = {
  /** Maximum plaintext snapshot size allowed in UTF-8 bytes (64 KiB) */
  MAX_PLAIN_TEXT_BYTES: 64 * 1024,

  /** Debounce delay for normal typing events before triggering sync (ms) */
  TYPING_DEBOUNCE_MS: 250,

  /** Maximum interval before an update is forced during continuous typing (ms) */
  MAX_UPDATE_INTERVAL_MS: 1000,

  /** Expiry lifetime for pairing invitation tokens (5 minutes) */
  PAIRING_INVITATION_EXPIRY_MS: 5 * 60 * 1000,

  /** Expiry lifetime for temporary storage mode (10 minutes) */
  TEMPORARY_STORAGE_EXPIRY_MS: 10 * 60 * 1000,

  /** Default clipboard history retention period (30 days) */
  DEFAULT_HISTORY_RETENTION_MS: 30 * 24 * 60 * 60 * 1000,

  /** Heartbeat ping interval to maintain WebSocket liveness (4 minutes, under 10m idle) */
  HEARTBEAT_INTERVAL_MS: 4 * 60 * 1000,

  /** Delivery acknowledgement timeout before retrying (ms) */
  ACK_TIMEOUT_MS: 3000,

  /** Maximum retry attempts for unacknowledged updates */
  MAX_RETRY_ATTEMPTS: 3,

  /** Base delay for exponential backoff (ms) */
  RETRY_BACKOFF_BASE_MS: 500,

  /** Maximum retry backoff ceiling (ms) */
  RETRY_BACKOFF_MAX_MS: 4000,

  /** Target chunk size for WebSocket frame fragmentation (16 KiB, under 32 KiB frame limit) */
  CHUNK_TARGET_SIZE_BYTES: 16 * 1024,

  /** Sliding reassembly expiration window for chunked messages (30 seconds) */
  CHUNK_REASSEMBLY_WINDOW_MS: 30 * 1000,

  /** Public STUN servers for WebRTC ICE candidate gathering (DEC-010) */
  STUN_SERVERS: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ] as RTCIceServer[],

  /** WebRTC direct connection negotiation timeout before falling back to relay (10 seconds) */
  WEBRTC_CONNECT_TIMEOUT_MS: 10 * 1000,
} as const

export type SyncConfig = typeof SYNC_CONFIG
