import React, { useState, useEffect } from 'react'
import {
  ShieldCheck,
  Lock,
  Unlock,
  Smartphone,
  Laptop,
  AlertTriangle,
  Bug,
} from 'lucide-react'
import { WebCryptoProvider } from '../crypto/WebCryptoProvider'
import type { DeviceKeyMaterial, WireMessage } from '../crypto/types'
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
        <h2 className="demo-title">Cryptographic Proof of Concept (Two Browser Contexts)</h2>
        <p className="demo-lead">
          Testing RFC 9180 HPKE base mode, AES-256-GCM, and ECDSA P-256 signing locally with{' '}
          <span className="highlight">zero-knowledge privacy</span>.
        </p>
      </div>

      {sas && (
        <div className="sas-container card-chai">
          <div className="sas-info">
            <ShieldCheck size={16} className="text-emerald-400" aria-hidden="true" />
            <span className="sas-title">Short Authentication String (SAS):</span>
          </div>
          <div className="sas-values">
            <span className="sas-emojis">{sas.emojis}</span>
            <code className="sas-hex font-mono">{sas.hex}</code>
          </div>
          <span className="sas-caption">Both devices derive identical SAS fingerprints to prevent MITM attacks.</span>
        </div>
      )}

      <div className="devices-grid">
        {/* Device A (Sender) */}
        <div className="card-chai device-card">
          <div className="device-card-header">
            <h3>
              <Smartphone size={16} className="device-icon" aria-hidden="true" />
              <span>Device A (Sender)</span>
            </h3>
            <span className="key-summary font-mono">
              {deviceA ? `ECDSA: ${deviceA.publicSigningKeyB64.slice(0, 10)}...` : 'Generating keys...'}
            </span>
          </div>

          <div className="device-card-body">
            <label htmlFor="input-a" className="field-label">
              Plaintext Snapshot:
            </label>
            <textarea
              id="input-a"
              className="chai-input demo-input font-mono"
              rows={4}
              value={inputA}
              onChange={(e) => setInputA(e.target.value)}
              placeholder="Enter plaintext to encrypt..."
            />

            <button
              type="button"
              className="btn btn-solid btn-asym"
              onClick={handleEncrypt}
              disabled={!deviceA}
            >
              <Lock size={15} aria-hidden="true" />
              <span>Encrypt & Wrap for Device B</span>
            </button>

            {wireMessage && (
              <div className="wire-section">
                <div className="tamper-toolbar">
                  <div className="tamper-lead">
                    <Bug size={13} aria-hidden="true" />
                    <span className="tamper-label">Inject Tampering Attack:</span>
                  </div>
                  <div className="tamper-actions">
                    <button type="button" className="btn btn-outline btn-tiny tamper-btn" onClick={tamperCiphertext}>
                      Corrupt Ciphertext
                    </button>
                    <button type="button" className="btn btn-outline btn-tiny tamper-btn" onClick={tamperNonce}>
                      Corrupt Nonce
                    </button>
                    <button type="button" className="btn btn-outline btn-tiny tamper-btn" onClick={tamperHeader}>
                      Modify Header AAD
                    </button>
                    <button type="button" className="btn btn-outline btn-tiny tamper-btn" onClick={tamperSignature}>
                      Forge Signature
                    </button>
                  </div>
                </div>

                <div className="wire-viewer font-mono">
                  {isTampered && (
                    <div className="tamper-alert">
                      <AlertTriangle size={14} aria-hidden="true" />
                      <span>Payload has been tampered with in transit</span>
                    </div>
                  )}
                  {JSON.stringify(wireMessage, null, 2)}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Device B (Receiver) */}
        <div className="card-chai device-card">
          <div className="device-card-header">
            <h3>
              <Laptop size={16} className="device-icon" aria-hidden="true" />
              <span>Device B (Receiver)</span>
            </h3>
            <span className="key-summary font-mono">
              {deviceB ? `HPKE: ${deviceB.publicHpkeKeyB64.slice(0, 10)}...` : 'Generating keys...'}
            </span>
          </div>

          <div className="device-card-body">
            <p className="device-desc">
              Receiver verifies sender ECDSA signature, decapsulates content encryption key via RFC 9180 HPKE, verifies AES-GCM tag, and renders verified plaintext.
            </p>

            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleDecrypt}
              disabled={!wireMessage}
            >
              <Unlock size={15} aria-hidden="true" />
              <span>Verify & Decrypt Inbound Envelope</span>
            </button>

            {decryptedB && (
              <div className="result-box success" role="status">
                <div className="result-title">
                  <ShieldCheck size={16} aria-hidden="true" />
                  <strong>Authenticated & Decrypted Successfully:</strong>
                </div>
                <p className="result-content font-mono">{decryptedB}</p>
              </div>
            )}

            {errorB && (
              <div className="result-box error" role="alert">
                <div className="result-title">
                  <AlertTriangle size={16} aria-hidden="true" />
                  <strong>Security Invariant Triggered:</strong>
                </div>
                <p className="result-content font-mono">{errorB}</p>
                <small className="error-note">Plaintext suppressed (zero content rendered).</small>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default CryptoDemo
