import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PairingBar } from '../PairingBar'
import { ClipSyncState } from '../../sync/ClipSyncService'

const defaultState: ClipSyncState = {
  deviceId: 'dev-001',
  connectionStatus: 'connected',
  sessionId: null,
  pairingCode: null,
  storageMode: 'ephemeral',
  phase: 'unpaired',
  peers: {},
  sas: null,
  logicalClock: 0,
  isSyncing: false,
  lastSyncedAt: null,
  error: null,
  transportMode: 'relay',
  webrtcStatus: 'idle',
}

describe('UI: PairingBar Component', () => {
  it('renders unpaired view with Start and Join buttons', () => {
    const onCreate = vi.fn()
    const onJoin = vi.fn()
    const onLeave = vi.fn()

    render(
      <PairingBar
        state={defaultState}
        onCreateSession={onCreate}
        onJoinSession={onJoin}
        onLeaveSession={onLeave}
      />
    )

    expect(screen.getByTestId('btn-create-session')).toBeInTheDocument()
    expect(screen.getByTestId('btn-show-join-form')).toBeInTheDocument()
  })

  it('reveals join form when Join with Code is clicked', () => {
    const onJoin = vi.fn()
    render(
      <PairingBar
        state={defaultState}
        onCreateSession={vi.fn()}
        onJoinSession={onJoin}
        onLeaveSession={vi.fn()}
      />
    )

    fireEvent.click(screen.getByTestId('btn-show-join-form'))
    expect(screen.getByTestId('join-form')).toBeInTheDocument()

    // Fill form
    fireEvent.change(screen.getByLabelText(/Session ID:/i), {
      target: { value: 'sess-live-01' },
    })
    fireEvent.change(screen.getByLabelText(/6-Digit Code:/i), {
      target: { value: '849608' },
    })

    fireEvent.click(screen.getByTestId('btn-submit-join'))
    expect(onJoin).toHaveBeenCalledWith('sess-live-01', '849608')
  })

  it('displays waiting screen with formatted pairing code and session ID', () => {
    const waitingState: ClipSyncState = {
      ...defaultState,
      phase: 'waiting_for_peer',
      sessionId: 'sess-live-01',
      pairingCode: '849608',
    }

    render(
      <PairingBar
        state={waitingState}
        onCreateSession={vi.fn()}
        onJoinSession={vi.fn()}
        onLeaveSession={vi.fn()}
      />
    )

    expect(screen.getByTestId('waiting-card')).toBeInTheDocument()
    expect(screen.getByTestId('display-pairing-code')).toHaveTextContent('849 608')
    expect(screen.getByText('sess-live-01')).toBeInTheDocument()
  })

  it('displays paired active screen with peer count and SAS fingerprint', () => {
    const pairedState: ClipSyncState = {
      ...defaultState,
      phase: 'paired',
      sessionId: 'sess-live-01',
      peers: {
        'dev-phone-02': {
          deviceId: 'dev-phone-02',
          publicSigningKeyB64: 'key-a',
          publicHpkeKeyB64: 'key-b',
        },
      },
      sas: {
        hex: 'A1B2C3D4E5F6',
        emojis: '🐶 🐱 🐭 🐹',
      },
    }

    render(
      <PairingBar
        state={pairedState}
        onCreateSession={vi.fn()}
        onJoinSession={vi.fn()}
        onLeaveSession={vi.fn()}
      />
    )

    expect(screen.getByTestId('paired-card')).toBeInTheDocument()
    expect(screen.getByText(/Paired: 1 Peer Active/i)).toBeInTheDocument()
    expect(screen.getByTestId('sas-emojis')).toHaveTextContent('🐶 🐱 🐭 🐹')
    expect(screen.getByText('A1B2C3D4E5F6')).toBeInTheDocument()
    expect(screen.getByTestId('transport-badge')).toHaveTextContent(/Relay/i)
  })

  it('displays direct P2P transport badge when connected over WebRTC', () => {
    const directState: ClipSyncState = {
      ...defaultState,
      phase: 'paired',
      sessionId: 'sess-live-01',
      transportMode: 'direct',
      webrtcStatus: 'connected',
      peers: {
        'dev-phone-02': {
          deviceId: 'dev-phone-02',
          publicSigningKeyB64: 'key-a',
          publicHpkeKeyB64: 'key-b',
        },
      },
    }

    render(
      <PairingBar
        state={directState}
        onCreateSession={vi.fn()}
        onJoinSession={vi.fn()}
        onLeaveSession={vi.fn()}
      />
    )

    const badge = screen.getByTestId('transport-badge')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent(/Direct P2P/i)
    expect(badge).toHaveClass('transport-direct')
  })
})
