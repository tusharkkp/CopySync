import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WebRtcManager, SignalingSender } from '../WebRtcManager'

class MockRTCDataChannel {
  public label: string
  public readyState: RTCDataChannelState = 'connecting'
  public onopen: (() => void) | null = null
  public onmessage: ((event: { data: string }) => void) | null = null
  public onclose: (() => void) | null = null
  public onerror: ((error: unknown) => void) | null = null

  public sentData: string[] = []

  constructor(label: string) {
    this.label = label
  }

  public simulateOpen() {
    this.readyState = 'open'
    if (this.onopen) this.onopen()
  }

  public simulateMessage(data: string) {
    if (this.onmessage) this.onmessage({ data })
  }

  public simulateClose() {
    this.readyState = 'closed'
    if (this.onclose) this.onclose()
  }

  public send(data: string) {
    this.sentData.push(data)
  }

  public close() {
    this.simulateClose()
  }
}

class MockRTCPeerConnection {
  public static instances: MockRTCPeerConnection[] = []
  public config: RTCConfiguration
  public connectionState: RTCPeerConnectionState = 'new'
  public onicecandidate: ((event: { candidate: { toJSON: () => unknown } | null }) => void) | null = null
  public ondatachannel: ((event: { channel: RTCDataChannel }) => void) | null = null
  public onconnectionstatechange: (() => void) | null = null

  public localDescription: RTCSessionDescriptionInit | null = null
  public remoteDescription: RTCSessionDescriptionInit | null = null
  public addedCandidates: unknown[] = []
  public createdDataChannels: MockRTCDataChannel[] = []

  constructor(config: RTCConfiguration) {
    this.config = config
    MockRTCPeerConnection.instances.push(this)
  }

  public createDataChannel(label: string): RTCDataChannel {
    const dc = new MockRTCDataChannel(label)
    this.createdDataChannels.push(dc)
    return dc as unknown as RTCDataChannel
  }

  public async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: 'fake-sdp-offer' }
  }

  public async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'answer', sdp: 'fake-sdp-answer' }
  }

  public async setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = desc
  }

  public async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = desc
  }

  public async addIceCandidate(candidate: unknown): Promise<void> {
    this.addedCandidates.push(candidate)
  }

  public simulateIceCandidate(candidateObj: unknown) {
    if (this.onicecandidate) {
      this.onicecandidate({ candidate: { toJSON: () => candidateObj } })
    }
  }

  public close() {
    this.connectionState = 'closed'
  }
}

// Polyfill global RTCSessionDescription & RTCIceCandidate for node test environment
if (typeof globalThis.RTCSessionDescription === 'undefined') {
  globalThis.RTCSessionDescription = class {
    public type: string
    public sdp: string
    constructor(init: RTCSessionDescriptionInit) {
      this.type = init.type
      this.sdp = init.sdp || ''
    }
  } as unknown as typeof RTCSessionDescription
}

if (typeof globalThis.RTCIceCandidate === 'undefined') {
  globalThis.RTCIceCandidate = class {
    public candidate: string
    constructor(init: RTCIceCandidateInit) {
      this.candidate = init.candidate || ''
    }
  } as unknown as typeof RTCIceCandidate
}

