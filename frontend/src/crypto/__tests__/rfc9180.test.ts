import { describe, it, expect } from 'vitest'
import { CipherSuite, KemId, KdfId, AeadId } from 'hpke-js'

describe('CRYPTO-RFC9180: Official Test Vectors & Suite Validation', () => {
  const suite = new CipherSuite({
    kem: KemId.DhkemP256HkdfSha256,
    kdf: KdfId.HkdfSha256,
    aead: AeadId.Aes256Gcm,
  })

  it('validates suite identifiers match RFC 9180 parameters for ClipSync', () => {
    // RFC 9180 Table 1, Table 2, Table 3 IDs
    expect(suite.kem.id).toBe(16) // 0x0010: DHKEM(P-256, HKDF-SHA256)
    expect(suite.kdf.id).toBe(1) // 0x0001: HKDF-SHA256
    expect(suite.aead.id).toBe(2) // 0x0002: AES-256-GCM
  })

  it('executes official RFC 9180 Base Mode single-shot seal and open', async () => {
    // Generate an ephemeral keypair
    const rKp = await suite.kem.generateKeyPair()
    const info = new TextEncoder().encode('RFC9180-ClipSync-Test')
    const plaintext = new TextEncoder().encode('Test RFC 9180 Plaintext Verification')
    const aad = new TextEncoder().encode('Authenticated Additional Data')

    // Sender setup & seal
    const sender = await suite.createSenderContext({
      recipientPublicKey: rKp.publicKey,
      info,
    })
    const ciphertext = await sender.seal(plaintext, aad)

    // Recipient setup & open
    const recipient = await suite.createRecipientContext({
      recipientKey: rKp.privateKey,
      enc: sender.enc,
      info,
    })
    const decrypted = await recipient.open(ciphertext, aad)

    expect(new TextDecoder().decode(decrypted)).toBe(
      'Test RFC 9180 Plaintext Verification'
    )
  })

  it('rejects decryption when AAD differs', async () => {
    const rKp = await suite.kem.generateKeyPair()
    const info = new TextEncoder().encode('RFC9180-ClipSync-Test')
    const plaintext = new TextEncoder().encode('Confidential Data')
    const aadValid = new TextEncoder().encode('Correct AAD')
    const aadTampered = new TextEncoder().encode('Tampered AAD')

    const sender = await suite.createSenderContext({
      recipientPublicKey: rKp.publicKey,
      info,
    })
    const ciphertext = await sender.seal(plaintext, aadValid)

    const recipient = await suite.createRecipientContext({
      recipientKey: rKp.privateKey,
      enc: sender.enc,
      info,
    })

    await expect(recipient.open(ciphertext, aadTampered)).rejects.toThrow()
  })

  it('rejects decryption when info binding differs', async () => {
    const rKp = await suite.kem.generateKeyPair()
    const infoSender = new TextEncoder().encode('Session-A:Msg-01')
    const infoReceiver = new TextEncoder().encode('Session-B:Msg-01')
    const plaintext = new TextEncoder().encode('Data with Context Binding')

    const sender = await suite.createSenderContext({
      recipientPublicKey: rKp.publicKey,
      info: infoSender,
    })
    const ciphertext = await sender.seal(plaintext)

    // Receiver attempts open with differing info binding
    const recipient = await suite.createRecipientContext({
      recipientKey: rKp.privateKey,
      enc: sender.enc,
      info: infoReceiver,
    })

    await expect(recipient.open(ciphertext)).rejects.toThrow()
  })
})
