import React, { useState, useEffect } from 'react'
import { WebCryptoProvider } from '../crypto/WebCryptoProvider'
import { DeviceKeyMaterial, WireMessage } from '../crypto/types'
import { base64UrlToUint8Array, uint8ArrayToBase64Url } from '../crypto/base64url'
import './CryptoDemo.css'

export const CryptoDemo: React.FC = () => {
  const [provider] = useState(() => new WebCryptoProvider())
  const [deviceA, setDeviceA] = useState<DeviceKeyMaterial | null>(null)
  const [deviceB, setDeviceB] = useState<DeviceKeyMaterial | null>(null)
  const [sas, setSas] = useState<{ hex: string; emojis: string } | null>(null)

  const [inputA, setInputA] = useState('Top secret text from Device A to Device B 🔒')
  const [wireMessage, setWireMessage] = useState<WireMessage | null>(null)
  const [decryptedB, setDecryptedB] = useState<string | null>(null)
  const [errorB, setErrorB] = useState<string | null>(null)
  const [isTampered, setIsTampered] = useState(false)

  // Initialize two separate device keys on mount
  useEffect(() => {
    async function initKeys() {
      const a = await provider.generateDeviceKeys('dev-alpha')
      const b = await provider.generateDeviceKeys('dev-beta')
      setDeviceA(a)
      setDeviceB(b)

      const derived = await provider.deriveSAS(
        'session-demo-01',
        a.publicSigningKeyB64,
        b.publicHpkeKeyB64
      )
      setSas(derived)
    }
    initKeys()
  }, [provider])

  const handleEncrypt = async () => {
    if (!deviceA || !deviceB) return
    setErrorB(null)
    setDecryptedB(null)
    setIsTampered(false)

    const header = {
      sessionId: 'session-demo-01',
      messageId: `msg-${crypto.randomUUID().slice(0, 8)}`,
      senderDeviceId: deviceA.deviceId,
      baseRevisionId: 'msg-000',
      logicalClock: 1,
      keyEpoch: 1,
      contentType: 'text/plain;charset=utf-8',
      plaintextBytes: new TextEncoder().encode(inputA).length,
    }

    const recipients = {
      [deviceB.deviceId]: {
        deviceId: deviceB.deviceId,
        publicSigningKeyB64: deviceB.publicSigningKeyB64,
        publicHpkeKeyB64: deviceB.publicHpkeKeyB64,
      },
    }

    const encrypted = await provider.encryptSnapshot(
      inputA,
      header,
      recipients,
      deviceA
    )
    setWireMessage(encrypted)
  }

  const handleDecrypt = async () => {
    if (!wireMessage || !deviceA || !deviceB) return
    setErrorB(null)
    setDecryptedB(null)

    try {
      const plaintext = await provider.decryptSnapshot(
        wireMessage,
        deviceB,
        deviceA.publicSigningKeyB64
      )
      setDecryptedB(plaintext)
    } catch (err) {
      setErrorB((err as Error).message)
    }
  }

  const tamperCiphertext = () => {
    if (!wireMessage) return
    const bytes = base64UrlToUint8Array(wireMessage.payload.ciphertext)
    bytes[0] ^= 0xff
    setWireMessage({
      ...wireMessage,
      payload: {
        ...wireMessage.payload,
        ciphertext: uint8ArrayToBase64Url(bytes),
      },
    })
    setIsTampered(true)
    setDecryptedB(null)
  }

  const tamperNonce = () => {
    if (!wireMessage) return
    const bytes = base64UrlToUint8Array(wireMessage.payload.nonce)
    bytes[0] ^= 0xff
    setWireMessage({
      ...wireMessage,
      payload: {
        ...wireMessage.payload,
        nonce: uint8ArrayToBase64Url(bytes),
      },
    })
    setIsTampered(true)
    setDecryptedB(null)
  }

  const tamperHeader = () => {
    if (!wireMessage) return
    setWireMessage({
      ...wireMessage,
      header: {
        ...wireMessage.header,
        logicalClock: 9999, // AAD modified
      },
    })
    setIsTampered(true)
    setDecryptedB(null)
  }

  const tamperSignature = () => {
    if (!wireMessage) return
    const bytes = base64UrlToUint8Array(wireMessage.snapshotSignature)
    bytes[0] ^= 0xff
    setWireMessage({
      ...wireMessage,
      snapshotSignature: uint8ArrayToBase64Url(bytes),
    })
    setIsTampered(true)
    setDecryptedB(null)
  }

  return (
    <div className="crypto-demo">
      <div className="demo-header">
        <h2>Cryptographic Proof of Concept (Two Browser Contexts)</h2>
        <p>Testing RFC 9180 HPKE Base Mode + AES-256-GCM + ECDSA P-256 Signing Locally</p>
      </div>

      {sas && (
        <div className="sas-container">
          <span>Short Authentication String (SAS):</span>
          <span className="sas-emojis">{sas.emojis}</span>
          <span className="sas-hex">{sas.hex}</span>
        </div>
      )}

      <div className="devices-grid">
        {/* Device A (Sender) */}
        <div className="device-card">
          <div className="device-card-header">
            <h3>📱 Device A (Sender)</h3>
            <span className="key-summary">
              {deviceA ? `ECDSA:${deviceA.publicSigningKeyB64.slice(0, 8)}...` : 'Generating keys...'}
            </span>
          </div>

          <label htmlFor="input-a">Plaintext Snapshot:</label>
          <textarea
            id="input-a"
            className="demo-input"
            rows={4}
            value={inputA}
            onChange={(e) => setInputA(e.target.value)}
          />

          <button className="demo-btn" onClick={handleEncrypt} disabled={!deviceA}>
            🔐 Encrypt & Wrap for Device B
          </button>

          {wireMessage && (
            <>
              <div className="tamper-toolbar">
                <span className="tamper-label">Inject Tampering Attack:</span>
                <button className="tamper-btn" onClick={tamperCiphertext}>
                  Corrupt Ciphertext
                </button>
                <button className="tamper-btn" onClick={tamperNonce}>
                  Corrupt Nonce
                </button>
                <button className="tamper-btn" onClick={tamperHeader}>
                  Modify Header AAD
                </button>
                <button className="tamper-btn" onClick={tamperSignature}>
                  Forge Signature
                </button>
              </div>

              <div className="wire-viewer">
                {isTampered && <div style={{ color: '#ef4444', marginBottom: 6 }}>⚠️ PAYLOAD HAS BEEN TAMPERED</div>}
                {JSON.stringify(wireMessage, null, 2)}
              </div>
            </>
          )}
        </div>

        {/* Device B (Receiver) */}
        <div className="device-card">
          <div className="device-card-header">
            <h3>💻 Device B (Receiver)</h3>
            <span className="key-summary">
              {deviceB ? `HPKE:${deviceB.publicHpkeKeyB64.slice(0, 8)}...` : 'Generating keys...'}
            </span>
          </div>

          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
            Receiver verifies sender signature, decapsulates CEK via HPKE, checks AES-GCM authentication tag, and applies.
          </p>

          <button
            className="demo-btn"
            onClick={handleDecrypt}
            disabled={!wireMessage}
            style={{ backgroundColor: '#10b981' }}
          >
            🔓 Verify & Decrypt Inbound Envelope
          </button>

          {decryptedB && (
            <div className="result-box success">
              <strong>✅ Authenticated & Decrypted Successfully:</strong>
              <p style={{ margin: '8px 0 0 0', fontFamily: 'var(--font-mono)' }}>{decryptedB}</p>
            </div>
          )}

          {errorB && (
            <div className="result-box error">
              <strong>❌ Security Invariant Triggered:</strong>
              <p style={{ margin: '8px 0 0 0' }}>{errorB}</p>
              <small style={{ color: '#f87171' }}>Plaintext suppressed (zero content rendered).</small>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default CryptoDemo
