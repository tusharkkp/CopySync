import { describe, it, expect } from 'vitest'
import { ClipSyncService } from '../sync/ClipSyncService'
import { WebCryptoProvider } from '../crypto/WebCryptoProvider'
import { WebSocketClient } from '../transport/WebSocketClient'

// Simulated Two-Way Relay Hub
class SimulatedRelay {
  private sockets: { [deviceId: string]: MockWebSocket } = {}
  private sessions: {
    [sessionId: string]: {
      initiatorDeviceId: string
      initiatorKeys: { signing: string; hpke: string }
      joinerDeviceId?: string
      joinerKeys?: { signing: string; hpke: string }
      pairingCode: string
    }
  } = {}

  public register(deviceId: string, socket: MockWebSocket) {
    this.sockets[deviceId] = socket
  }

  public handleOutbound(fromDeviceId: string, frame: Record<string, unknown>) {
    const action = frame.action as string
    const fromSocket = this.sockets[fromDeviceId]

    if (action === 'session.create') {
      const sessionId = frame.sessionId as string
      const pairingCode = '849608'
      this.sessions[sessionId] = {
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
          storageMode: frame.storageMode || 'EPHEMERAL',
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

      // 1. Confirm joiner
      fromSocket.simulateInbound({
        status: 'OK',
        action: 'session.join',
        requestId: frame.requestId,
        data: { sessionId, status: 'ACTIVE', keyEpoch: 1 },
      })

      // 2. Notify initiator of joiner keys
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

      // 3. Notify joiner of initiator keys
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
      // Forward to other peers in session
      Object.keys(this.sockets).forEach((targetId) => {
        if (targetId !== fromDeviceId) {
          this.sockets[targetId].simulateInbound(frame)
        }
      })
      return
    }
  }
}

class MockWebSocket {
  public readyState = 1
  public onmessage: ((event: { data: string }) => void) | null = null
  private relay: SimulatedRelay
  private deviceId: string

  constructor(deviceId: string, relay: SimulatedRelay) {
    this.deviceId = deviceId
    this.relay = relay
    this.relay.register(deviceId, this)
  }

  public send(data: string) {
    const parsed = JSON.parse(data)
    this.relay.handleOutbound(this.deviceId, parsed)
  }

  public simulateInbound(data: Record<string, unknown>) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) })
    }
  }

  public close() {
    this.readyState = 3
  }
}

describe('GATE-05: Multi-Device E2EE Real-Time Editor Synchronization', () => {
  it('pairs two independent browser devices and bi-directionally syncs encrypted edits', async () => {
    const relay = new SimulatedRelay()
    const cryptoA = new WebCryptoProvider()
    const cryptoB = new WebCryptoProvider()

    // 1. Setup Device A (Laptop - Initiator)
    const wsClientA = new WebSocketClient({
      url: 'wss://relay.example.com',
      webSocketFactory: () => new MockWebSocket('dev-laptop-A', relay) as unknown as WebSocket,
    })
    wsClientA.connect()
    const serviceA = new ClipSyncService(cryptoA, wsClientA, 'dev-laptop-A')

    // 2. Setup Device B (Phone - Joiner)
    const wsClientB = new WebSocketClient({
      url: 'wss://relay.example.com',
      webSocketFactory: () => new MockWebSocket('dev-phone-B', relay) as unknown as WebSocket,
    })
    wsClientB.connect()
    const serviceB = new ClipSyncService(cryptoB, wsClientB, 'dev-phone-B')

    // 3. Device A creates a session
    await serviceA.createSession('ephemeral')
    const stateA = serviceA.getState()
    expect(stateA.phase).toBe('waiting_for_peer')
    expect(stateA.sessionId).toBeDefined()
    expect(stateA.pairingCode).toBe('849608')

    // 4. Device B joins with Session ID and Pairing Code
    await serviceB.joinSession(stateA.sessionId!, '849608')

    // Allow event loops for SAS derivation and peer exchange
    await new Promise((r) => setTimeout(r, 200))

    // Verify both devices are now PAIRED
    expect(serviceA.getState().phase).toBe('paired')
    expect(serviceB.getState().phase).toBe('paired')

    // Verify matching Safety Fingerprints (SAS) on both devices
    expect(serviceA.getState().sas).toBeDefined()
    expect(serviceB.getState().sas).toBeDefined()
    expect(serviceA.getState().sas?.hex).toBe(serviceB.getState().sas?.hex)
    expect(serviceA.getState().sas?.emojis).toBe(serviceB.getState().sas?.emojis)

    // 5. Device A pastes text: "Confidential Project Strategy"
    serviceA.setContentFromLocal('Confidential Project Strategy', true)
    await new Promise((r) => setTimeout(r, 200))

    // Device B should receive and decrypt automatically!
    expect(serviceB.getContent()).toBe('Confidential Project Strategy')

    // 6. Device B replies: "Strategy Approved. Proceed with Phase 5."
    serviceB.setContentFromLocal('Strategy Approved. Proceed with Phase 5.', true)
    await new Promise((r) => setTimeout(r, 200))

    // Device A should receive and decrypt automatically!
    expect(serviceA.getContent()).toBe('Strategy Approved. Proceed with Phase 5.')

    // 7. Clean up
    serviceA.destroy()
    serviceB.destroy()
    wsClientA.disconnect()
    wsClientB.disconnect()
  })
})
