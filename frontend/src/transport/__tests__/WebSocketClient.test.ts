import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WebSocketClient } from '../WebSocketClient'

// Mock WebSocket class
class MockWebSocket {
  public static instances: MockWebSocket[] = []
  public url: string
  public readyState: number = 0 // CONNECTING
  public onopen: (() => void) | null = null
  public onmessage: ((event: { data: string }) => void) | null = null
  public onerror: ((error: unknown) => void) | null = null
  public onclose: (() => void) | null = null

  public sentData: string[] = []

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  public simulateOpen() {
    this.readyState = 1 // OPEN
    if (this.onopen) this.onopen()
  }

  public simulateMessage(data: Record<string, unknown> | string) {
    const raw = typeof data === 'string' ? data : JSON.stringify(data)
    if (this.onmessage) this.onmessage({ data: raw })
  }

  public simulateClose() {
    this.readyState = 3 // CLOSED
    if (this.onclose) this.onclose()
  }

  public send(data: string) {
    this.sentData.push(data)
  }

  public close() {
    this.readyState = 3
    if (this.onclose) this.onclose()
  }
}

describe('TRANSPORT: WebSocketClient Suite', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    MockWebSocket.instances = []
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('connects and transitions status to connected', () => {
    const client = new WebSocketClient({
      url: 'wss://test.relay.com',
      webSocketFactory: (url) => new MockWebSocket(url) as unknown as WebSocket,
    })

    const statusLog: string[] = []
    client.onStatusChange((s) => statusLog.push(s))

    client.connect()
    expect(statusLog).toContain('connecting')

    const mockWs = MockWebSocket.instances[0]
    expect(mockWs).toBeDefined()
    expect(mockWs.url).toBe('wss://test.relay.com')

    mockWs.simulateOpen()
    expect(client.getStatus()).toBe('connected')
    expect(statusLog).toContain('connected')
  })

  it('sends JSON string when socket is OPEN', () => {
    const client = new WebSocketClient({
      url: 'wss://test.relay.com',
      webSocketFactory: (url) => new MockWebSocket(url) as unknown as WebSocket,
    })

    client.connect()
    const mockWs = MockWebSocket.instances[0]
    mockWs.simulateOpen()

    const payload = { v: 1, action: 'session.create', requestId: 'req-1' }
    const success = client.send(payload)

    expect(success).toBe(true)
    expect(mockWs.sentData.length).toBe(1)
    expect(JSON.parse(mockWs.sentData[0])).toEqual(payload)
  })

  it('fails safely when sending on closed socket', () => {
    const client = new WebSocketClient({
      url: 'wss://test.relay.com',
      webSocketFactory: (url) => new MockWebSocket(url) as unknown as WebSocket,
    })

    const success = client.send({ test: true })
    expect(success).toBe(false)
  })

  it('dispatches inbound messages to registered subscribers', () => {
    const client = new WebSocketClient({
      url: 'wss://test.relay.com',
      webSocketFactory: (url) => new MockWebSocket(url) as unknown as WebSocket,
    })

    const received: unknown[] = []
    const unsubscribe = client.onMessage((msg) => received.push(msg))

    client.connect()
    const mockWs = MockWebSocket.instances[0]
    mockWs.simulateOpen()

    mockWs.simulateMessage({
      status: 'OK',
      action: 'session.create',
      data: { sessionId: 'sess-1' },
    })

    expect(received.length).toBe(1)
    expect((received[0] as { data: { sessionId: string } }).data.sessionId).toBe('sess-1')

    unsubscribe()
    mockWs.simulateMessage({ status: 'OK', action: 'session.join' })
    expect(received.length).toBe(1) // Unsubscribed, so not received
  })

  it('schedules reconnection with backoff on unexpected close', () => {
    const client = new WebSocketClient({
      url: 'wss://test.relay.com',
      autoReconnect: true,
      reconnectBaseMs: 100,
      reconnectMaxMs: 500,
      webSocketFactory: (url) => new MockWebSocket(url) as unknown as WebSocket,
    })

    client.connect()
    const mockWs = MockWebSocket.instances[0]
    mockWs.simulateOpen()
    expect(client.getStatus()).toBe('connected')

    // Simulate unexpected disconnect
    mockWs.simulateClose()
    expect(client.getStatus()).toBe('reconnecting')

    // Fast forward timer to trigger reconnect
    vi.advanceTimersByTime(200)

    expect(MockWebSocket.instances.length).toBe(2)
  })

  it('disconnect() shuts down socket without scheduling reconnection', () => {
    const client = new WebSocketClient({
      url: 'wss://test.relay.com',
      autoReconnect: true,
      webSocketFactory: (url) => new MockWebSocket(url) as unknown as WebSocket,
    })

    client.connect()
    const mockWs = MockWebSocket.instances[0]
    mockWs.simulateOpen()

    client.disconnect()
    expect(client.getStatus()).toBe('disconnected')

    vi.advanceTimersByTime(10000)
    // No new instance should be created
    expect(MockWebSocket.instances.length).toBe(1)
  })

  it('sends heartbeat ping frames periodically', () => {
    const client = new WebSocketClient({
      url: 'wss://test.relay.com',
      heartbeatIntervalMs: 5000,
      webSocketFactory: (url) => new MockWebSocket(url) as unknown as WebSocket,
    })

    client.connect()
    const mockWs = MockWebSocket.instances[0]
    mockWs.simulateOpen()

    vi.advanceTimersByTime(5100)
    expect(mockWs.sentData.length).toBe(1)
    expect(JSON.parse(mockWs.sentData[0])).toEqual({ v: 1, action: '$default', ping: true })

    vi.advanceTimersByTime(5000)
    expect(mockWs.sentData.length).toBe(2)
  })
})
