import React, { useState, useCallback, useEffect } from 'react'
import {
  Copy,
  Check,
  Trash2,
  Sparkles,
  ShieldCheck,
  Zap,
} from 'lucide-react'
import { SYNC_CONFIG } from './config/syncConfig'
import { CryptoDemo } from './components/CryptoDemo'
import { PairingBar } from './components/PairingBar'
import { Backdrop } from './components/Backdrop'
import { AnimatedBadge } from './components/AnimatedBadge'
import { ThemeSwitcher } from './components/ThemeSwitcher'
import { useClipSync } from './sync/useClipSync'
import type { StorageMode } from './sync/ClipSyncService'
import './App.css'

export type { StorageMode }
export type ConnectionState = 'offline' | 'connecting' | 'direct' | 'relay'
export type ActiveView = 'editor' | 'crypto-demo'

export const App: React.FC = () => {
  const [activeView, setActiveView] = useState<ActiveView>('editor')
  const [storageMode, setStorageMode] = useState<StorageMode>('ephemeral')
  const [retentionDays, setRetentionDays] = useState<number>(30)
  const [scrolled, setScrolled] = useState<boolean>(false)
  const [copiedToast, setCopiedToast] = useState<boolean>(false)

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

  // Track scroll position for ChaiUI dynamic header blur
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 10)
    }
    handleScroll()
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

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

  const handleCopyEditorContent = () => {
    if (!content) return
    navigator.clipboard?.writeText(content)
    setCopiedToast(true)
    setTimeout(() => setCopiedToast(false), 2000)
  }

  const handleClearEditorContent = () => {
    setContent('')
  }

  const handleLoadSample = () => {
    setContent(
      '// Confidential AWS API Credentials\nAWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\nAWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\n\n// Verified end-to-end encrypted synchronization via WebRTC'
    )
  }

  return (
    <div className="app-shell relative isolate overflow-x-clip">
      {/* ChaiUI Centered Hexagon Glow Backdrop */}
      <Backdrop />

      {/* Sticky Header with Dynamic Blur */}
      <header className={`app-header ${scrolled ? 'header-scrolled' : ''}`}>
        <div className="header-inner">
          <div className="header-brand">
            <div className="brand-wordmark">
              <span className="brand-logo" aria-hidden="true">⚡</span>
              <h1 className="brand-name">Control CV Sync</h1>
            </div>
            <AnimatedBadge>
              <span className="badge-preview">E2EE Preview</span>
            </AnimatedBadge>
          </div>

          <div className="header-controls">
            {/* ChaiUI Segmented Navigation View Switcher */}
            <div className="view-switcher" role="tablist">
              <button
                type="button"
                className={`view-tab-btn ${activeView === 'editor' ? 'active' : ''}`}
                onClick={() => setActiveView('editor')}
                role="tab"
                aria-selected={activeView === 'editor'}
              >
                📝 Editor
              </button>
              <button
                type="button"
                className={`view-tab-btn ${activeView === 'crypto-demo' ? 'active' : ''}`}
                onClick={() => setActiveView('crypto-demo')}
                role="tab"
                aria-selected={activeView === 'crypto-demo'}
              >
                🔐 Crypto Demo
              </button>
            </div>

            {/* Connection Status Indicator */}
            <div className="connection-badge" data-status={connectionState} title={`Connection: ${connectionState}`}>
              <span className="status-dot" />
              <span className="status-text">{connectionState.toUpperCase()}</span>
            </div>

            {/* Storage Mode Selector */}
            <div className="storage-mode-selector">
              <label htmlFor="storage-mode">Mode:</label>
              <select
                id="storage-mode"
                value={storageMode}
                onChange={(e) => setStorageMode(e.target.value as StorageMode)}
                className="chai-select"
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
                  className="chai-select"
                >
                  <option value={1}>1 Day</option>
                  <option value={7}>7 Days</option>
                  <option value={30}>30 Days</option>
                </select>
              </div>
            )}

            {/* ChaiUI Half-Circle Theme Switcher */}
            <ThemeSwitcher />
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="app-main">
        {activeView === 'editor' ? (
          <div className="editor-view-container">
            {/* Section Head with Lead and One Highlight Phrase */}
            <section className="section-head">
              <h2 className="section-title">Zero-knowledge clipboard synchronization</h2>
              <p className="section-lead">
                Instantly synchronize Content across your devices with{' '}
                <span className="highlight">provable end-to-end encryption</span>.
              </p>
            </section>

            {/* Pairing Bar Component */}
            <PairingBar
              state={state}
              onCreateSession={() => createSession(storageMode, retentionDays)}
              onJoinSession={joinSession}
              onLeaveSession={leaveSession}
              onCloseSession={closeSession}
              onRevokeDevice={revokeDevice}
              onDismissConflict={dismissConflict}
            />

            {/* Editor Container Card */}
            <div className="card-chai editor-card">
              <div className="editor-card-header">
                <div className="editor-actions-left">
                  <span className="editor-label">Live Clipboard Buffer</span>
                  {state.isSyncing && (
                    <span className="syncing-indicator">
                      <Zap size={13} className="syncing-bolt" aria-hidden="true" />
                      Syncing
                    </span>
                  )}
                </div>

                <div className="editor-card-tools">
                  <button
                    type="button"
                    className="btn btn-secondary btn-tiny"
                    onClick={handleCopyEditorContent}
                    title="Copy editor content to system clipboard"
                    disabled={!content}
                  >
                    {copiedToast ? <Check size={13} /> : <Copy size={13} />}
                    <span>{copiedToast ? 'Copied' : 'Copy'}</span>
                  </button>

                  <button
                    type="button"
                    className="btn btn-secondary btn-tiny"
                    onClick={handleLoadSample}
                    title="Load sample test payload"
                  >
                    <Sparkles size={13} />
                    <span>Sample</span>
                  </button>

                  <button
                    type="button"
                    className="btn btn-secondary btn-tiny"
                    onClick={handleClearEditorContent}
                    title="Clear editor buffer"
                    disabled={!content}
                  >
                    <Trash2 size={13} />
                    <span>Clear</span>
                  </button>
                </div>
              </div>

              {/* Textarea Surface */}
              <div className="editor-textarea-wrapper">
                <textarea
                  id="clipsync-editor"
                  className="editor-textarea font-mono"
                  aria-label="ClipSync Clipboard Editor"
                  placeholder="Paste or type text to synchronize across paired devices automatically (no send button)..."
                  value={content}
                  onChange={handleChange}
                  onPaste={handlePaste}
                  rows={14}
                  spellCheck={false}
                />
              </div>

              {/* Editor Toolbar Metrics */}
              <div className="editor-toolbar">
                <div className="metrics">
                  <div className="meter-track" aria-hidden="true">
                    <div
                      className={`meter-fill ${isOverLimit ? 'over-limit' : ''}`}
                      style={{ width: `${bytePercentage}%` }}
                    />
                  </div>
                  <span className={`byte-counter ${isOverLimit ? 'over-limit' : ''}`}>
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
            </div>
          </div>
        ) : (
          <CryptoDemo />
        )}
      </main>

      {/* ChaiUI Signature Footer with 10% Hairline */}
      <footer className="app-footer">
        <div className="footer-inner">
          <div className="footer-info">
            <span className="footer-spec">
              <ShieldCheck size={14} className="inline-icon" aria-hidden="true" />
              End-to-End Encrypted: AES-256-GCM + RFC 9180 HPKE
            </span>
            <span className="separator">•</span>
            <span>Automatic Sync: Paste = Immediate, Typing = 250ms debounce</span>
            <span className="separator">•</span>
            <span>Direct WebRTC DataChannel with WebSocket relay fallback</span>
          </div>
          <div className="footer-copy">
            {/* <span>By Tushar Kaldate</span> */}
            <span>
              By{" "}
              <a
                href="https://github.com/tusharkkp"
                target="_blank"
                rel="noopener noreferrer"
                className="github-link"
              >
                Tushar Kaldate
              </a>
            </span>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default App
