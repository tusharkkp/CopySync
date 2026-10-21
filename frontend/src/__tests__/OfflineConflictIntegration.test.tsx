import { describe, it, expect, vi } from 'vitest'
import { ClipSyncService } from '../sync/ClipSyncService'
import { WebCryptoProvider } from '../crypto/WebCryptoProvider'
import { WebSocketClient } from '../transport/WebSocketClient'

// Simulated Two-Way Relay Hub with Revocation and Offline Simulation
class SimulatedRelay {
  private sockets: { [deviceId: string]: MockWebSocket } = {}
  private sessions: {
    [sessionId: string]: {
      initiatorDeviceId: string
      initiatorKeys: { signing: string; hpke: string }
      participants: { [deviceId: string]: { signing: string; hpke: string } }
      revokedDevices: Set<string>
      keyEpoch: number
      pairingCode: string
    }
  } = {}

  public register(deviceId: string, socket: MockWebSocket) {
    this.sockets[deviceId] = socket
  }

  public unregister(deviceId: string) {
    delete this.sockets[deviceId]
  }

  public handleOutbound(fromDeviceId: string, frame: Record<string, unknown>) {
    const action = frame.action as string
    const fromSocket = this.sockets[fromDeviceId]
    const sessionId = frame.sessionId as string
    const session = this.sessions[sessionId]

    // Block revoked devices
    if (session && session.revokedDevices.has(fromDeviceId)) {
      if (fromSocket) {
        fromSocket.simulateInbound({
          status: 'ERROR',
          action,
          errorCode: 'DEVICE_REVOKED',
          errorMessage: 'Device has been revoked from this session',
        })
      }
      return
    }

    if (action === 'session.create') {
      const pairingCode = '849608'
      this.sessions[sessionId] = {
        initiatorDeviceId: fromDeviceId,
        initiatorKeys: {
          signing: frame.publicSigningKeyB64 as string,
          hpke: frame.publicHpkeKeyB64 as string,
        },
        participants: {
          [fromDeviceId]: {
            signing: frame.publicSigningKeyB64 as string,
            hpke: frame.publicHpkeKeyB64 as string,
          },
        },
        revokedDevices: new Set<string>(),
        keyEpoch: 1,
        pairingCode,
      }

      if (fromSocket) {
        fromSocket.simulateInbound({
          status: 'OK',
          action: 'session.create',
          requestId: frame.requestId,
          data: {
            sessionId,
            pairingCode,
            storageMode: frame.storageMode || 'EPHEMERAL',
            keyEpoch: 1,
          },
        })
      }
      return
    }

    if (action === 'session.join') {
      if (!session) {
        if (fromSocket) {
          fromSocket.simulateInbound({
            status: 'ERROR',
            action: 'session.join',
            errorCode: 'SESSION_NOT_FOUND',
          })
        }
        return
      }

      const joinerKeys = {
        signing: frame.publicSigningKeyB64 as string,
        hpke: frame.publicHpkeKeyB64 as string,
      }
      session.participants[fromDeviceId] = joinerKeys

      // 1. Confirm joiner
      if (fromSocket) {
        fromSocket.simulateInbound({
          status: 'OK',
          action: 'session.join',
          requestId: frame.requestId,
          data: { sessionId, status: 'ACTIVE', keyEpoch: session.keyEpoch },
        })
      }

      // 2. Cross-notify peers
      Object.keys(session.participants).forEach((peerId) => {
        if (peerId !== fromDeviceId && this.sockets[peerId]) {
          this.sockets[peerId].simulateInbound({
            v: 1,
            action: 'peer.joined',
            deviceId: fromDeviceId,
            publicSigningKeyB64: joinerKeys.signing,
            publicHpkeKeyB64: joinerKeys.hpke,
          })
        }
      })

      // Notify joiner of existing participants
      Object.entries(session.participants).forEach(([peerId, pKeys]) => {
        if (peerId !== fromDeviceId && fromSocket) {
          fromSocket.simulateInbound({
            v: 1,
            action: 'peer.joined',
            deviceId: peerId,
            publicSigningKeyB64: pKeys.signing,
            publicHpkeKeyB64: pKeys.hpke,
          })
        }
      })
      return
    }

    if (action === 'device.revoke') {
      const targetDeviceId = frame.targetDeviceId as string
      if (!session) return

      session.revokedDevices.add(targetDeviceId)
      delete session.participants[targetDeviceId]
      session.keyEpoch += 1

      // Acknowledge revocation to caller
      if (fromSocket) {
        fromSocket.simulateInbound({
          status: 'OK',
          action: 'device.revoke',
          requestId: frame.requestId,
          data: {
            sessionId,
            revokedDeviceId: targetDeviceId,
            keyEpoch: session.keyEpoch,
          },
        })
      }

      // Broadcast device.revoked to all participants and the revoked device
      const broadcastFrame = {
        v: 1,
        action: 'device.revoked',
        sessionId,
        revokedDeviceId: targetDeviceId,
        keyEpoch: session.keyEpoch,
      }

      Object.keys(this.sockets).forEach((dId) => {
        if (dId !== fromDeviceId && this.sockets[dId]) {
          this.sockets[dId].simulateInbound(broadcastFrame)
        }
      })

      // Drop connection of revoked device
      if (this.sockets[targetDeviceId]) {
        this.sockets[targetDeviceId].close()
        delete this.sockets[targetDeviceId]
      }
      return
    }

    if (action === 'clipboard.update') {
      // Forward to other participants
      if (session) {
        Object.keys(session.participants).forEach((targetId) => {
          if (targetId !== fromDeviceId && this.sockets[targetId]) {
            this.sockets[targetId].simulateInbound(frame)
          }
        })
      }
      return
    }
  }
}

