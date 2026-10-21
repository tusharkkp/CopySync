import React, { useState, useCallback } from 'react'
import { SYNC_CONFIG } from './config/syncConfig'
import { CryptoDemo } from './components/CryptoDemo'
import { PairingBar } from './components/PairingBar'
import { useClipSync } from './sync/useClipSync'
import { StorageMode } from './sync/ClipSyncService'
import './App.css'

export type { StorageMode }
export type ConnectionState = 'offline' | 'connecting' | 'direct' | 'relay'
export type ActiveView = 'editor' | 'crypto-demo'

export const App: React.FC = () => {
  const [activeView, setActiveView] = useState<ActiveView>('editor')
  const [storageMode, setStorageMode] = useState<StorageMode>('ephemeral')
  const [retentionDays, setRetentionDays] = useState<number>(30)

  const {
    content,
    setContent,
    state,
    createSession,
    joinSession,
    closeSession,
    leaveSession,
    revokeDevice,
    dismissConflict,
  } = useClipSync()

  // Map state to legacy ConnectionState for badge styling
  const connectionState: ConnectionState =
    state.phase === 'paired'
      ? 'direct'
      : state.connectionStatus === 'connected'
        ? 'relay'
        : state.connectionStatus === 'connecting' || state.connectionStatus === 'reconnecting'
          ? 'connecting'
          : 'offline'

  // Calculate byte length strictly using UTF-8 TextEncoder per ADR-014
  const byteCount = new TextEncoder().encode(content).length
  const isOverLimit = byteCount > SYNC_CONFIG.MAX_PLAIN_TEXT_BYTES
  const bytePercentage = Math.min(
    100,
    Math.round((byteCount / SYNC_CONFIG.MAX_PLAIN_TEXT_BYTES) * 100)
  )

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      // Per ADR-004: Paste events synchronize immediately (bypassing debounce)
      const pastedText = e.clipboardData.getData('text')
      if (pastedText) {
        setContent(pastedText, true)
      }
    },
    [setContent]
  )

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value)
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-brand">
          <span className="brand-logo">⚡</span>
          <h1>ClipSync</h1>
          <span className="badge-preview">E2EE Preview</span>
        </div>

        <div className="header-controls">
          {/* Navigation View Switcher */}
          <div className="view-switcher" role="tablist">
            <button
              className={`view-tab-btn ${activeView === 'editor' ? 'active' : ''}`}
              onClick={() => setActiveView('editor')}
              role="tab"
              aria-selected={activeView === 'editor'}
            >
              📝 Editor
            </button>
            <button
              className={`view-tab-btn ${activeView === 'crypto-demo' ? 'active' : ''}`}
              onClick={() => setActiveView('crypto-demo')}
              role="tab"
              aria-selected={activeView === 'crypto-demo'}
            >
              🔐 Crypto Demo
            </button>
          </div>

          <div className="connection-badge" data-status={connectionState}>
            <span className="status-dot"></span>
            <span className="status-text">{connectionState.toUpperCase()}</span>
          </div>

          <div className="storage-mode-selector">
            <label htmlFor="storage-mode">Mode:</label>
            <select
              id="storage-mode"
              value={storageMode}
              onChange={(e) => setStorageMode(e.target.value as StorageMode)}
            >
              <option value="ephemeral">Ephemeral (Relay Only)</option>
              <option value="temporary">Temporary (10 Min)</option>
              <option value="history">History (Encrypted)</option>
            </select>
          </div>

          {storageMode === 'history' && (
            <div className="retention-selector" data-testid="retention-selector">
              <label htmlFor="retention-days">Retention:</label>
              <select
                id="retention-days"
                value={retentionDays}
                onChange={(e) => setRetentionDays(Number(e.target.value))}
              >
                <option value={1}>1 Day</option>
                <option value={7}>7 Days</option>
                <option value={30}>30 Days</option>
              </select>
            </div>
          )}
        </div>
      </header>

      <main className="editor-container">
        {activeView === 'editor' ? (
          <>
            <PairingBar
              state={state}
              onCreateSession={() => createSession(storageMode, retentionDays)}
              onJoinSession={joinSession}
              onLeaveSession={leaveSession}
              onCloseSession={closeSession}
              onRevokeDevice={revokeDevice}
              onDismissConflict={dismissConflict}
            />

            <div className="editor-toolbar">
              <div className="metrics">
                <span
                  className={`byte-counter ${isOverLimit ? 'over-limit' : ''}`}
                >
                  {byteCount.toLocaleString()} /{' '}
                  {SYNC_CONFIG.MAX_PLAIN_TEXT_BYTES.toLocaleString()} bytes
                </span>
                <span className="percentage">({bytePercentage}%)</span>
              </div>
              {isOverLimit && (
                <span className="limit-warning" role="alert">
                  Payload exceeds 64 KiB maximum limit!
                </span>
              )}
            </div>

            <textarea
              id="clipsync-editor"
              className="editor-textarea"
              aria-label="ClipSync Clipboard Editor"
              placeholder="Paste or type text to synchronize across paired devices automatically (no send button)..."
              value={content}
              onChange={handleChange}
              onPaste={handlePaste}
              rows={16}
            />
          </>
        ) : (
          <CryptoDemo />
        )}
      </main>

      <footer className="app-footer">
        <div className="footer-info">
          <span>End-to-End Encrypted: AES-256-GCM + HPKE (RFC 9180)</span>
          <span className="separator">•</span>
          <span>Automatic Sync (Paste = Immediate, Typing = 250ms debounce)</span>
        </div>
      </footer>
    </div>
  )
}

export default App