describe('WEBRTC: WebRtcManager Peer-to-Peer Suite', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    MockRTCPeerConnection.instances = []
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('initiator creates offer, data channel, and sends signaling.offer', async () => {
    const sentSignals: { action: string; target: string; signal: unknown }[] = []
    const signalingSender: SignalingSender = {
      sendSignaling: (action, target, signal) => {
        sentSignals.push({ action, target, signal })
        return true
      },
    }

    const manager = new WebRtcManager({
      sessionId: 'sess-rtc-01',
      myDeviceId: 'dev-laptop-01',
      targetDeviceId: 'dev-phone-02',
      isInitiator: true,
      signalingSender,
      rtcPeerConnectionFactory: (config) =>
        new MockRTCPeerConnection(config) as unknown as RTCPeerConnection,
    })

    manager.start()
    await Promise.resolve()
    await Promise.resolve()

    expect(manager.getState()).toBe('connecting')
    expect(MockRTCPeerConnection.instances.length).toBe(1)
    const pc = MockRTCPeerConnection.instances[0]
    expect(pc.createdDataChannels.length).toBe(1)
    expect(pc.createdDataChannels[0].label).toBe('clipsync-direct')

    expect(sentSignals.length).toBe(1)
    expect(sentSignals[0].action).toBe('signaling.offer')
    expect(sentSignals[0].target).toBe('dev-phone-02')

    // Simulate ICE candidate
    pc.simulateIceCandidate({ candidate: 'candidate:1 1 UDP ...' })
    expect(sentSignals.length).toBe(2)
    expect(sentSignals[1].action).toBe('signaling.ice')
  })

  it('answerer receives offer and sends signaling.answer', async () => {
    const sentSignals: { action: string; target: string; signal: unknown }[] = []
    const signalingSender: SignalingSender = {
      sendSignaling: (action, target, signal) => {
        sentSignals.push({ action, target, signal })
        return true
      },
    }

    const manager = new WebRtcManager({
      sessionId: 'sess-rtc-01',
      myDeviceId: 'dev-phone-02',
      targetDeviceId: 'dev-laptop-01',
      isInitiator: false,
      signalingSender,
      rtcPeerConnectionFactory: (config) =>
        new MockRTCPeerConnection(config) as unknown as RTCPeerConnection,
    })

    // Inbound offer
    await manager.handleSignaling('signaling.offer', 'dev-laptop-01', {
      type: 'offer',
      sdp: 'remote-sdp-offer',
    })

    expect(sentSignals.length).toBe(1)
    expect(sentSignals[0].action).toBe('signaling.answer')
    expect(sentSignals[0].target).toBe('dev-laptop-01')
  })

  it('transitions state to connected when data channel opens and bi-directionally sends data', () => {
    const signalingSender: SignalingSender = { sendSignaling: () => true }

    const manager = new WebRtcManager({
      sessionId: 'sess-rtc-01',
      myDeviceId: 'dev-laptop-01',
      targetDeviceId: 'dev-phone-02',
      isInitiator: true,
      signalingSender,
      rtcPeerConnectionFactory: (config) =>
        new MockRTCPeerConnection(config) as unknown as RTCPeerConnection,
    })

    const statusLog: string[] = []
    manager.onStateChange((s) => statusLog.push(s))

    manager.start()
    const pc = MockRTCPeerConnection.instances[0]
    const dc = pc.createdDataChannels[0]

    expect(manager.isOpen()).toBe(false)

    // DataChannel opens
    dc.simulateOpen()
    expect(manager.isOpen()).toBe(true)
    expect(manager.getState()).toBe('connected')
    expect(statusLog).toContain('connected')

    // Send direct data
    const sentSuccess = manager.send('Direct P2P Encrypted Payload')
    expect(sentSuccess).toBe(true)
    expect(dc.sentData).toContain('Direct P2P Encrypted Payload')

    // Inbound direct message
    const receivedMessages: string[] = []
    manager.onMessage((msg) => receivedMessages.push(msg))
    dc.simulateMessage('Direct Inbound Message')
    expect(receivedMessages).toContain('Direct Inbound Message')
  })

  it('negotiation timeout triggers fallback to failed state after 10 seconds', () => {
    const signalingSender: SignalingSender = { sendSignaling: () => true }

    const manager = new WebRtcManager({
      sessionId: 'sess-rtc-01',
      myDeviceId: 'dev-laptop-01',
      targetDeviceId: 'dev-phone-02',
      isInitiator: true,
      signalingSender,
      rtcPeerConnectionFactory: (config) =>
        new MockRTCPeerConnection(config) as unknown as RTCPeerConnection,
    })

    manager.start()
    expect(manager.getState()).toBe('connecting')

    // Advance 10 seconds (10,000 ms)
    vi.advanceTimersByTime(10500)

    expect(manager.getState()).toBe('failed')
    expect(manager.isOpen()).toBe(false)
  })
})
