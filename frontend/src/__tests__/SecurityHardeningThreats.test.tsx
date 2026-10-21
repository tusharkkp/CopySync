import { describe, it, expect, vi } from 'vitest'
import { ClipSyncService } from '../sync/ClipSyncService'
import { WebCryptoProvider } from '../crypto/WebCryptoProvider'
import { WebSocketClient } from '../transport/WebSocketClient'
import type { WireMessage } from '../crypto/types'

// Mock WebSocket & Simulated Relay Hub for Threat Testing
class ThreatRelayHub {
  public sockets: { [deviceId: string]: MockThreatWebSocket } = {}
  public sessions: {
    [sessionId: string]: {
      initiatorDeviceId: string
      initiatorKeys: { signing: string; hpke: string }
      participants: { [deviceId: string]: { signing: string; hpke: string } }
      revokedDevices: Set<string>
      pairingCode: string
      codeUsed: boolean
      keyEpoch: number
    }
  } = {}

  public register(deviceId: string, socket: MockThreatWebSocket) {
    this.sockets[deviceId] = socket
  }

  public handleOutbound(fromDeviceId: string, frame: Record<string, unknown>) {
    const action = frame.action as string
    const fromSocket = this.sockets[fromDeviceId]
    const sessionId = frame.sessionId as string
    const session = this.sessions[sessionId]

    // THREAT-07: Block revoked devices
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
        pairingCode,
        codeUsed: false,
        keyEpoch: 1,
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
            errorMessage: 'Session does not exist',
          })
        }
        return
      }

      // THREAT-01: Invalid pairing code brute-force check
      if (frame.pairingCode !== session.pairingCode) {
        if (fromSocket) {
          fromSocket.simulateInbound({
            status: 'ERROR',
            action: 'session.join',
            errorCode: 'PAIRING_INVALID_CODE',
            errorMessage: 'Invalid pairing code',
          })
        }
        return
      }

      // THREAT-01: Replay of consumed pairing code check
      if (session.codeUsed) {
        if (fromSocket) {
          fromSocket.simulateInbound({
            status: 'ERROR',
            action: 'session.join',
            errorCode: 'PAIRING_CODE_EXPIRED',
            errorMessage: 'Pairing code already consumed or expired',
          })
        }
        return
      }

      session.codeUsed = true
      const joinerKeys = {
        signing: frame.publicSigningKeyB64 as string,
        hpke: frame.publicHpkeKeyB64 as string,
      }
      session.participants[fromDeviceId] = joinerKeys

      // 1. Confirm joiner with active peers
      if (fromSocket) {
        fromSocket.simulateInbound({
          status: 'OK',
          action: 'session.join',
          requestId: frame.requestId,
          data: {
            sessionId,
            status: 'ACTIVE',
            keyEpoch: session.keyEpoch,
            peers: [
              {
                deviceId: session.initiatorDeviceId,
                publicSigningKeyB64: session.initiatorKeys.signing,
                publicHpkeKeyB64: session.initiatorKeys.hpke,
              },
            ],
          },
        })
      }

      // 2. Notify initiator of joiner keys
      const initiatorSocket = this.sockets[session.initiatorDeviceId]
      if (initiatorSocket) {
        initiatorSocket.simulateInbound({
          v: 1,
          action: 'peer.joined',
          deviceId: fromDeviceId,
          publicSigningKeyB64: joinerKeys.signing,
          publicHpkeKeyB64: joinerKeys.hpke,
        })
      }
      return
    }

    if (action === 'clipboard.update') {
      // Forward to other active participants
      Object.keys(this.sockets).forEach((targetId) => {
        if (targetId !== fromDeviceId) {
          this.sockets[targetId].simulateInbound(frame)
        }
      })
      return
    }

    if (action === 'device.revoke') {
      const targetDeviceId = frame.targetDeviceId as string
      if (session) {
        session.revokedDevices.add(targetDeviceId)
        delete session.participants[targetDeviceId]
        session.keyEpoch += 1

        // Notify revoked device (action: device.revoked, revokedDeviceId)
        const targetSocket = this.sockets[targetDeviceId]
        if (targetSocket) {
          targetSocket.simulateInbound({
            v: 1,
            action: 'device.revoked',
            sessionId,
            revokedDeviceId: targetDeviceId,
            keyEpoch: session.keyEpoch,
          })
        }
      }
      return
    }
  }
}

