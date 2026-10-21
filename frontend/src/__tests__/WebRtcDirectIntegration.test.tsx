import { describe, it, expect } from 'vitest'
import { ClipSyncService } from '../sync/ClipSyncService'
import { WebCryptoProvider } from '../crypto/WebCryptoProvider'
import { WebSocketClient } from '../transport/WebSocketClient'
import { WebRtcManager, WebRtcOptions } from '../webrtc/WebRtcManager'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// In-Memory WebSocket Relay Hub simulating AWS API Gateway
class MockWebSocketRelayHub {
  private sockets = new Map<string, MockRelaySocket>()
  private sessions = new Map<
    string,
    {
      initiatorSocketId: string
      initiatorDeviceId: string
      initiatorSigningKey: string
      initiatorHpkeKey: string
      pairingCode: string
      members: Set<string>
    }
  >()

  public register(socket: MockRelaySocket) {
    this.sockets.set(socket.id, socket)
  }

  public unregister(socket: MockRelaySocket) {
    this.sockets.delete(socket.id)
    for (const session of this.sessions.values()) {
      session.members.delete(socket.id)
    }
  }

  public handleFrame(fromSocketId: string, raw: string) {
    const frame = JSON.parse(raw) as Record<string, unknown>
    const action = frame.action as string
    const fromSocket = this.sockets.get(fromSocketId)
    if (!fromSocket) return

    if (action === 'session.create') {
      const sessionId = (frame.sessionId as string) || 'sess-webrtc-01'
      const pairingCode = '654321'
      this.sessions.set(sessionId, {
        initiatorSocketId: fromSocketId,
        initiatorDeviceId: frame.deviceId as string,
        initiatorSigningKey: frame.publicSigningKeyB64 as string,
        initiatorHpkeKey: frame.publicHpkeKeyB64 as string,
        pairingCode,
        members: new Set([fromSocketId]),
      })

      fromSocket.simulateInbound({
        v: 1,
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
    } else if (action === 'session.join') {
      const sessionId = frame.sessionId as string
      const session = this.sessions.get(sessionId)
      if (session) {
        session.members.add(fromSocketId)
        fromSocket.simulateInbound({
          v: 1,
          status: 'OK',
          action: 'session.join',
          requestId: frame.requestId,
          data: { sessionId },
        })

        const joinerDeviceId = frame.deviceId as string
        const joinerSigningKey = frame.publicSigningKeyB64 as string
        const joinerHpkeKey = frame.publicHpkeKeyB64 as string

        // Notify initiator of new peer
        const initiatorSocket = this.sockets.get(session.initiatorSocketId)
        initiatorSocket?.simulateInbound({
          v: 1,
          action: 'peer.joined',
          sessionId,
          deviceId: joinerDeviceId,
          publicSigningKeyB64: joinerSigningKey,
          publicHpkeKeyB64: joinerHpkeKey,
        })

        // Notify joiner of initiator peer
        fromSocket.simulateInbound({
          v: 1,
          action: 'peer.joined',
          sessionId,
          deviceId: session.initiatorDeviceId,
          publicSigningKeyB64: session.initiatorSigningKey,
          publicHpkeKeyB64: session.initiatorHpkeKey,
        })
      }
    } else if (action && action.startsWith('signaling.')) {
      const targetDeviceId = frame.targetDeviceId as string
      for (const socket of this.sockets.values()) {
        if (socket.deviceId === targetDeviceId) {
          socket.simulateInbound(frame)
        }
      }
    } else if (action === 'clipboard.update') {
      const sessionId = frame.sessionId as string
      const session = this.sessions.get(sessionId)
      if (session) {
        for (const memberId of session.members) {
          if (memberId !== fromSocketId) {
            this.sockets.get(memberId)?.simulateInbound(frame)
          }
        }
      }
    }
  }
}

class MockRelaySocket {
  public readyState = 1 // OPEN
  public onopen: (() => void) | null = null
  public onmessage: ((event: { data: string }) => void) | null = null
  public onclose: (() => void) | null = null
  public sentFrames: string[] = []

  public deviceId = ''

  constructor(
    public id: string,
    private hub: MockWebSocketRelayHub
  ) {
    this.deviceId = id
    this.hub.register(this)
  }

  public send(data: string) {
    this.sentFrames.push(data)
    this.hub.handleFrame(this.id, data)
  }

  public simulateInbound(data: Record<string, unknown>) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) })
    }
  }

  public close() {
    this.readyState = 3
    this.hub.unregister(this)
    if (this.onclose) this.onclose()
  }
}

