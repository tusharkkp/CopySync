import { CipherSuite, KemId, KdfId, AeadId } from 'hpke-js'
import type { CryptoProvider } from './CryptoProvider'
import type {
  SnapshotHeader,
  WireMessage,
  DeviceKeyMaterial,
  RecipientKeyMap,
  KeyEnvelope,
} from './types'
import { canonicalizeToBytes } from './canonicalize'
import {
  uint8ArrayToBase64Url,
  base64UrlToUint8Array,
  uint8ArrayToHex,
} from './base64url'

const EMOJI_LIST = [
  '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼',
  '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔',
  '🐧', '🐦', '🐤', '🦆', '🦅', '🦉', '🦇', '🐺',
  '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞',
]

export class WebCryptoProvider implements CryptoProvider {
  private suite: CipherSuite

  constructor() {
    this.suite = new CipherSuite({
      kem: KemId.DhkemP256HkdfSha256,
      kdf: KdfId.HkdfSha256,
      aead: AeadId.Aes256Gcm,
    })
  }

  async generateDeviceKeys(deviceId: string): Promise<DeviceKeyMaterial> {
    // 1. Generate ECDSA P-256 Identity Signing Keypair
    const signingKeyPair = await crypto.subtle.generateKey(
      {
        name: 'ECDSA',
        namedCurve: 'P-256',
      },
      true,
      ['sign', 'verify']
    )

    const rawSigningPub = await crypto.subtle.exportKey(
      'spki',
      signingKeyPair.publicKey
    )
    const publicSigningKeyB64 = uint8ArrayToBase64Url(
      new Uint8Array(rawSigningPub)
    )

    // 2. Generate HPKE P-256 Recipient Keypair
    const hpkeKeyPair = await this.suite.kem.generateKeyPair()
    const rawHpkePub = await this.suite.kem.serializePublicKey(
      hpkeKeyPair.publicKey
    )
    const publicHpkeKeyB64 = uint8ArrayToBase64Url(
      new Uint8Array(rawHpkePub)
    )

    return {
      deviceId,
      signingKeyPair,
      publicSigningKeyB64,
      hpkeKeyPair,
      publicHpkeKeyB64,
    }
  }

