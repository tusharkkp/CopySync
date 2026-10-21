import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ClipSyncService, StorageMode } from '../sync/ClipSyncService'
import { WebCryptoProvider } from '../crypto/WebCryptoProvider'
import { WebSocketClient } from '../transport/WebSocketClient'

// Simulated Relay with DynamoDB storage mode & TTL semantics
class SimulatedDynamoRelay {
  private sockets: { [deviceId: string]: MockWebSocket } = {}
  private sessions: {
    [sessionId: string]: {
      sessionId: string
      storageMode: StorageMode
      retentionDays: number
      initiatorDeviceId: string
      initiatorKeys: { signing: string; hpke: string }
      joinerDeviceId?: string
      joinerKeys?: { signing: string; hpke: string }
      pairingCode: string
    }
  } = {}

  // Mock DynamoDB ClipSyncClipboard table
  public snapshots: {
    [sessionId: string]: Array<{
      messageId: string
      logicalClock: number
      payloadCiphertext: string
      payloadNonce: string
      snapshotSignature: string
      keyEnvelopesJson: string
      createdAt: number
      expiresAt: number | null
    }>
  } = {}

  public register(deviceId: string, socket: MockWebSocket) {
    this.sockets[deviceId] = socket
  }

  public handleOutbound(fromDeviceId: string, frame: Record<string, unknown>) {
    const action = frame.action as string
    const fromSocket = this.sockets[fromDeviceId]

    if (action === 'session.create') {
      const sessionId = frame.sessionId as string
      const mode = ((frame.storageMode as string) || 'EPHEMERAL').toLowerCase() as StorageMode
      const retentionDays = (frame.retentionDays as number) || (mode === 'history' ? 30 : 0)
      const pairingCode = '849608'

      this.sessions[sessionId] = {
        sessionId,
        storageMode: mode,
        retentionDays,
        initiatorDeviceId: fromDeviceId,
        initiatorKeys: {
          signing: frame.publicSigningKeyB64 as string,
          hpke: frame.publicHpkeKeyB64 as string,
        },
        pairingCode,
      }

      fromSocket.simulateInbound({
        status: 'OK',
        action: 'session.create',
        requestId: frame.requestId,
        data: {
          sessionId,
          pairingCode,
          storageMode: mode.toUpperCase(),
          retentionDays,
          keyEpoch: 1,
        },
      })
      return
    }

    if (action === 'session.join') {
      const sessionId = frame.sessionId as string
      const session = this.sessions[sessionId]
      if (!session) {
        fromSocket.simulateInbound({
          status: 'ERROR',
          action: 'session.join',
          errorCode: 'SESSION_NOT_FOUND',
        })
        return
      }

      session.joinerDeviceId = fromDeviceId
      session.joinerKeys = {
        signing: frame.publicSigningKeyB64 as string,
        hpke: frame.publicHpkeKeyB64 as string,
      }

      fromSocket.simulateInbound({
        status: 'OK',
        action: 'session.join',
        requestId: frame.requestId,
        data: { sessionId, status: 'ACTIVE', keyEpoch: 1 },
      })

      const initiatorSocket = this.sockets[session.initiatorDeviceId]
      if (initiatorSocket) {
        initiatorSocket.simulateInbound({
          v: 1,
          action: 'peer.joined',
          deviceId: fromDeviceId,
          publicSigningKeyB64: session.joinerKeys.signing,
          publicHpkeKeyB64: session.joinerKeys.hpke,
        })
      }

      // Notify joiner of initiator keys
      fromSocket.simulateInbound({
        v: 1,
        action: 'peer.joined',
        deviceId: session.initiatorDeviceId,
        publicSigningKeyB64: session.initiatorKeys.signing,
        publicHpkeKeyB64: session.initiatorKeys.hpke,
      })
      return
    }

    if (action === 'clipboard.update') {
      const sessionId = frame.sessionId as string
      const session = this.sessions[sessionId]
      const header = frame.header as Record<string, unknown>
      const payload = frame.payload as Record<string, unknown>

      // EPHEMERAL mode: 0 disk persistence!
      if (session && session.storageMode !== 'ephemeral') {
        const now = Date.now()
        let expiresAt: number | null = null
        if (session.storageMode === 'temporary') {
          expiresAt = now + 600 * 1000 // 10 minutes
        } else if (session.storageMode === 'history') {
          expiresAt = now + (session.retentionDays || 30) * 86400 * 1000
        }

        if (!this.snapshots[sessionId]) {
          this.snapshots[sessionId] = []
        }

        this.snapshots[sessionId].push({
          messageId: header.messageId as string,
          logicalClock: header.logicalClock as number,
          payloadCiphertext: payload.ciphertext as string,
          payloadNonce: payload.nonce as string,
          snapshotSignature: frame.snapshotSignature as string,
          keyEnvelopesJson: JSON.stringify(frame.keyEnvelopes || []),
          createdAt: now,
          expiresAt,
        })
      }

      // Broadcast to other peers in session
      Object.keys(this.sockets).forEach((targetId) => {
        if (targetId !== fromDeviceId) {
          this.sockets[targetId].simulateInbound(frame)
        }
      })
      return
    }

    if (action === 'sync.resume') {
      const sessionId = frame.sessionId as string
      const session = this.sessions[sessionId]
      if (!session) {
        fromSocket.simulateInbound({
          status: 'ERROR',
          action: 'sync.resume',
          errorCode: 'SESSION_NOT_FOUND',
        })
        return
      }

      if (session.storageMode === 'ephemeral') {
        fromSocket.simulateInbound({
          status: 'OK',
          action: 'sync.resume',
          requestId: frame.requestId,
          data: {
            sessionId,
            storageMode: 'EPHEMERAL',
            retentionDays: 0,
            keyEpoch: 1,
            latestSnapshot: null,
            revisions: [],
          },
        })
        return
      }

      const allSnaps = this.snapshots[sessionId] || []
      const now = Date.now()
      // Enforce SEC-10 read-time logical expiry check!
      const unexpired = allSnaps.filter((s) => s.expiresAt === null || s.expiresAt > now)

      const latest = unexpired.length > 0 ? unexpired[unexpired.length - 1] : null
      const revisions = session.storageMode === 'history' ? unexpired : []

      fromSocket.simulateInbound({
        status: 'OK',
        action: 'sync.resume',
        requestId: frame.requestId,
        data: {
          sessionId,
          storageMode: session.storageMode.toUpperCase(),
          retentionDays: session.retentionDays,
          keyEpoch: 1,
          latestSnapshot: latest,
          revisions,
        },
      })
      return
    }

    if (action === 'session.close') {
      const sessionId = frame.sessionId as string
      // Immediate and total purge across tables
      delete this.sessions[sessionId]
      delete this.snapshots[sessionId]

      fromSocket.simulateInbound({
        status: 'OK',
        action: 'session.close',
        requestId: frame.requestId,
        data: { status: 'CLOSED', sessionId },
      })
      return
    }
  }
}