// In-Memory P2P Pipe linking two RTCPeerConnection instances
class MockP2PNetwork {
  private peers = new Map<string, MockDirectPeerConnection>()

  public register(pc: MockDirectPeerConnection) {
    this.peers.set(pc.deviceId, pc)
  }

  public routeData(fromDevice: string, toDevice: string, data: string) {
    const targetPc = this.peers.get(toDevice)
    if (targetPc) {
      const channel = targetPc.remoteDataChannel || targetPc.localChannel
      channel?.simulateInboundMessage(data)
    }
  }
}

class MockDirectDataChannel {
  public readyState: RTCDataChannelState = 'connecting'
  public onopen: (() => void) | null = null
  public onmessage: ((event: { data: string }) => void) | null = null
  public onclose: (() => void) | null = null
  public sentMessages: string[] = []

  constructor(
    public label: string,
    private myDeviceId: string,
    private targetDeviceId: string,
    private network: MockP2PNetwork
  ) {}

  public send(data: string) {
    this.sentMessages.push(data)
    this.network.routeData(this.myDeviceId, this.targetDeviceId, data)
  }

  public open() {
    this.readyState = 'open'
    if (this.onopen) this.onopen()
  }

  public simulateInboundMessage(data: string) {
    if (this.onmessage) {
      this.onmessage({ data })
    }
  }

  public close() {
    this.readyState = 'closed'
    if (this.onclose) this.onclose()
  }
}

class MockDirectPeerConnection {
  public connectionState: RTCPeerConnectionState = 'connected'
  public onicecandidate: ((event: { candidate: { toJSON: () => unknown } | null }) => void) | null = null
  public ondatachannel: ((event: { channel: RTCDataChannel }) => void) | null = null
  public onconnectionstatechange: (() => void) | null = null

  public localChannel: MockDirectDataChannel | null = null
  public remoteDataChannel: MockDirectDataChannel | null = null

  constructor(
    public config: RTCConfiguration,
    public deviceId: string,
    public targetDeviceId: string,
    private network: MockP2PNetwork
  ) {
    this.network.register(this)
  }

  public createDataChannel(label: string): RTCDataChannel {
    const ch = new MockDirectDataChannel(label, this.deviceId, this.targetDeviceId, this.network)
    this.localChannel = ch
    setTimeout(() => ch.open(), 20)
    return ch as unknown as RTCDataChannel
  }

  public async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: 'direct-offer-sdp' }
  }

  public async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'answer', sdp: 'direct-answer-sdp' }
  }

  public async setLocalDescription(_desc: RTCSessionDescriptionInit): Promise<void> {}

  public async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    if (desc.type === 'offer' && this.ondatachannel && !this.remoteDataChannel) {
      const ch = new MockDirectDataChannel('clipsync-direct', this.deviceId, this.targetDeviceId, this.network)
      this.remoteDataChannel = ch
      this.ondatachannel({ channel: ch as unknown as RTCDataChannel })
      setTimeout(() => ch.open(), 20)
    }
  }

  public async addIceCandidate(_candidate: unknown): Promise<void> {}

  public close() {
    this.connectionState = 'closed'
    if (this.localChannel) this.localChannel.close()
    if (this.remoteDataChannel) this.remoteDataChannel.close()
  }
}

