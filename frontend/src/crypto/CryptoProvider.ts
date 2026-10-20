import {
  SnapshotHeader,
  WireMessage,
  DeviceKeyMaterial,
  RecipientKeyMap,
} from './types'

export interface CryptoProvider {
  /**
   * Generates separate ECDSA P-256 signing and HPKE P-256 recipient keypairs.
   */
  generateDeviceKeys(deviceId: string): Promise<DeviceKeyMaterial>

  /**
   * Encrypts a plaintext snapshot (<= 64 KiB) using a fresh CEK, binds the canonical
   * header as AES-GCM AAD, signs with ECDSA P-256, and wraps the CEK for each recipient using HPKE.
   */
  encryptSnapshot(
    plaintext: string,
    header: SnapshotHeader,
    recipients: RecipientKeyMap,
    senderKeys: DeviceKeyMaterial,
    action?: string,
    requestId?: string
  ): Promise<WireMessage>

  /**
   * Validates sender signature, finds recipient envelope, decapsulates CEK via HPKE,
   * verifies AES-GCM authentication tag, and decrypts snapshot.
   * Fails closed on any signature/tag/AAD mismatch.
   */
  decryptSnapshot(
    message: WireMessage,
    recipientKeys: DeviceKeyMaterial,
    senderPublicSigningKeyB64: string
  ): Promise<string>

  /**
   * Derives Short Authentication String (SAS) for out-of-band pairing verification.
   */
  deriveSAS(
    sessionId: string,
    deviceAPubKey: string,
    deviceBPubKey: string
  ): Promise<{ hex: string; emojis: string }>
}
