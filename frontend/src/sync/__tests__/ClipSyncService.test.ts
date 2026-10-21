import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ClipSyncService } from '../ClipSyncService'
import { WebCryptoProvider } from '../../crypto/WebCryptoProvider'
import { WebSocketClient } from '../../transport/WebSocketClient'

// Mock WebSocket
class MockWebSocket {
  public static instances: MockWebSocket[] = []
  public url: string
  public readyState: number = 1 // OPEN
  public onopen: (() => void) | null = null
  public onmessage: ((event: { data: string }) => void) | null = null
  public onerror: ((error: unknown) => void) | null = null
  public onclose: (() => void) | null = null

  public sentData: string[] = []

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  public simulateMessage(data: Record<string, unknown> | string) {
    const raw = typeof data === 'string' ? data : JSON.stringify(data)
    if (this.onmessage) this.onmessage({ data: raw })
  }

  public send(data: string) {
    this.sentData.push(data)
  }

  public close() {
    this.readyState = 3
    if (this.onclose) this.onclose()
  }
}

describe('SYNC: ClipSyncService Domain Suite', () => {
  let cryptoProvider: WebCryptoProvider
  let wsClient: WebSocketClient
  let service: ClipSyncService
  let mockWs: MockWebSocket

  beforeEach(() => {
    vi.useFakeTimers()
    MockWebSocket.instances = []

    cryptoProvider = new WebCryptoProvider()
    wsClient = new WebSocketClient({
      url: 'wss://test.relay.com',
      webSocketFactory: (url) => new MockWebSocket(url) as unknown as WebSocket,
    })
    wsClient.connect()
    mockWs = MockWebSocket.instances[0]
    if (mockWs.onopen) mockWs.onopen()

    service = new ClipSyncService(cryptoProvider, wsClient, 'dev-laptop-01')
  })

  afterEach(() => {
    service.destroy()
    vi.useRealTimers()
  })

  it('generates session and pairing code on createSession', async () => {
    await service.createSession('ephemeral')
    expect(mockWs.sentData.length).toBe(1)

    const sent = JSON.parse(mockWs.sentData[0])
    expect(sent.action).toBe('session.create')
    expect(sent.deviceId).toBe('dev-laptop-01')
    expect(sent.publicSigningKeyB64).toBeDefined()
    expect(sent.publicHpkeKeyB64).toBeDefined()

    // Simulate backend response
    mockWs.simulateMessage({
      status: 'OK',
      action: 'session.create',
      data: {
        sessionId: sent.sessionId,
        pairingCode: '849608',
        storageMode: 'EPHEMERAL',
        keyEpoch: 1,
      },
    })

    const state = service.getState()
    expect(state.phase).toBe('waiting_for_peer')
    expect(state.pairingCode).toBe('849608')
    expect(state.sessionId).toBe(sent.sessionId)
  })

  it('joins session and registers peer on peer.joined', async () => {
    await service.joinSession('sess-100', '123456')
    expect(mockWs.sentData.length).toBe(1)
    const joinReq = JSON.parse(mockWs.sentData[0])
    expect(joinReq.action).toBe('session.join')
    expect(joinReq.pairingCode).toBe('123456')

    // Simulate backend OK
    await service.handleInboundMessage({
      status: 'OK',
      action: 'session.join',
      data: { sessionId: 'sess-100', status: 'ACTIVE' },
    })
    expect(service.getState().phase).toBe('paired')

    // Simulate peer.joined event from initiator
    const peerKeys = await cryptoProvider.generateDeviceKeys('dev-phone-02')
    await service.handleInboundMessage({
      v: 1,
      action: 'peer.joined',
      deviceId: 'dev-phone-02',
      publicSigningKeyB64: peerKeys.publicSigningKeyB64,
      publicHpkeKeyB64: peerKeys.publicHpkeKeyB64,
    })

    const state = service.getState()
    expect(state.peers['dev-phone-02']).toBeDefined()
    expect(state.sas).toBeDefined()
    expect(state.sas?.emojis.length).toBeGreaterThan(0)
  })

  it('debounces local typing and sends encrypted clipboard.update frame', async () => {
    // Setup paired state
    await service.createSession()
    const peerKeys = await cryptoProvider.generateDeviceKeys('dev-peer-02')
    await service.handleInboundMessage({
      v: 1,
      action: 'peer.joined',
      deviceId: 'dev-peer-02',
      publicSigningKeyB64: peerKeys.publicSigningKeyB64,
      publicHpkeKeyB64: peerKeys.publicHpkeKeyB64,
    })
    mockWs.sentData = [] // reset sentData

    // User types
    service.setContentFromLocal('Hello Secure Sync!')
    expect(mockWs.sentData.length).toBe(0) // Still debouncing

    // Advance timer past 250ms debounce and wait for encryption
    vi.advanceTimersByTime(260)
    await vi.waitFor(() => {
      expect(mockWs.sentData.length).toBe(1)
    })

    const updateFrame = JSON.parse(mockWs.sentData[0])
    expect(updateFrame.action).toBe('clipboard.update')
    expect(updateFrame.payload.ciphertext).toBeDefined()
    expect(updateFrame.payload.nonce).toBeDefined()
    expect(updateFrame.snapshotSignature).toBeDefined()
    expect(updateFrame.keyEnvelopes.length).toBe(1)
    expect(updateFrame.keyEnvelopes[0].recipientDeviceId).toBe('dev-peer-02')
  })

  it('synchronizes immediately on paste events (bypassing debounce)', async () => {
    await service.createSession()
    const peerKeys = await cryptoProvider.generateDeviceKeys('dev-peer-02')
    await service.handleInboundMessage({
      v: 1,
      action: 'peer.joined',
      deviceId: 'dev-peer-02',
      publicSigningKeyB64: peerKeys.publicSigningKeyB64,
      publicHpkeKeyB64: peerKeys.publicHpkeKeyB64,
    })
    mockWs.sentData = []

    // Paste event
    service.setContentFromLocal('Pasted Content', true)
    await vi.waitFor(() => {
      expect(mockWs.sentData.length).toBe(1)
    })

    const updateFrame = JSON.parse(mockWs.sentData[0])
    expect(updateFrame.action).toBe('clipboard.update')
  })

  it('receives, decrypts, and updates content on inbound clipboard.update without echo loop', async () => {
    const myKeys = await service.initKeys()
    await service.createSession()

    // Register Peer
    const peerKeys = await cryptoProvider.generateDeviceKeys('dev-peer-remote')
    await service.handleInboundMessage({
      v: 1,
      action: 'peer.joined',
      deviceId: 'dev-peer-remote',
      publicSigningKeyB64: peerKeys.publicSigningKeyB64,
      publicHpkeKeyB64: peerKeys.publicHpkeKeyB64,
    })
    mockWs.sentData = []

    // Remote peer encrypts a message for me
    const remoteHeader = {
      sessionId: service.getState().sessionId!,
      messageId: 'msg-remote-01',
      senderDeviceId: 'dev-peer-remote',
      baseRevisionId: '',
      logicalClock: 1,
      keyEpoch: 1,
      contentType: 'text/plain',
      plaintextBytes: 18,
    }
    const recipients = {
      'dev-laptop-01': {
        deviceId: 'dev-laptop-01',
        publicSigningKeyB64: myKeys.publicSigningKeyB64,
        publicHpkeKeyB64: myKeys.publicHpkeKeyB64,
      },
    }
    const wireMsg = await cryptoProvider.encryptSnapshot(
      'Remote Secret Text',
      remoteHeader,
      recipients,
      peerKeys,
      'clipboard.update'
    )

    // Inbound frame from relay
    await service.handleInboundMessage(wireMsg as unknown as Record<string, unknown>)

    expect(service.getContent()).toBe('Remote Secret Text')
    expect(service.getState().logicalClock).toBe(1)

    // Verify no echo loop: we should NOT send another clipboard.update back!
    expect(mockWs.sentData.length).toBe(0)
  })

  it('ignores self-generated updates to prevent echo loops', async () => {
    await service.createSession()
    mockWs.sentData = []

    // Inbound frame where senderDeviceId is myself
    mockWs.simulateMessage({
      v: 1,
      action: 'clipboard.update',
      header: {
        sessionId: service.getState().sessionId,
        messageId: 'msg-self',
        senderDeviceId: 'dev-laptop-01',
        logicalClock: 5,
      },
      payload: { ciphertext: 'abc', nonce: '123' },
    })

    await vi.advanceTimersByTimeAsync(50)
    // Content unchanged
    expect(service.getContent()).toBe('')
    expect(mockWs.sentData.length).toBe(0)
  })
})