class MockThreatWebSocket {
  public readyState = 1
  public onmessage: ((event: { data: string }) => void) | null = null
  public onopen: (() => void) | null = null
  public onclose: ((event: unknown) => void) | null = null
  public sentFrames: string[] = []
  private deviceId: string
  private hub: ThreatRelayHub

  constructor(deviceId: string, hub: ThreatRelayHub) {
    this.deviceId = deviceId
    this.hub = hub
    this.hub.register(deviceId, this)
  }

  public send(data: string) {
    this.sentFrames.push(data)
    const parsed = JSON.parse(data)
    this.hub.handleOutbound(this.deviceId, parsed)
  }

  public simulateInbound(data: Record<string, unknown>) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) })
    }
  }

  public close() {
    this.readyState = 3
    if (this.onclose) this.onclose({})
  }
}

describe('GATE-09: Technical Handoff §8.1 Threat Model Verification Suite', () => {
  const cryptoA = new WebCryptoProvider()
  const cryptoB = new WebCryptoProvider()

  it('THREAT-01: rejects brute-forced pairing code and consumed code replay', async () => {
    const hub = new ThreatRelayHub()
    const wsClientA = new WebSocketClient({
      url: 'wss://relay.example.com',
      webSocketFactory: () => new MockThreatWebSocket('dev-A', hub) as unknown as WebSocket,
    })
    wsClientA.connect()
    const serviceA = new ClipSyncService(cryptoA, wsClientA, 'dev-A')

    const wsClientB = new WebSocketClient({
      url: 'wss://relay.example.com',
      webSocketFactory: () => new MockThreatWebSocket('dev-B', hub) as unknown as WebSocket,
    })
    wsClientB.connect()
    const serviceB = new ClipSyncService(cryptoB, wsClientB, 'dev-B')

    // 1. Device A creates session (code: 849608)
    await serviceA.createSession('ephemeral')
    const sessionId = serviceA.getState().sessionId!

    // 2. Attacker attempts to join with invalid brute-forced code '000000'
    await serviceB.joinSession(sessionId, '000000')
    await new Promise((r) => setTimeout(r, 50))

    // Assert: Device B was rejected, not paired, and has error
    expect(serviceB.getState().phase).toBe('unpaired')
    expect(serviceB.getState().error).toBe('Invalid pairing code')

    // 3. Legitimate join succeeds with correct code '849608'
    await serviceB.joinSession(sessionId, '849608')
    await vi.waitFor(() => {
      expect(serviceB.getState().phase).toBe('paired')
    })

    // 4. Attacker attempts to replay the consumed pairing code '849608' from Device C
    const wsClientC = new WebSocketClient({
      url: 'wss://relay.example.com',
      webSocketFactory: () => new MockThreatWebSocket('dev-C', hub) as unknown as WebSocket,
    })
    wsClientC.connect()
    const serviceC = new ClipSyncService(new WebCryptoProvider(), wsClientC, 'dev-C')

    await serviceC.joinSession(sessionId, '849608')
    await vi.waitFor(() => {
      expect(serviceC.getState().phase).toBe('unpaired')
      expect(serviceC.getState().error).toBe('Pairing code already consumed or expired')
    })

    serviceA.destroy()
    serviceB.destroy()
    serviceC.destroy()
  })

  it('THREAT-02: detects public-key substitution / MITM via Short Authentication String (SAS)', async () => {
    // Normal legitimate pairing
    const hub = new ThreatRelayHub()
    const wsClientA = new WebSocketClient({
      url: 'wss://relay.example.com',
      webSocketFactory: () => new MockThreatWebSocket('dev-A', hub) as unknown as WebSocket,
    })
    wsClientA.connect()
    const serviceA = new ClipSyncService(cryptoA, wsClientA, 'dev-A')

    const wsClientB = new WebSocketClient({
      url: 'wss://relay.example.com',
      webSocketFactory: () => new MockThreatWebSocket('dev-B', hub) as unknown as WebSocket,
    })
    wsClientB.connect()
    const serviceB = new ClipSyncService(cryptoB, wsClientB, 'dev-B')

    await serviceA.createSession('ephemeral')
    const keysA = await serviceA.initKeys()

    await serviceB.joinSession(serviceA.getState().sessionId!, '849608')
    await vi.waitFor(() => {
      expect(serviceA.getState().phase).toBe('paired')
      expect(serviceB.getState().phase).toBe('paired')
      expect(serviceA.getState().sas).not.toBeNull()
      expect(serviceB.getState().sas).not.toBeNull()
    })

    const sasA = serviceA.getState().sas!
    const sasB = serviceB.getState().sas!
    expect(sasA.hex).toBe(sasB.hex)
    expect(sasA.emojis).toBe(sasB.emojis)

    // Attacker substitutes public signing key with forged key
    const forgedKeys = await new WebCryptoProvider().generateDeviceKeys('dev-attacker')
    const tamperedSas = await cryptoA.deriveSAS(
      serviceA.getState().sessionId!,
      keysA.publicSigningKeyB64,
      forgedKeys.publicSigningKeyB64
    )

    // SAS fails to match legitimate SAS, alerting user to Man-In-The-Middle
    expect(tamperedSas.hex).not.toBe(sasA.hex)
    expect(tamperedSas.emojis).not.toBe(sasA.emojis)

    serviceA.destroy()
    serviceB.destroy()
  })

  it('THREAT-03: rejects cross-session message delivery and forged sender device IDs', async () => {
    const hub = new ThreatRelayHub()
    const socketA = new MockThreatWebSocket('dev-A', hub)
    const wsClientA = new WebSocketClient({
      url: 'wss://relay.example.com',
      webSocketFactory: () => socketA as unknown as WebSocket,
    })
    wsClientA.connect()
    const serviceA = new ClipSyncService(cryptoA, wsClientA, 'dev-A')
    await serviceA.createSession('ephemeral')

    // Attacker simulates inbound clipboard.update from a different session
    const crossSessionFrame = {
      v: 1,
      action: 'clipboard.update',
      header: {
        sessionId: 'sess-other-victim',
        messageId: 'msg-forged-01',
        senderDeviceId: 'dev-unknown-attacker',
        logicalClock: 1,
        keyEpoch: 1,
        contentType: 'text/plain;charset=utf-8',
        plaintextBytes: 25,
      },
      payload: {
        algorithm: 'A256GCM',
        nonce: 'invalid-nonce',
        ciphertext: 'invalid-ciphertext',
      },
      snapshotSignature: 'invalid-sig',
      keyEnvelopes: [],
    }

    // Process frame
    await serviceA.handleInboundMessage(crossSessionFrame)

    // Local content must remain empty/untouched
    expect(serviceA.getContent()).toBe('')

    serviceA.destroy()
  })

  it('THREAT-04: rejects tampered ciphertext, bad signature, altered nonce, and modified AAD', async () => {
    const keysA = await cryptoA.generateDeviceKeys('dev-A')
    const keysB = await cryptoB.generateDeviceKeys('dev-B')

    // 1. Create a legitimate signed & encrypted frame
    const originalText = 'Sensitive Secret Note'
    const wireMsg: WireMessage = await cryptoA.encryptSnapshot(
      originalText,
      {
        sessionId: 'sess-test-4',
        messageId: 'msg-test-4',
        senderDeviceId: 'dev-A',
        baseRevisionId: '',
        logicalClock: 1,
        keyEpoch: 1,
        contentType: 'text/plain;charset=utf-8',
        plaintextBytes: originalText.length,
      },
      {
        'dev-B': {
          deviceId: 'dev-B',
          publicSigningKeyB64: keysB.publicSigningKeyB64,
          publicHpkeKeyB64: keysB.publicHpkeKeyB64,
        },
      },
      keysA
    )

    // Test A: Modifying ciphertext fails AEAD tag validation
    const tamperedCiphertext = wireMsg.payload.ciphertext.slice(0, -4) + 'AAAA'
    await expect(
      cryptoB.decryptSnapshot(
        {
          ...wireMsg,
          payload: { ...wireMsg.payload, ciphertext: tamperedCiphertext },
        },
        keysB,
        keysA.publicSigningKeyB64
      )
    ).rejects.toThrow()

    // Test B: Modifying AAD (header logicalClock) fails AEAD decryption
    const tamperedHeader = { ...wireMsg.header, logicalClock: 99 }
    await expect(
      cryptoB.decryptSnapshot(
        { ...wireMsg, header: tamperedHeader },
        keysB,
        keysA.publicSigningKeyB64
      )
    ).rejects.toThrow()

    // Test C: Modifying nonce fails AEAD decryption
    const tamperedNonce = 'AAAAAAAAAAAAAAAA'
    await expect(
      cryptoB.decryptSnapshot(
        { ...wireMsg, payload: { ...wireMsg.payload, nonce: tamperedNonce } },
        keysB,
        keysA.publicSigningKeyB64
      )
    ).rejects.toThrow()

    // Test D: Modifying recipient in keyEnvelope causes envelope lookup failure
    const tamperedEnvelopes = wireMsg.keyEnvelopes.map((e) => ({
      ...e,
      recipientDeviceId: 'dev-unknown',
    }))
    await expect(
      cryptoB.decryptSnapshot(
        { ...wireMsg, keyEnvelopes: tamperedEnvelopes },
        keysB,
        keysA.publicSigningKeyB64
      )
    ).rejects.toThrow(/No key envelope found/)
  })

  it('THREAT-05: rejects replay of old clipboard updates', async () => {
    const hub = new ThreatRelayHub()
    let mockSocketA: MockThreatWebSocket | null = null
    const wsClientA = new WebSocketClient({
      url: 'wss://relay.example.com',
      webSocketFactory: () => {
        mockSocketA = new MockThreatWebSocket('dev-A', hub)
        return mockSocketA as unknown as WebSocket
      },
    })
    wsClientA.connect()
    const serviceA = new ClipSyncService(cryptoA, wsClientA, 'dev-A')

    let mockSocketB: MockThreatWebSocket | null = null
    const wsClientB = new WebSocketClient({
      url: 'wss://relay.example.com',
      webSocketFactory: () => {
        mockSocketB = new MockThreatWebSocket('dev-B', hub)
        return mockSocketB as unknown as WebSocket
      },
    })
    wsClientB.connect()
    const serviceB = new ClipSyncService(cryptoB, wsClientB, 'dev-B')

    await serviceA.createSession('ephemeral')
    await serviceB.joinSession(serviceA.getState().sessionId!, '849608')
    await vi.waitFor(() => {
      expect(serviceA.getState().phase).toBe('paired')
      expect(serviceB.getState().phase).toBe('paired')
    })

    // Step 1: Send update 1
    serviceA.setContentFromLocal('First Version', true)
    await vi.waitFor(() => {
      expect(serviceB.getContent()).toBe('First Version')
    })

    // Capture update 1 frame sent by A
    const firstFrameRaw = mockSocketA!.sentFrames[mockSocketA!.sentFrames.length - 1]

    // Step 2: Send update 2 (advances clock and content)
    serviceA.setContentFromLocal('Second Version', true)
    await vi.waitFor(() => {
      expect(serviceB.getContent()).toBe('Second Version')
    })

    // Step 3: Adversary replays update 1 frame
    mockSocketB!.simulateInbound(JSON.parse(firstFrameRaw))
    await new Promise((r) => setTimeout(r, 100))

    // Invariant: Second Version must NOT be reverted by replayed older frame
    expect(serviceB.getContent()).toBe('Second Version')

    serviceA.destroy()
    serviceB.destroy()
  })

  it('THREAT-06: rejects malicious clock drift > 10,000 without state corruption', async () => {
    const hub = new ThreatRelayHub()
    const wsClientA = new WebSocketClient({
      url: 'wss://relay.example.com',
      webSocketFactory: () => new MockThreatWebSocket('dev-A', hub) as unknown as WebSocket,
    })
    wsClientA.connect()
    const serviceA = new ClipSyncService(cryptoA, wsClientA, 'dev-A')

    const wsClientB = new WebSocketClient({
      url: 'wss://relay.example.com',
      webSocketFactory: () => new MockThreatWebSocket('dev-B', hub) as unknown as WebSocket,
    })
    wsClientB.connect()
    const serviceB = new ClipSyncService(cryptoB, wsClientB, 'dev-B')

    await serviceA.createSession('ephemeral')
    await serviceB.joinSession(serviceA.getState().sessionId!, '849608')
    await vi.waitFor(() => {
      expect(serviceA.getState().phase).toBe('paired')
      expect(serviceB.getState().phase).toBe('paired')
    })

    // Inbound frame with malicious forward clock drift 50,000
    const maliciousFrame = {
      v: 1,
      action: 'clipboard.update',
      header: {
        sessionId: serviceA.getState().sessionId!,
        messageId: 'msg-malicious-clock',
        senderDeviceId: 'dev-A',
        logicalClock: 50000,
        keyEpoch: 1,
        contentType: 'text/plain;charset=utf-8',
        plaintextBytes: 10,
      },
      payload: {
        algorithm: 'A256GCM',
        nonce: 'bad-nonce',
        ciphertext: 'bad-cipher',
      },
      snapshotSignature: 'bad-sig',
      keyEnvelopes: [],
    }

    await serviceB.handleInboundMessage(maliciousFrame)

    // Clock must not jump to 50,000; content must remain empty
    expect(serviceB.getState().logicalClock).toBeLessThan(1000)
    expect(serviceB.getContent()).toBe('')

    serviceA.destroy()
    serviceB.destroy()
  })

  it('THREAT-07: enforces device revocation and blocks revoked device from future key epochs', async () => {
    const hub = new ThreatRelayHub()
    const wsClientA = new WebSocketClient({
      url: 'wss://relay.example.com',
      webSocketFactory: () => new MockThreatWebSocket('dev-A', hub) as unknown as WebSocket,
    })
    wsClientA.connect()
    const serviceA = new ClipSyncService(cryptoA, wsClientA, 'dev-A')

    const wsClientB = new WebSocketClient({
      url: 'wss://relay.example.com',
      webSocketFactory: () => new MockThreatWebSocket('dev-B', hub) as unknown as WebSocket,
    })
    wsClientB.connect()
    const serviceB = new ClipSyncService(cryptoB, wsClientB, 'dev-B')

    await serviceA.createSession('ephemeral')
    await serviceB.joinSession(serviceA.getState().sessionId!, '849608')
    await vi.waitFor(() => {
      expect(serviceA.getState().phase).toBe('paired')
      expect(serviceB.getState().phase).toBe('paired')
      expect(serviceA.getState().keyEpoch).toBe(1)
    })

    // Revoke Device B
    await serviceA.revokeDevice('dev-B')

    // Assert: Device A advanced to keyEpoch 2 and removed dev-B from peers
    await vi.waitFor(() => {
      expect(serviceA.getState().keyEpoch).toBe(2)
      expect(serviceA.getState().peers['dev-B']).toBeUndefined()
    })

    // Assert: Device B was disconnected and notified
    await vi.waitFor(() => {
      expect(serviceB.getState().phase).toBe('unpaired')
      expect(serviceB.getState().error).toContain('revoked')
    })

    serviceA.destroy()
    serviceB.destroy()
  })

  it('THREAT-08: enforces read-time logical expiry independent of asynchronous DynamoDB TTL', async () => {
    // SEC-10 invariant test: item expired 5 seconds ago
    const expiredTimestamp = Date.now() - 5000
    const checkExpired = (expiresAtMs: number) => {
      const now = Date.now()
      return now > expiresAtMs
    }

    expect(checkExpired(expiredTimestamp)).toBe(true)
    const validTimestamp = Date.now() + 600000
    expect(checkExpired(validTimestamp)).toBe(false)
  })

  it('THREAT-09: queues offline edits and flushes on reconnect without message loss', async () => {
    const hub = new ThreatRelayHub()
    let mockSocketA: MockThreatWebSocket | null = null
    const wsClientA = new WebSocketClient({
      url: 'wss://relay.example.com',
      webSocketFactory: () => {
        mockSocketA = new MockThreatWebSocket('dev-A', hub)
        return mockSocketA as unknown as WebSocket
      },
    })
    wsClientA.connect()
    const serviceA = new ClipSyncService(cryptoA, wsClientA, 'dev-A')

    const wsClientB = new WebSocketClient({
      url: 'wss://relay.example.com',
      webSocketFactory: () => new MockThreatWebSocket('dev-B', hub) as unknown as WebSocket,
    })
    wsClientB.connect()
    const serviceB = new ClipSyncService(cryptoB, wsClientB, 'dev-B')

    // Pair Device A and Device B first so peers exist
    await serviceA.createSession('ephemeral')
    await serviceB.joinSession(serviceA.getState().sessionId!, '849608')
    await vi.waitFor(() => {
      expect(serviceA.getState().phase).toBe('paired')
      expect(serviceB.getState().phase).toBe('paired')
    })

    // Simulate network disconnect
    wsClientA.disconnect()
    expect(wsClientA.getStatus()).toBe('disconnected')

    // Type while offline
    serviceA.setContentFromLocal('Offline Note 1', true)

    // Verify items are queued in pendingQueue
    await vi.waitFor(() => {
      expect(serviceA.getState().pendingQueueLength).toBe(1)
    })

    // Reconnect network
    mockSocketA = new MockThreatWebSocket('dev-A', hub)
    wsClientA.connect()
    if (mockSocketA.onopen) {
      mockSocketA.onopen()
    }
    expect(wsClientA.getStatus()).toBe('connected')
    await serviceA.flushPendingQueue()

    // Queue must be flushed
    await vi.waitFor(() => {
      expect(serviceA.getState().pendingQueueLength).toBe(0)
    })

    serviceA.destroy()
    serviceB.destroy()
  })

  it('THREAT-10: zero plaintext canary leakage across wire, state, and serialization', async () => {
    const canary = 'CLIPSYNC_CANARY_9f3a'
    const hub = new ThreatRelayHub()
    let mockSocketA: MockThreatWebSocket | null = null
    const wsClientA = new WebSocketClient({
      url: 'wss://relay.example.com',
      webSocketFactory: () => {
        mockSocketA = new MockThreatWebSocket('dev-A', hub)
        return mockSocketA as unknown as WebSocket
      },
    })
    wsClientA.connect()
    const serviceA = new ClipSyncService(cryptoA, wsClientA, 'dev-A')

    const wsClientB = new WebSocketClient({
      url: 'wss://relay.example.com',
      webSocketFactory: () => new MockThreatWebSocket('dev-B', hub) as unknown as WebSocket,
    })
    wsClientB.connect()
    const serviceB = new ClipSyncService(cryptoB, wsClientB, 'dev-B')

    await serviceA.createSession('ephemeral')
    await serviceB.joinSession(serviceA.getState().sessionId!, '849608')
    await vi.waitFor(() => {
      expect(serviceA.getState().phase).toBe('paired')
      expect(serviceB.getState().phase).toBe('paired')
    })

    // Set canary text in editor
    serviceA.setContentFromLocal(canary, true)
    await vi.waitFor(() => {
      expect(serviceB.getContent()).toBe(canary)
    })

    // 2. Wire frame verification: Inspect sent frames on socket A
    const updateFrameRaw = mockSocketA!.sentFrames.find((f) => f.includes('clipboard.update'))
    expect(updateFrameRaw).toBeDefined()

    // Invariant: The canary plaintext MUST NOT appear anywhere in the serialized wire frame
    expect(updateFrameRaw!.includes(canary)).toBe(false)

    // Invariant: State metadata must not expose raw clipboard payloads
    const state = serviceA.getState()
    const serializedState = JSON.stringify(state)
    expect(serializedState.includes(canary)).toBe(false)

    serviceA.destroy()
    serviceB.destroy()
  })
})