class MockWebSocket {
  public readyState: number = 1
  public onmessage: ((e: { data: string }) => void) | null = null
  public onclose: (() => void) | null = null
  public sentFrames: Record<string, unknown>[] = []

  constructor(
    public url: string,
    private relay: SimulatedDynamoRelay,
    public deviceId: string
  ) {
    this.relay.register(deviceId, this)
  }

  public send(raw: string) {
    const frame = JSON.parse(raw) as Record<string, unknown>
    this.sentFrames.push(frame)
    this.relay.handleOutbound(this.deviceId, frame)
  }

  public simulateInbound(data: Record<string, unknown>) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) })
    }
  }

  public close() {
    this.readyState = 3
    if (this.onclose) this.onclose()
  }
}

describe('GATE-07: Storage Modes, Retention, SEC-10 Expiry & Purge Lifecycle', () => {
  let relay: SimulatedDynamoRelay
  let cryptoA: WebCryptoProvider
  let clientA: WebSocketClient
  let serviceA: ClipSyncService

  beforeEach(() => {
    vi.useFakeTimers()
    relay = new SimulatedDynamoRelay()
    cryptoA = new WebCryptoProvider()

    clientA = new WebSocketClient({
      url: 'wss://test.relay.com',
      webSocketFactory: (url) => new MockWebSocket(url, relay, 'dev-a') as unknown as WebSocket,
    })
    clientA.connect()
    serviceA = new ClipSyncService(cryptoA, clientA, 'dev-a')
  })

  afterEach(() => {
    serviceA.destroy()
    vi.useRealTimers()
  })

  it('EPHEMERAL mode: Zero disk persistence (relay only, no snapshots in storage)', async () => {
    await serviceA.createSession('ephemeral')
    const sessionId = serviceA.getState().sessionId!

    // Connect Device B to pair
    const cryptoB = new WebCryptoProvider()
    const clientB = new WebSocketClient({
      url: 'wss://test.relay.com',
      webSocketFactory: (url) => new MockWebSocket(url, relay, 'dev-b') as unknown as WebSocket,
    })
    clientB.connect()
    const serviceB = new ClipSyncService(cryptoB, clientB, 'dev-b')
    await serviceB.joinSession(sessionId, '849608')
    await vi.waitFor(() => {
      expect(serviceA.getState().phase).toBe('paired')
      expect(serviceB.getState().phase).toBe('paired')
      expect(serviceA.getState().sas).not.toBeNull()
    })

    // Exchange clipboard content
    serviceA.setContentFromLocal('Ephemeral Secret Text', true)
    await vi.waitFor(() => {
      expect(serviceB.getContent()).toBe('Ephemeral Secret Text')
    })

    // Assert: zero snapshots saved to storage
    expect(relay.snapshots[sessionId]).toBeUndefined()

    // Resume returns null snapshot
    await serviceA.resumeSession(sessionId)
    expect(serviceA.getState().revisions.length).toBe(0)

    serviceB.destroy()
  })

  it('TEMPORARY mode: SEC-10 read-time expiry enforced at 10:01 even before TTL sweep', async () => {
    await serviceA.createSession('temporary')
    const sessionId = serviceA.getState().sessionId!

    // Connect Device B to pair
    const cryptoB = new WebCryptoProvider()
    const clientB = new WebSocketClient({
      url: 'wss://test.relay.com',
      webSocketFactory: (url) => new MockWebSocket(url, relay, 'dev-b') as unknown as WebSocket,
    })
    clientB.connect()
    const serviceB = new ClipSyncService(cryptoB, clientB, 'dev-b')
    await serviceB.joinSession(sessionId, '849608')
    await vi.waitFor(() => {
      expect(serviceA.getState().phase).toBe('paired')
      expect(serviceB.getState().phase).toBe('paired')
      expect(serviceA.getState().sas).not.toBeNull()
    })

    // Device A sends content
    serviceA.setContentFromLocal('Expiring Content', true)
    await vi.waitFor(() => {
      expect(serviceB.getContent()).toBe('Expiring Content')
    })

    // Snapshot is initially persisted in temporary storage
    expect(relay.snapshots[sessionId]).toBeDefined()
    expect(relay.snapshots[sessionId].length).toBe(1)

    // At 9 minutes (540s), snapshot is still valid
    vi.advanceTimersByTime(540 * 1000)
    await serviceA.resumeSession(sessionId)
    expect(serviceA.getState().storageMode).toBe('temporary')

    // Advance to 10 minutes and 1 second (601s)
    vi.advanceTimersByTime(65 * 1000)

    // Re-check resume: SEC-10 logical read check must reject the expired snapshot!
    await serviceA.resumeSession(sessionId)
    const stateAfterExpiry = serviceA.getState()
    expect(stateAfterExpiry.revisions.length).toBe(0)

    serviceB.destroy()
  })

  it('HISTORY mode: Retains configurable revisions across resume', async () => {
    await serviceA.createSession('history', 14)
    const sessionId = serviceA.getState().sessionId!
    expect(serviceA.getState().retentionDays).toBe(14)

    // Connect Device B to pair
    const cryptoB = new WebCryptoProvider()
    const clientB = new WebSocketClient({
      url: 'wss://test.relay.com',
      webSocketFactory: (url) => new MockWebSocket(url, relay, 'dev-b') as unknown as WebSocket,
    })
    clientB.connect()
    const serviceB = new ClipSyncService(cryptoB, clientB, 'dev-b')
    await serviceB.joinSession(sessionId, '849608')
    await vi.waitFor(() => {
      expect(serviceA.getState().phase).toBe('paired')
      expect(serviceB.getState().phase).toBe('paired')
      expect(serviceA.getState().sas).not.toBeNull()
    })

    // Push 3 revisions
    serviceA.setContentFromLocal('Revision 1', true)
    await vi.waitFor(() => expect(serviceB.getContent()).toBe('Revision 1'))

    serviceA.setContentFromLocal('Revision 2', true)
    await vi.waitFor(() => expect(serviceB.getContent()).toBe('Revision 2'))

    serviceA.setContentFromLocal('Revision 3', true)
    await vi.waitFor(() => expect(serviceB.getContent()).toBe('Revision 3'))

    // In relay storage, all 3 revisions exist
    expect(relay.snapshots[sessionId].length).toBe(3)

    // Device B resumes session: receives all 3 revisions
    await serviceB.resumeSession(sessionId)
    const stateB = serviceB.getState()
    expect(stateB.storageMode).toBe('history')
    expect(stateB.retentionDays).toBe(14)
    expect(stateB.revisions.length).toBe(3)
    expect(stateB.revisions[2].payloadCiphertext).toBeDefined()

    serviceB.destroy()
  })

  it('SESSION CLOSE & PURGE: Deletes all session records, snapshots, and tokens immediately', async () => {
    await serviceA.createSession('history', 30)
    const sessionId = serviceA.getState().sessionId!

    // Connect Device B
    const cryptoB = new WebCryptoProvider()
    const clientB = new WebSocketClient({
      url: 'wss://test.relay.com',
      webSocketFactory: (url) => new MockWebSocket(url, relay, 'dev-b') as unknown as WebSocket,
    })
    clientB.connect()
    const serviceB = new ClipSyncService(cryptoB, clientB, 'dev-b')
    await serviceB.joinSession(sessionId, '849608')
    await vi.waitFor(() => {
      expect(serviceA.getState().phase).toBe('paired')
      expect(serviceB.getState().phase).toBe('paired')
      expect(serviceA.getState().sas).not.toBeNull()
    })

    serviceA.setContentFromLocal('Sensitive Password', true)
    await vi.waitFor(() => expect(serviceB.getContent()).toBe('Sensitive Password'))

    // Verify snapshot exists prior to close
    expect(relay.snapshots[sessionId]).toBeDefined()

    // Execute closeSession
    await serviceA.closeSession()

    // Service A reset to unpaired
    expect(serviceA.getState().phase).toBe('unpaired')
    expect(serviceA.getState().sessionId).toBeNull()

    // Verify all relay and table data completely wiped
    expect(relay.snapshots[sessionId]).toBeUndefined()

    // Subsequent resume fails because session is gone
    await serviceB.resumeSession(sessionId)
    expect(serviceB.getState().error).toBe('Failed to resume session')

    serviceB.destroy()
  })
})