  async encryptSnapshot(
    plaintext: string,
    header: SnapshotHeader,
    recipients: RecipientKeyMap,
    senderKeys: DeviceKeyMaterial,
    action = 'clipboard.update',
    requestId = `req-${crypto.randomUUID()}`
  ): Promise<WireMessage> {
    const plaintextBytes = new TextEncoder().encode(plaintext)
    if (plaintextBytes.byteLength > 65536) {
      throw new Error(`Plaintext exceeds maximum limit of 64 KiB (${plaintextBytes.byteLength} bytes)`)
    }

    // 1. Generate fresh 32-byte CEK and 12-byte Nonce
    const cekBytes = crypto.getRandomValues(new Uint8Array(32))
    const nonceBytes = crypto.getRandomValues(new Uint8Array(12))

    // 2. Canonicalize header as AES-GCM AAD
    const headerAAD = canonicalizeToBytes(header)

    // 3. Encrypt Plaintext via AES-256-GCM
    const cekKey = await crypto.subtle.importKey(
      'raw',
      cekBytes,
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    )

    const encryptedBuffer = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: nonceBytes as unknown as BufferSource,
        additionalData: headerAAD as unknown as BufferSource,
        tagLength: 128,
      },
      cekKey,
      plaintextBytes as unknown as BufferSource
    )

    const ciphertextBytes = new Uint8Array(encryptedBuffer)
    const ciphertextB64 = uint8ArrayToBase64Url(ciphertextBytes)
    const nonceB64 = uint8ArrayToBase64Url(nonceBytes)

    // 4. Wrap CEK for each authorized recipient using HPKE Base Mode
    const keyEnvelopes: KeyEnvelope[] = []

    for (const recipientId of Object.keys(recipients)) {
      const recipient = recipients[recipientId]
      const recipientPubRaw = base64UrlToUint8Array(recipient.publicHpkeKeyB64)
      const recipientPubKey = await this.suite.kem.deserializePublicKey(
        recipientPubRaw
      )

      // Context binding: messageId || recipientDeviceId || sessionId || keyEpoch
      const infoBinding = new TextEncoder().encode(
        `${header.messageId}:${recipient.deviceId}:${header.sessionId}:${header.keyEpoch}`
      )

      const senderContext = await this.suite.createSenderContext({
        recipientPublicKey: recipientPubKey,
        info: infoBinding,
      })

      const wrappedCekBytes = await senderContext.seal(cekBytes)
      const encB64 = uint8ArrayToBase64Url(new Uint8Array(senderContext.enc))
      const wrappedCekB64 = uint8ArrayToBase64Url(
        new Uint8Array(wrappedCekBytes)
      )

      // Sign the envelope metadata with sender signing key
      const envelopeToSign = canonicalizeToBytes({
        recipientDeviceId: recipient.deviceId,
        suite: 'HPKE-v1-P256-HKDF-SHA256-A256GCM',
        enc: encB64,
        wrappedCek: wrappedCekB64,
      })

      const envelopeSigBuffer = await crypto.subtle.sign(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        senderKeys.signingKeyPair.privateKey,
        envelopeToSign as unknown as BufferSource
      )

      keyEnvelopes.push({
        recipientDeviceId: recipient.deviceId,
        suite: 'HPKE-v1-P256-HKDF-SHA256-A256GCM',
        enc: encB64,
        wrappedCek: wrappedCekB64,
        signature: uint8ArrayToBase64Url(new Uint8Array(envelopeSigBuffer)),
      })
    }

    // 5. Sign the snapshot (header + ciphertext) with sender's identity key
    const payloadToSign = new Uint8Array(
      headerAAD.byteLength + ciphertextBytes.byteLength
    )
    payloadToSign.set(headerAAD, 0)
    payloadToSign.set(ciphertextBytes, headerAAD.byteLength)

    const snapshotSigBuffer = await crypto.subtle.sign(
      { name: 'ECDSA', hash: { name: 'SHA-256' } },
      senderKeys.signingKeyPair.privateKey,
      payloadToSign
    )

    return {
      v: 1,
      action,
      requestId,
      header,
      payload: {
        algorithm: 'A256GCM',
        nonce: nonceB64,
        ciphertext: ciphertextB64,
      },
      snapshotSignature: uint8ArrayToBase64Url(
        new Uint8Array(snapshotSigBuffer)
      ),
      keyEnvelopes,
    }
  }

  async decryptSnapshot(
    message: WireMessage,
    recipientKeys: DeviceKeyMaterial,
    senderPublicSigningKeyB64: string
  ): Promise<string> {
    if (message.v !== 1) {
      throw new Error(`Unsupported protocol version: ${message.v}`)
    }

    // 1. Import sender's public signing key
    const senderPubSpki = base64UrlToUint8Array(senderPublicSigningKeyB64)
    const senderSigningKey = await crypto.subtle.importKey(
      'spki',
      senderPubSpki as unknown as BufferSource,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    )

    // 2. Verify snapshot signature over (canonicalHeader || ciphertext)
    const headerAAD = canonicalizeToBytes(message.header)
    const ciphertextBytes = base64UrlToUint8Array(message.payload.ciphertext)
    const payloadToVerify = new Uint8Array(
      headerAAD.byteLength + ciphertextBytes.byteLength
    )
    payloadToVerify.set(headerAAD, 0)
    payloadToVerify.set(ciphertextBytes, headerAAD.byteLength)

    const isSnapshotSigValid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: { name: 'SHA-256' } },
      senderSigningKey,
      base64UrlToUint8Array(message.snapshotSignature) as unknown as BufferSource,
      payloadToVerify as unknown as BufferSource
    )

    if (!isSnapshotSigValid) {
      throw new Error('SEC-03: Invalid snapshot signature (tampered payload or header)')
    }

    // 3. Find key envelope for recipient device
    const envelope = message.keyEnvelopes.find(
      (e) => e.recipientDeviceId === recipientKeys.deviceId
    )
    if (!envelope) {
      throw new Error(`SEC-03: No key envelope found for device ${recipientKeys.deviceId}`)
    }

    // 4. Verify envelope signature
    const envelopeToVerify = canonicalizeToBytes({
      recipientDeviceId: envelope.recipientDeviceId,
      suite: envelope.suite,
      enc: envelope.enc,
      wrappedCek: envelope.wrappedCek,
    })

    const isEnvelopeSigValid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: { name: 'SHA-256' } },
      senderSigningKey,
      base64UrlToUint8Array(envelope.signature) as unknown as BufferSource,
      envelopeToVerify as unknown as BufferSource
    )

    if (!isEnvelopeSigValid) {
      throw new Error('SEC-03: Invalid key envelope signature')
    }

    // 5. Open HPKE wrapped CEK with context binding
    const infoBinding = new TextEncoder().encode(
      `${message.header.messageId}:${recipientKeys.deviceId}:${message.header.sessionId}:${message.header.keyEpoch}`
    )

    let cekBytes: ArrayBuffer
    try {
      const recipientContext = await this.suite.createRecipientContext({
        recipientKey: recipientKeys.hpkeKeyPair.privateKey,
        enc: base64UrlToUint8Array(envelope.enc),
        info: infoBinding,
      })

      cekBytes = await recipientContext.open(
        base64UrlToUint8Array(envelope.wrappedCek)
      )
    } catch {
      throw new Error('CRYPTO-04: HPKE key decapsulation failed (wrong key, epoch, or tampered envelope)')
    }

    // 6. Decrypt ciphertext with AES-256-GCM using unwrapped CEK
    const cekKey = await crypto.subtle.importKey(
      'raw',
      cekBytes,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    )

    const nonceBytes = base64UrlToUint8Array(message.payload.nonce)

    let decryptedBuffer: ArrayBuffer
    try {
      decryptedBuffer = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: nonceBytes as unknown as BufferSource,
          additionalData: headerAAD as unknown as BufferSource,
          tagLength: 128,
        },
        cekKey,
        ciphertextBytes as unknown as BufferSource
      )
    } catch {
      throw new Error('CRYPTO-03: AES-GCM decryption failed (ciphertext, nonce, or tag tampered)')
    }

    return new TextDecoder('utf-8').decode(decryptedBuffer)
  }

  async deriveSAS(
    sessionId: string,
    deviceAPubKey: string,
    deviceBPubKey: string
  ): Promise<{ hex: string; emojis: string }> {
    // Sort keys deterministically
    const sortedKeys = [deviceAPubKey, deviceBPubKey].sort()
    const transcript = new TextEncoder().encode(
      `${sessionId}:${sortedKeys[0]}:${sortedKeys[1]}`
    )

    // Compute SHA-256 of transcript
    const digest = await crypto.subtle.digest('SHA-256', transcript)
    const digestBytes = new Uint8Array(digest)

    // 12-char hex string
    const hex = uint8ArrayToHex(digestBytes.slice(0, 6)).toUpperCase()

    // 6 emoji pairs
    const emojis = Array.from(digestBytes.slice(0, 6))
      .map((b) => EMOJI_LIST[b % EMOJI_LIST.length])
      .join(' ')

    return { hex, emojis }
  }
}
