/**
 * ClipSync Cryptographic and Wire Protocol Type Definitions (Protocol v1)
 */

export interface SnapshotHeader {
  sessionId: string
  messageId: string
  senderDeviceId: string
  baseRevisionId: string
  logicalClock: number
  keyEpoch: number
  contentType: string
  plaintextBytes: number
}

export interface EncryptedPayload {
  algorithm: 'A256GCM'
  /** 12-byte (96-bit) CSPRNG nonce encoded as base64url */
  nonce: string
  /** Ciphertext concatenated with 16-byte authentication tag encoded as base64url */
  ciphertext: string
}

export interface KeyEnvelope {
  recipientDeviceId: string
  suite: 'HPKE-v1-P256-HKDF-SHA256-A256GCM'
  /** HPKE encapsulated ephemeral public key encoded as base64url */
  enc: string
  /** Wrapped 32-byte CEK encoded as base64url */
  wrappedCek: string
  /** ECDSA P-256 signature over canonical envelope encoded as base64url */
  signature: string
}

export interface WireMessage {
  v: 1
  action: string
  requestId: string
  header: SnapshotHeader
  payload: EncryptedPayload
  /** ECDSA P-256 signature over SHA-256(canonicalHeader || ciphertext) */
  snapshotSignature: string
  keyEnvelopes: KeyEnvelope[]
}

export interface DeviceKeyMaterial {
  deviceId: string
  /** ECDSA P-256 Signing Keypair */
  signingKeyPair: CryptoKeyPair
  /** Exported public signing key in SPKI or JWK format (base64url) */
  publicSigningKeyB64: string

  /** HPKE P-256 Keypair */
  hpkeKeyPair: CryptoKeyPair
  /** Exported raw or SPKI public HPKE key (base64url) */
  publicHpkeKeyB64: string
}

export interface PeerPublicKey {
  deviceId: string
  publicSigningKeyB64: string
  publicHpkeKeyB64: string
}

export type RecipientKeyMap = Record<string, PeerPublicKey>