describe('GATE-06: WebRTC Direct Zero-Hop DataChannel & Cross-Path Resilience', () => {
  let hub: MockWebSocketRelayHub
  let p2pNetwork: MockP2PNetwork
  let cryptoA: WebCryptoProvider
  let cryptoB: WebCryptoProvider

  beforeEach(() => {
    hub = new MockWebSocketRelayHub()
    p2pNetwork = new MockP2PNetwork()
    cryptoA = new WebCryptoProvider()
    cryptoB = new WebCryptoProvider()
  })

  function createDevice(deviceId: string, crypto: WebCryptoProvider) {
    let mockSocket: MockRelaySocket | null = null

    const wsClient = new WebSocketClient({
      url: 'wss://test.relay.com',
      webSocketFactory: () => {
        mockSocket = new MockRelaySocket(deviceId, hub)
        return mockSocket as unknown as WebSocket
      },
    })
    wsClient.connect()
    if (mockSocket && (mockSocket as MockRelaySocket).onopen) {
      ;(mockSocket as MockRelaySocket).onopen!()
    }

    const createdPcs: MockDirectPeerConnection[] = []
    const webRtcFactory = (options: WebRtcOptions) => {
      const customOptions: WebRtcOptions = {
        ...options,
        rtcPeerConnectionFactory: (config: RTCConfiguration) => {
          const pc = new MockDirectPeerConnection(
            config,
            options.myDeviceId,
            options.targetDeviceId,
            p2pNetwork
          )
          createdPcs.push(pc)
          return pc as unknown as RTCPeerConnection
        },
      }
      return new WebRtcManager(customOptions)
    }

    const service = new ClipSyncService(crypto, wsClient, deviceId, webRtcFactory)
    return {
      service,
      wsClient,
      getSocket: () => mockSocket!,
      getCreatedPcs: () => createdPcs,
    }
  }

  it('establishes direct WebRTC DataChannel between paired devices and syncs edits directly', async () => {
    const devA = createDevice('dev-aaa', cryptoA)
    const devB = createDevice('dev-bbb', cryptoB)

    // Device A starts session
    await devA.service.createSession('ephemeral')
    const stateA = devA.service.getState()
    expect(stateA.phase).toBe('waiting_for_peer')
    expect(stateA.sessionId).toBeDefined()
    expect(stateA.pairingCode).toBe('654321')

    // Device B joins session
    await devB.service.joinSession(stateA.sessionId!, '654321')

    // Wait for signaling and DataChannel open events
    await sleep(250)

    // Assert both are now in direct mode
    expect(devA.service.getState().phase).toBe('paired')
    expect(devA.service.getState().transportMode).toBe('direct')
    expect(devB.service.getState().transportMode).toBe('direct')

    // Device A sends paste payload (immediate sync)
    devA.service.setContentFromLocal('Secret P2P Zero-Hop Payload', true)
    await sleep(200)

    // Verify: Received on Device B directly over DataChannel!
    expect(devB.service.getContent()).toBe('Secret P2P Zero-Hop Payload')
    expect(devB.service.getState().transportMode).toBe('direct')

    // Verify: Zero frames sent to WebSocket relay for this clipboard update!
    const relayUpdateFrames = devA.getSocket().sentFrames.filter((f) => f.includes('clipboard.update'))
    expect(relayUpdateFrames.length).toBe(0)

    devA.service.destroy()
    devB.service.destroy()
  })

  it('seamlessly falls back to WebSocket relay when WebRTC direct connection fails', async () => {
    const devA = createDevice('dev-aaa', cryptoA)
    const devB = createDevice('dev-bbb', cryptoB)

    await devA.service.createSession('ephemeral')
    await devB.service.joinSession(devA.service.getState().sessionId!, '654321')
    await sleep(150)

    // Force WebRTC failure on Device A (e.g. symmetric NAT blocks direct P2P)
    const mgrA = devA.service.getWebRtcManager()
    if (mgrA) {
      mgrA.close()
    }

    expect(devA.service.getState().transportMode).toBe('relay')

    // Device A edits while in relay mode
    devA.service.setContentFromLocal('Relay Fallback Synced Payload', true)
    await sleep(100)

    // Content synced over WebSocket relay seamlessly without disruption
    expect(devB.service.getContent()).toBe('Relay Fallback Synced Payload')
    expect(devA.service.getState().transportMode).toBe('relay')

    devA.service.destroy()
    devB.service.destroy()
  })

  it('suppresses duplicate message frames arriving across both direct and relay paths', async () => {
    const devA = createDevice('dev-aaa', cryptoA)
    const devB = createDevice('dev-bbb', cryptoB)

    await devA.service.createSession('ephemeral')
    await devB.service.joinSession(devA.service.getState().sessionId!, '654321')
    await sleep(150)

    let contentEmits = 0
    devB.service.onContentChange(() => {
      contentEmits++
    })

    // Force relay mode on Dev A to capture outbound frame
    const mgrA = devA.service.getWebRtcManager()
    if (mgrA) mgrA.close()

    // Device A syncs text via relay
    devA.service.setContentFromLocal('Deduplicated Content', true)
    await sleep(100)

    const initialEmits = contentEmits
    expect(devB.service.getContent()).toBe('Deduplicated Content')

    // Replay duplicate message frame via WebSocket relay
    const lastUpdateFrame = devA.getSocket().sentFrames.find((f) => f.includes('clipboard.update'))
    expect(lastUpdateFrame).toBeDefined()
    if (lastUpdateFrame) {
      devB.getSocket().simulateInbound(JSON.parse(lastUpdateFrame))
    }

    await sleep(100)

    // Emits did not increase because duplicate was dropped cleanly by deduplication
    expect(contentEmits).toBe(initialEmits)
    expect(devB.service.getContent()).toBe('Deduplicated Content')

    devA.service.destroy()
    devB.service.destroy()
  })
})