class MockWebSocket {
  public readyState = 1 // OPEN
  public onmessage: ((event: { data: string }) => void) | null = null
  public onopen: (() => void) | null = null
  public onclose: (() => void) | null = null
  private relay: SimulatedRelay
  private deviceId: string

  constructor(deviceId: string, relay: SimulatedRelay) {
    this.deviceId = deviceId
    this.relay = relay
    this.relay.register(deviceId, this)
  }

  public send(data: string) {
    if (this.readyState !== 1) return
    const parsed = JSON.parse(data)
    this.relay.handleOutbound(this.deviceId, parsed)
  }

  public simulateInbound(data: Record<string, unknown>) {
    if (this.onmessage && this.readyState === 1) {
      this.onmessage({ data: JSON.stringify(data) })
    }
  }

  public close() {
    this.readyState = 3
    this.relay.unregister(this.deviceId)
    if (this.onclose) this.onclose()
  }
}

describe('GATE-08: Offline Queuing, Deterministic LWW Conflicts & Revocation Integration', () => {
  it('queues edits while offline and automatically flushes on reconnect without lost keystrokes', async () => {
    const relay = new SimulatedRelay()
    const cryptoA = new WebCryptoProvider()
    const cryptoB = new WebCryptoProvider()

    // 1. Setup Device A (Laptop)
    let currentSocketA: MockWebSocket | null = null
    const wsClientA = new WebSocketClient({
      url: 'wss://relay.example.com',
      webSocketFactory: () => {
        currentSocketA = new MockWebSocket('dev-laptop-01', relay)
        return currentSocketA as unknown as WebSocket
      },
    })
    const serviceA = new ClipSyncService(cryptoA, wsClientA, 'dev-laptop-01')

    // 2. Setup Device B (Phone)
    let currentSocketB: MockWebSocket | null = null
    const wsClientB = new WebSocketClient({
      url: 'wss://relay.example.com',
      webSocketFactory: () => {
        currentSocketB = new MockWebSocket('dev-phone-02', relay)
        return currentSocketB as unknown as WebSocket
      },
    })
    const serviceB = new ClipSyncService(cryptoB, wsClientB, 'dev-phone-02')

    // 3. Create session on Device A
    await serviceA.createSession('ephemeral')
    const sessionId = serviceA.getState().sessionId!
    const pairingCode = serviceA.getState().pairingCode!
    expect(sessionId).toBeDefined()
    expect(pairingCode).toBe('849608')

    // 4. Device B joins session
    await serviceB.joinSession(sessionId, pairingCode)
    await vi.waitFor(() => {
      expect(serviceA.getState().phase).toBe('paired')
      expect(serviceB.getState().phase).toBe('paired')
    })

    // 5. Device A goes offline (transport connection dropped)
    currentSocketA?.close()
    expect(wsClientA.getStatus()).not.toBe('connected')

    // 6. Device A types edit while offline
    serviceA.setContentFromLocal('Offline secret written on flight', true)

    // Verify it is queued in pendingQueue and NOT yet delivered to Device B
    await vi.waitFor(() => {
      expect(serviceA.getState().pendingQueueLength).toBe(1)
    })
    expect(serviceB.getContent()).toBe('')

    // 7. Device A reconnects to relay
    wsClientA.connect()
    if (currentSocketA && (currentSocketA as MockWebSocket).onopen) {
      ;(currentSocketA as MockWebSocket).onopen!()
    }

    // 8. Auto-flush flushes pending queue; Device B receives and decrypts edit
    await vi.waitFor(() => {
      expect(serviceA.getState().pendingQueueLength).toBe(0)
      expect(serviceB.getContent()).toBe('Offline secret written on flight')
    })

    serviceA.destroy()
    serviceB.destroy()
  })

  it('converges concurrent edits between peers deterministically via LWW tuple and preserves losing edit in conflicts (DEC-016)', async () => {
    const relay = new SimulatedRelay()
    const cryptoA = new WebCryptoProvider()
    const cryptoB = new WebCryptoProvider()

    // Note: 'dev-phone-02' > 'dev-laptop-01' lexicographically
    let currentSocketA: MockWebSocket | null = null
    const wsClientA = new WebSocketClient({
      url: 'wss://relay.example.com',
      webSocketFactory: () => {
        currentSocketA = new MockWebSocket('dev-laptop-01', relay)
        return currentSocketA as unknown as WebSocket
      },
    })
    const serviceA = new ClipSyncService(cryptoA, wsClientA, 'dev-laptop-01')

    let currentSocketB: MockWebSocket | null = null
    const wsClientB = new WebSocketClient({
      url: 'wss://relay.example.com',
      webSocketFactory: () => {
        currentSocketB = new MockWebSocket('dev-phone-02', relay)
        return currentSocketB as unknown as WebSocket
      },
    })
    const serviceB = new ClipSyncService(cryptoB, wsClientB, 'dev-phone-02')

    await serviceA.createSession('ephemeral')
    const sessionId = serviceA.getState().sessionId!
    await serviceB.joinSession(sessionId, '849608')

    await vi.waitFor(() => {
      expect(serviceA.getState().phase).toBe('paired')
      expect(serviceB.getState().phase).toBe('paired')
    })

    // Disconnect both sockets from relay so edits are created offline concurrently
    currentSocketA?.close()
    currentSocketB?.close()

    // Both peers make concurrent edits at logicalClock = 1
    serviceA.setContentFromLocal('Laptop concurrent note', true)
    serviceB.setContentFromLocal('Phone concurrent note', true)

    await vi.waitFor(() => {
      expect(serviceA.getState().pendingQueueLength).toBe(1)
      expect(serviceB.getState().pendingQueueLength).toBe(1)
    })

    // Reconnect both devices
    wsClientA.connect()
    if (currentSocketA && (currentSocketA as MockWebSocket).onopen) {
      ;(currentSocketA as MockWebSocket).onopen!()
    }

    wsClientB.connect()
    if (currentSocketB && (currentSocketB as MockWebSocket).onopen) {
      ;(currentSocketB as MockWebSocket).onopen!()
    }

    // Both queues flush and deliver to each other
    // Tie-break: logicalClock is equal (1 vs 1).
    // senderDeviceId: 'dev-phone-02' > 'dev-laptop-01'.
    // Therefore Phone wins on BOTH peers!
    await vi.waitFor(() => {
      expect(serviceA.getContent()).toBe('Phone concurrent note')
      expect(serviceB.getContent()).toBe('Phone concurrent note')
    })

    // Verify loser is preserved in conflicts list on Device A (no silent data loss)
    const stateA = serviceA.getState()
    expect(stateA.conflicts.length).toBeGreaterThanOrEqual(1)
    expect(stateA.conflicts[0].plaintext).toBe('Laptop concurrent note')

    serviceA.destroy()
    serviceB.destroy()
  })

  it('rejects malicious inbound updates with clock drift > 10,000 without corrupting state (DEC-016)', async () => {
    const relay = new SimulatedRelay()
    const cryptoA = new WebCryptoProvider()
    const cryptoEvil = new WebCryptoProvider()

    let currentSocketA: MockWebSocket | null = null
    const wsClientA = new WebSocketClient({
      url: 'wss://relay.example.com',
      webSocketFactory: () => {
        currentSocketA = new MockWebSocket('dev-laptop-01', relay)
        return currentSocketA as unknown as WebSocket
      },
    })
    const serviceA = new ClipSyncService(cryptoA, wsClientA, 'dev-laptop-01')

    await serviceA.createSession('ephemeral')
    const sessionId = serviceA.getState().sessionId!

    // Evil peer joins session
    const evilKeys = await cryptoEvil.generateDeviceKeys('dev-evil-01')
    currentSocketA?.simulateInbound({
      v: 1,
      action: 'peer.joined',
      deviceId: 'dev-evil-01',
      publicSigningKeyB64: evilKeys.publicSigningKeyB64,
      publicHpkeKeyB64: evilKeys.publicHpkeKeyB64,
    })

    await vi.waitFor(() => {
      expect(serviceA.getState().phase).toBe('paired')
    })

    // Evil peer crafts frame with clock 50,000 (> 10,000 drift above local clock 0)
    const localKeys = await serviceA.initKeys()
    const evilHeader = {
      sessionId,
      messageId: 'msg-evil-drift',
      senderDeviceId: 'dev-evil-01',
      baseRevisionId: '',
      logicalClock: 50000,
      keyEpoch: 1,
      contentType: 'text/plain;charset=utf-8',
      plaintextBytes: 15,
    }

    const wireMsg = await cryptoEvil.encryptSnapshot(
      'Hacked malicious text',
      evilHeader,
      {
        'dev-laptop-01': {
          deviceId: 'dev-laptop-01',
          publicSigningKeyB64: localKeys.publicSigningKeyB64,
          publicHpkeKeyB64: localKeys.publicHpkeKeyB64,
        },
      },
      evilKeys,
      'clipboard.update'
    )

    currentSocketA?.simulateInbound({
      ...wireMsg,
      sessionId,
    })

    // Wait a brief moment to ensure inbound message was processed
    await new Promise((r) => setTimeout(r, 100))

    // Local content was NOT overwritten, logical clock was NOT corrupted to 50000
    expect(serviceA.getContent()).toBe('')
    expect(serviceA.getState().logicalClock).toBe(0)

    serviceA.destroy()
  })

  it('revokes compromised device, advances keyEpoch, drops connection, and blocks revoked device from future sync (SEC-11)', async () => {
    const relay = new SimulatedRelay()
    const cryptoA = new WebCryptoProvider()
    const cryptoB = new WebCryptoProvider()

    let currentSocketA: MockWebSocket | null = null
    const wsClientA = new WebSocketClient({
      url: 'wss://relay.example.com',
      webSocketFactory: () => {
        currentSocketA = new MockWebSocket('dev-laptop-01', relay)
        return currentSocketA as unknown as WebSocket
      },
    })
    const serviceA = new ClipSyncService(cryptoA, wsClientA, 'dev-laptop-01')

    let currentSocketB: MockWebSocket | null = null
    const wsClientB = new WebSocketClient({
      url: 'wss://relay.example.com',
      webSocketFactory: () => {
        currentSocketB = new MockWebSocket('dev-compromised-phone', relay)
        return currentSocketB as unknown as WebSocket
      },
    })
    const serviceB = new ClipSyncService(cryptoB, wsClientB, 'dev-compromised-phone')

    await serviceA.createSession('ephemeral')
    const sessionId = serviceA.getState().sessionId!
    await serviceB.joinSession(sessionId, '849608')

    await vi.waitFor(() => {
      expect(serviceA.getState().phase).toBe('paired')
      expect(serviceB.getState().phase).toBe('paired')
      expect(serviceA.getState().keyEpoch).toBe(1)
    })

    // Device A revokes Device B
    await serviceA.revokeDevice('dev-compromised-phone')

    // Verify Device A advanced keyEpoch to 2 and removed Device B from peers
    await vi.waitFor(() => {
      expect(serviceA.getState().keyEpoch).toBe(2)
      expect(serviceA.getState().peers['dev-compromised-phone']).toBeUndefined()
    })

    // Verify Device B received broadcast and left session with revocation error
    await vi.waitFor(() => {
      expect(serviceB.getState().phase).toBe('unpaired')
      expect(serviceB.getState().error).toContain('revoked')
    })

    serviceA.destroy()
    serviceB.destroy()
  })
})
