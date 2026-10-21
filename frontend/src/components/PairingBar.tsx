import React, { useState } from 'react'
import { ClipSyncState, StorageMode } from '../sync/ClipSyncService'

export interface PairingBarProps {
  state: ClipSyncState
  onCreateSession: (mode: StorageMode) => void
  onJoinSession: (sessionId: string, pairingCode: string) => void
  onLeaveSession: () => void
}

export const PairingBar: React.FC<PairingBarProps> = ({
  state,
  onCreateSession,
  onJoinSession,
  onLeaveSession,
}) => {
  const [showJoinForm, setShowJoinForm] = useState(false)
  const [joinSessionId, setJoinSessionId] = useState('')
  const [joinPairingCode, setJoinPairingCode] = useState('')
  const [copiedNotice, setCopiedNotice] = useState<string | null>(null)

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard?.writeText(text)
    setCopiedNotice(label)
    setTimeout(() => setCopiedNotice(null), 2000)
  }

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (joinSessionId.trim() && joinPairingCode.trim()) {
      onJoinSession(joinSessionId.trim(), joinPairingCode.trim())
    }
  }

  const peerCount = Object.keys(state.peers).length

  return (
    <div className="pairing-bar" data-testid="pairing-bar">
      {/* 1. Unpaired Default View */}
      {state.phase === 'unpaired' && !showJoinForm && (
        <div className="pairing-unpaired-actions">
          <div className="pairing-action-group">
            <button
              className="btn btn-primary"
              onClick={() => onCreateSession(state.storageMode)}
              data-testid="btn-create-session"
            >
              🚀 Start New Session
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => setShowJoinForm(true)}
              data-testid="btn-show-join-form"
            >
              🔗 Join with Code
            </button>
          </div>
          <span className="pairing-hint">
            Start a session to invite other devices, or join an existing session with a 6-digit code.
          </span>
        </div>
      )}

      {/* 2. Join Form Modal / Drawer */}
      {state.phase === 'unpaired' && showJoinForm && (
        <form className="pairing-join-form" onSubmit={handleJoinSubmit} data-testid="join-form">
          <div className="form-group">
            <label htmlFor="join-session-id">Session ID:</label>
            <input
              id="join-session-id"
              type="text"
              placeholder="e.g. sess-live-01"
              value={joinSessionId}
              onChange={(e) => setJoinSessionId(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="join-pairing-code">6-Digit Code:</label>
            <input
              id="join-pairing-code"
              type="text"
              placeholder="123456"
              maxLength={6}
              pattern="\d{6}"
              value={joinPairingCode}
              onChange={(e) => setJoinPairingCode(e.target.value.replace(/\D/g, ''))}
              required
            />
          </div>

          <div className="form-buttons">
            <button type="submit" className="btn btn-primary" data-testid="btn-submit-join">
              Connect
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setShowJoinForm(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* 3. Session Creating Spinner */}
      {state.phase === 'creating' && (
        <div className="pairing-status-box creating">
          <span className="spinner">⏳</span>
          <span>Generating ECDSA Identity & HPKE Keypair...</span>
        </div>
      )}

      {/* 4. Session Joining Spinner */}
      {state.phase === 'joining' && (
        <div className="pairing-status-box joining">
          <span className="spinner">🔄</span>
          <span>Verifying pairing token with relay...</span>
        </div>
      )}

      {/* 5. Waiting for Peer (Initiator Waiting Screen) */}
      {state.phase === 'waiting_for_peer' && (
        <div className="pairing-waiting-card" data-testid="waiting-card">
          <div className="waiting-header">
            <span className="pulse-dot"></span>
            <strong>Waiting for peer to join...</strong>
          </div>

          <div className="pairing-credentials">
            <div className="credential-block">
              <span className="credential-label">Pairing Code:</span>
              <div className="code-display" data-testid="display-pairing-code">
                {state.pairingCode
                  ? `${state.pairingCode.slice(0, 3)} ${state.pairingCode.slice(3)}`
                  : '------'}
              </div>
              <button
                type="button"
                className="btn btn-tiny"
                onClick={() => state.pairingCode && copyToClipboard(state.pairingCode, 'Code')}
              >
                📋 Copy Code
              </button>
            </div>

            <div className="credential-block">
              <span className="credential-label">Session ID:</span>
              <code className="session-id-display">{state.sessionId}</code>
              <button
                type="button"
                className="btn btn-tiny"
                onClick={() => state.sessionId && copyToClipboard(state.sessionId, 'Session ID')}
              >
                📋 Copy ID
              </button>
            </div>
          </div>

          {copiedNotice && <span className="copy-notice">✓ Copied {copiedNotice}!</span>}

          <div className="waiting-footer">
            <span className="waiting-instructions">
              Enter this 6-digit code on your second phone, tablet, or browser window to connect.
            </span>
            <button className="btn btn-danger btn-tiny" onClick={onLeaveSession}>
              Cancel Session
            </button>
          </div>
        </div>
      )}

      {/* 6. Paired Active Session Screen */}
      {state.phase === 'paired' && (
        <div className="pairing-active-card" data-testid="paired-card">
          <div className="active-session-meta">
            <div className="active-badge">
              <span className="active-dot"></span>
              <strong>Paired: {peerCount} {peerCount === 1 ? 'Peer' : 'Peers'} Active</strong>
            </div>

            <div className="session-tag">
              Session: <code>{state.sessionId}</code>
            </div>

            <div
              className={`transport-badge transport-${state.transportMode}`}
              data-testid="transport-badge"
              title={
                state.transportMode === 'direct'
                  ? 'Zero-hop WebRTC DataChannel (Direct P2P)'
                  : 'WebSocket Relay via API Gateway'
              }
            >
              {state.transportMode === 'direct' ? (
                <>🟢 Direct P2P</>
              ) : (
                <>⚡ Relay {state.webrtcStatus === 'connecting' ? '(P2P connecting...)' : ''}</>
              )}
            </div>

            {state.sas && (
              <div className="sas-fingerprint" title="Safety Fingerprint / Short Authentication String (SAS)">
                <span className="sas-label">Fingerprint:</span>
                <span className="sas-emojis" data-testid="sas-emojis">{state.sas.emojis}</span>
                <code className="sas-hex">{state.sas.hex}</code>
              </div>
            )}
          </div>

          <div className="active-session-actions">
            {state.isSyncing && (
              <span className="sync-pulse" data-testid="sync-pulse">
                ⚡ Encrypting & Syncing...
              </span>
            )}
            <button
              className="btn btn-secondary btn-tiny"
              onClick={onLeaveSession}
              data-testid="btn-disconnect-session"
            >
              Disconnect
            </button>
          </div>
        </div>
      )}

      {/* Error Banner */}
      {state.error && (
        <div className="pairing-error-banner" role="alert">
          <span>⚠️ {state.error}</span>
        </div>
      )}
    </div>
  )
}
