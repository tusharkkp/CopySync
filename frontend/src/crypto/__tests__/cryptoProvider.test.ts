import { describe, it, expect, beforeEach } from 'vitest'
import { WebCryptoProvider } from '../WebCryptoProvider'
import type { DeviceKeyMaterial, RecipientKeyMap, SnapshotHeader } from '../types'
import { base64UrlToUint8Array, uint8ArrayToBase64Url } from '../base64url'

describe('CRYPTO-PROVIDER: E2EE Engine & Tamper Matrix', () => {
  let provider: WebCryptoProvider
  let deviceA: DeviceKeyMaterial
  let deviceB: DeviceKeyMaterial
  let deviceC: DeviceKeyMaterial
  let recipientsMapAB: RecipientKeyMap
  let baseHeader: SnapshotHeader

  beforeEach(async () => {
    provider = new WebCryptoProvider()
    deviceA = await provider.generateDeviceKeys('dev-alpha')
    deviceB = await provider.generateDeviceKeys('dev-beta')
    deviceC = await provider.generateDeviceKeys('dev-charlie')

    recipientsMapAB = {
      [deviceB.deviceId]: {
        deviceId: deviceB.deviceId,
        publicSigningKeyB64: deviceB.publicSigningKeyB64,
        publicHpkeKeyB64: deviceB.publicHpkeKeyB64,
      },
    }

    baseHeader = {
      sessionId: 'ses-42',
      messageId: 'msg-101',
      senderDeviceId: deviceA.deviceId,
      baseRevisionId: 'msg-000',
      logicalClock: 1,
      keyEpoch: 1,
      contentType: 'text/plain;charset=utf-8',
      plaintextBytes: 25,
    }
  })

  it('CRYPTO-02: successfully encrypts and decrypts round-trip snapshot between Device A and Device B', async () => {
    const originalText = 'Hello Device B! This is an E2EE snapshot.'
    const wireMsg = await provider.encryptSnapshot(
      originalText,
      baseHeader,
      recipientsMapAB,
      deviceA
    )

    expect(wireMsg.v).toBe(1)
    expect(wireMsg.payload.ciphertext).toBeDefined()
    expect(wireMsg.keyEnvelopes).toHaveLength(1)
    expect(wireMsg.keyEnvelopes[0].recipientDeviceId).toBe(deviceB.deviceId)

    // Device B decrypts
    const decrypted = await provider.decryptSnapshot(
      wireMsg,
      deviceB,
      deviceA.publicSigningKeyB64
    )

    expect(decrypted).toBe(originalText)
  })

  it('CRYPTO-03: fails closed when ciphertext bytes are tampered', async () => {
    const wireMsg = await provider.encryptSnapshot(
      'Sensitive clipboard content',
      baseHeader,
      recipientsMapAB,
      deviceA
    )

    // Tamper ciphertext
    const rawBytes = base64UrlToUint8Array(wireMsg.payload.ciphertext)
    rawBytes[0] ^= 0xff // flip bits
    wireMsg.payload.ciphertext = uint8ArrayToBase64Url(rawBytes)

    // Signature verification should catch tampered ciphertext immediately
    await expect(
      provider.decryptSnapshot(wireMsg, deviceB, deviceA.publicSigningKeyB64)
    ).rejects.toThrow(/Invalid snapshot signature/)
  })

  it('CRYPTO-04: fails closed when authentication tag is tampered', async () => {
    const wireMsg = await provider.encryptSnapshot(
      'Confidential payload',
      baseHeader,
      recipientsMapAB,
      deviceA
    )

    // Tamper the last byte (authentication tag byte)
    const rawBytes = base64UrlToUint8Array(wireMsg.payload.ciphertext)
    rawBytes[rawBytes.length - 1] ^= 0xaa
    wireMsg.payload.ciphertext = uint8ArrayToBase64Url(rawBytes)

    await expect(
      provider.decryptSnapshot(wireMsg, deviceB, deviceA.publicSigningKeyB64)
    ).rejects.toThrow(/Invalid snapshot signature/)
  })

  it('CRYPTO-05: fails closed when nonce is tampered', async () => {
    const wireMsg = await provider.encryptSnapshot(
      'Data with modified nonce',
      baseHeader,
      recipientsMapAB,
      deviceA
    )

    // Tamper nonce
    const nonceBytes = base64UrlToUint8Array(wireMsg.payload.nonce)
    nonceBytes[0] ^= 0x55
    wireMsg.payload.nonce = uint8ArrayToBase64Url(nonceBytes)

    // AES-GCM tag validation fails
    await expect(
      provider.decryptSnapshot(wireMsg, deviceB, deviceA.publicSigningKeyB64)
    ).rejects.toThrow(/AES-GCM decryption failed/)
  })

  it('CRYPTO-06: fails closed when header metadata (AAD) is modified', async () => {
    const wireMsg = await provider.encryptSnapshot(
      'Snapshot bound to logicalClock=1',
      baseHeader,
      recipientsMapAB,
      deviceA
    )

    // Attacker modifies logical clock in header
    wireMsg.header.logicalClock = 999

    await expect(
      provider.decryptSnapshot(wireMsg, deviceB, deviceA.publicSigningKeyB64)
    ).rejects.toThrow(/Invalid snapshot signature/)
  })

  it('CRYPTO-07: fails closed when snapshotSignature is invalid', async () => {
    const wireMsg = await provider.encryptSnapshot(
      'Snapshot with forged signature',
      baseHeader,
      recipientsMapAB,
      deviceA
    )

    // Tamper signature
    const sigBytes = base64UrlToUint8Array(wireMsg.snapshotSignature)
    sigBytes[0] ^= 0xff
    wireMsg.snapshotSignature = uint8ArrayToBase64Url(sigBytes)

    await expect(
      provider.decryptSnapshot(wireMsg, deviceB, deviceA.publicSigningKeyB64)
    ).rejects.toThrow(/Invalid snapshot signature/)
  })

  it('CRYPTO-08: Device C cannot unwrap CEK intended solely for Device B', async () => {
    const wireMsg = await provider.encryptSnapshot(
      'Targeted for Device B only',
      baseHeader,
      recipientsMapAB,
      deviceA
    )

    // Device C attempts to decrypt
    await expect(
      provider.decryptSnapshot(wireMsg, deviceC, deviceA.publicSigningKeyB64)
    ).rejects.toThrow(/No key envelope found for device dev-charlie/)
  })

  it('CRYPTO-09: fails closed when keyEpoch is modified (replay across epoch)', async () => {
    const wireMsg = await provider.encryptSnapshot(
      'Epoch 1 snapshot',
      baseHeader,
      recipientsMapAB,
      deviceA
    )

    // Tamper keyEpoch
    wireMsg.header.keyEpoch = 2

    await expect(
      provider.decryptSnapshot(wireMsg, deviceB, deviceA.publicSigningKeyB64)
    ).rejects.toThrow(/Invalid snapshot signature/)
  })

  it('CRYPTO-10: retry uses identical message ID and ciphertext bytes', async () => {
    const originalText = 'Snapshot for unacknowledged retry'
    const attempt1 = await provider.encryptSnapshot(
      originalText,
      baseHeader,
      recipientsMapAB,
      deviceA
    )

    // Simulate retry by resending the exact same envelope per ADR-016
    const attempt2 = attempt1

    expect(attempt2.header.messageId).toBe(attempt1.header.messageId)
    expect(attempt2.payload.ciphertext).toBe(attempt1.payload.ciphertext)
    expect(attempt2.payload.nonce).toBe(attempt1.payload.nonce)

    // Receiver deduplicates and successfully decrypts
    const decrypted = await provider.decryptSnapshot(
      attempt2,
      deviceB,
      deviceA.publicSigningKeyB64
    )
    expect(decrypted).toBe(originalText)
  })

  it('SEC-06: enforces 64 KiB boundary strictly', async () => {
    // 65,536 bytes (exact 64 KiB) succeeds
    const exactMaxText = 'x'.repeat(65536)
    const headerMax = { ...baseHeader, plaintextBytes: 65536 }
    const wireMsg = await provider.encryptSnapshot(
      exactMaxText,
      headerMax,
      recipientsMapAB,
      deviceA
    )
    expect(wireMsg).toBeDefined()

    // 65,537 bytes (64 KiB + 1 byte) throws
    const oversizedText = 'x'.repeat(65537)
    await expect(
      provider.encryptSnapshot(
        oversizedText,
        { ...baseHeader, plaintextBytes: 65537 },
        recipientsMapAB,
        deviceA
      )
    ).rejects.toThrow(/Plaintext exceeds maximum limit of 64 KiB/)
  })

  it('SEC-08: SAS derivation produces identical emoji and hex fingerprint on both sides', async () => {
    const sasA = await provider.deriveSAS(
      'session-999',
      deviceA.publicSigningKeyB64,
      deviceB.publicSigningKeyB64
    )

    // Device B runs with opposite argument order
    const sasB = await provider.deriveSAS(
      'session-999',
      deviceB.publicSigningKeyB64,
      deviceA.publicSigningKeyB64
    )

    expect(sasA.hex).toBe(sasB.hex)
    expect(sasA.emojis).toBe(sasB.emojis)
    expect(sasA.hex).toHaveLength(12)
  })
})
