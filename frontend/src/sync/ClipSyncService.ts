import { CryptoProvider } from '../crypto/CryptoProvider'
import {
  DeviceKeyMaterial,
  PeerPublicKey,
  RecipientKeyMap,
  SnapshotHeader,
  WireMessage,
} from '../crypto/types'
import { WebSocketClient, WebSocketStatus } from '../transport/WebSocketClient'
import { WebRtcManager, WebRtcOptions, WebRtcState } from '../webrtc/WebRtcManager'
import { SYNC_CONFIG } from '../config/syncConfig'

export type StorageMode = 'ephemeral' | 'temporary' | 'history'
export type SessionPhase = 'unpaired' | 'creating' | 'joining' | 'waiting_for_peer' | 'paired'
export type TransportMode = 'direct' | 'relay'

export interface HistoryRevision {
  messageId: string
  logicalClock: number
  createdAt?: string
  payloadCiphertext: string
  payloadNonce: string
  snapshotSignature: string
  keyEnvelopesJson: string
}

export interface ClipSyncState {
  deviceId: string
  connectionStatus: WebSocketStatus
  sessionId: string | null
  pairingCode: string | null
  storageMode: StorageMode
  retentionDays: number
  revisions: HistoryRevision[]
  phase: SessionPhase
  peers: Record<string, PeerPublicKey>
  sas: { hex: string; emojis: string } | null
  logicalClock: number
  isSyncing: boolean
  lastSyncedAt: Date | null
  error: string | null
  transportMode: TransportMode
  webrtcStatus: WebRtcState
}

export type StateListener = (state: ClipSyncState) => void
export type ContentListener = (content: string) => void

export class ClipSyncService {
  private cryptoProvider: CryptoProvider
  private wsClient: WebSocketClient
  private deviceId: string
  private deviceKeys: DeviceKeyMaterial | null = null
  private webRtcFactory: (options: WebRtcOptions) => WebRtcManager

  private sessionId: string | null = null
  private pairingCode: string | null = null
  private storageMode: StorageMode = 'ephemeral'
  private retentionDays = 30
  private revisions: HistoryRevision[] = []
  private phase: SessionPhase = 'unpaired'
  private peers: Record<string, PeerPublicKey> = {}
  private sas: { hex: string; emojis: string } | null = null
  private logicalClock = 0
  private isSyncing = false
  private lastSyncedAt: Date | null = null
  private error: string | null = null

  private transportMode: TransportMode = 'relay'
  private webrtcStatus: WebRtcState = 'idle'
  private webRtcManager: WebRtcManager | null = null

  private content = ''
  private lastSyncedContent = ''
  private inFlightSyncContent: string | null = null
  private typingDebounceTimer: ReturnType<typeof setTimeout> | null = null
  private maxIntervalTimer: ReturnType<typeof setTimeout> | null = null

  private processedMessageIds = new Set<string>()
  private messageIdHistory: string[] = []
  private readonly MAX_SEEN_MESSAGES = 100

  private stateListeners = new Set<StateListener>()
  private contentListeners = new Set<ContentListener>()
  private unsubscribeWsMessage: (() => void) | null = null
  private unsubscribeWsStatus: (() => void) | null = null

  constructor(
    cryptoProvider: CryptoProvider,
    wsClient: WebSocketClient,
    deviceId?: string,
    webRtcFactory?: (options: WebRtcOptions) => WebRtcManager
  ) {
    this.cryptoProvider = cryptoProvider
    this.wsClient = wsClient
    this.webRtcFactory = webRtcFactory ?? ((options) => new WebRtcManager(options))
    this.deviceId =
      deviceId ||
      (typeof crypto !== 'undefined' && crypto.randomUUID
        ? 'dev-' + crypto.randomUUID().slice(0, 8)
        : 'dev-' + Math.floor(Math.random() * 1000000))

    this.initWebSocketListeners()
  }

  public getState(): ClipSyncState {
    return {
      deviceId: this.deviceId,
      connectionStatus: this.wsClient.getStatus(),
      sessionId: this.sessionId,
      pairingCode: this.pairingCode,
      storageMode: this.storageMode,
      retentionDays: this.retentionDays,
      revisions: [...this.revisions],
      phase: this.phase,
      peers: { ...this.peers },
      sas: this.sas,
      logicalClock: this.logicalClock,
      isSyncing: this.isSyncing,
      lastSyncedAt: this.lastSyncedAt,
      error: this.error,
      transportMode: this.transportMode,
      webrtcStatus: this.webrtcStatus,
    }
  }

  public getContent(): string {
    return this.content
  }

  public async initKeys(): Promise<DeviceKeyMaterial> {
    if (!this.deviceKeys) {
      this.deviceKeys = await this.cryptoProvider.generateDeviceKeys(this.deviceId)
    }
    return this.deviceKeys
  }

  public async createSession(mode: StorageMode = 'ephemeral', retentionDays = 30): Promise<void> {
    this.error = null
    this.phase = 'creating'
    this.storageMode = mode
    this.retentionDays = mode === 'history' ? retentionDays : 0
    this.revisions = []
    this.notifyState()

    try {
      const keys = await this.initKeys()
      if (this.wsClient.getStatus() !== 'connected') {
        this.wsClient.connect()
      }

      const generatedSessionId = 'sess-' + Math.floor(1000000 + Math.random() * 9000000)
      this.sessionId = generatedSessionId
      const requestId = 'req-c-' + Date.now()

      const createFrame = {
        v: 1,
        action: 'session.create',
        requestId,
        sessionId: generatedSessionId,
        deviceId: this.deviceId,
        storageMode: mode.toUpperCase(),
        retentionDays: mode === 'history' ? retentionDays : 0,
        publicSigningKeyB64: keys.publicSigningKeyB64,
        publicHpkeKeyB64: keys.publicHpkeKeyB64,
      }

      this.wsClient.send(createFrame)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create session'
      this.error = message
      this.phase = 'unpaired'
      this.notifyState()
    }
  }

  public async joinSession(targetSessionId: string, inputPairingCode: string): Promise<void> {
    this.error = null
    this.phase = 'joining'
    this.notifyState()

    try {
      const keys = await this.initKeys()
      if (this.wsClient.getStatus() !== 'connected') {
        this.wsClient.connect()
      }

      const requestId = 'req-j-' + Date.now()
      const joinFrame = {
        v: 1,
        action: 'session.join',
        requestId,
        sessionId: targetSessionId.trim(),
        pairingCode: inputPairingCode.trim(),
        deviceId: this.deviceId,
        publicSigningKeyB64: keys.publicSigningKeyB64,
        publicHpkeKeyB64: keys.publicHpkeKeyB64,
      }

      this.sessionId = targetSessionId.trim()
      this.wsClient.send(joinFrame)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to join session'
      this.error = message
      this.phase = 'unpaired'
      this.notifyState()
    }
  }

  public async resumeSession(targetSessionId: string): Promise<void> {
    this.error = null
    this.phase = 'joining'
    this.sessionId = targetSessionId.trim()
    this.notifyState()

    try {
      await this.initKeys()
      if (this.wsClient.getStatus() !== 'connected') {
        this.wsClient.connect()
      }

      const requestId = 'req-r-' + Date.now()
      const resumeFrame = {
        v: 1,
        action: 'sync.resume',
        requestId,
        sessionId: this.sessionId,
        deviceId: this.deviceId,
      }

      this.wsClient.send(resumeFrame)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to resume session'
      this.error = message
      this.phase = 'unpaired'
      this.notifyState()
    }
  }

  public async closeSession(): Promise<void> {
    if (this.sessionId) {
      const closeFrame = {
        v: 1,
        action: 'session.close',
        requestId: 'req-close-' + Date.now(),
        sessionId: this.sessionId,
        deviceId: this.deviceId,
      }
      this.wsClient.send(closeFrame)
    }
    this.leaveSession()
  }

  public leaveSession(): void {
    if (this.webRtcManager) {
      this.webRtcManager.close()
      this.webRtcManager = null
    }
    this.transportMode = 'relay'
    this.webrtcStatus = 'idle'
    this.sessionId = null
    this.pairingCode = null
    this.peers = {}
    this.sas = null
    this.revisions = []
    this.phase = 'unpaired'
    this.error = null
    this.clearDebounceTimers()
    this.notifyState()
  }

  public setContentFromLocal(newContent: string, isPaste = false): void {
    this.content = newContent
    this.notifyContent()

    if (this.phase !== 'paired' || Object.keys(this.peers).length === 0) {
      return
    }

    if (newContent === this.lastSyncedContent) {
      return
    }

    if (isPaste) {
      // Paste event: sync immediately (ADR-004)
      this.clearDebounceTimers()
      void this.syncNow()
    } else {
      // Normal typing: debounced by 250ms (DEC-011)
      if (this.typingDebounceTimer) {
        clearTimeout(this.typingDebounceTimer)
      }

      if (!this.maxIntervalTimer) {
        this.maxIntervalTimer = setTimeout(() => {
          this.clearDebounceTimers()
          void this.syncNow()
        }, SYNC_CONFIG.MAX_UPDATE_INTERVAL_MS)
      }

      this.typingDebounceTimer = setTimeout(() => {
        this.clearDebounceTimers()
        void this.syncNow()
      }, SYNC_CONFIG.TYPING_DEBOUNCE_MS)
    }
  }

  public async syncNow(): Promise<void> {
    if (!this.sessionId || !this.deviceKeys || Object.keys(this.peers).length === 0) {
      return
    }

    if (
      (this.content === this.lastSyncedContent && this.lastSyncedAt !== null) ||
      this.inFlightSyncContent === this.content
    ) {
      return
    }

    this.inFlightSyncContent = this.content

    this.logicalClock += 1
    const textBytes = new TextEncoder().encode(this.content).length

    const header: SnapshotHeader = {
      sessionId: this.sessionId,
      messageId: 'msg-' + Date.now() + '-' + Math.floor(Math.random() * 10000),
      senderDeviceId: this.deviceId,
      baseRevisionId: '',
      logicalClock: this.logicalClock,
      keyEpoch: 1,
      contentType: 'text/plain;charset=utf-8',
      plaintextBytes: textBytes,
    }

    const recipientMap: RecipientKeyMap = this.peers

    try {
      this.setSyncing(true)
      const wireMsg = await this.cryptoProvider.encryptSnapshot(
        this.content,
        header,
        recipientMap,
        this.deviceKeys,
        'clipboard.update'
      )

      const wireFrame = {
        ...wireMsg,
        sessionId: this.sessionId,
      }

      let sent = false
      // Prefer WebRTC direct zero-hop DataChannel if connected
      if (this.webRtcManager && this.webRtcManager.isOpen()) {
        sent = this.webRtcManager.send(JSON.stringify(wireFrame))
        if (sent) {
          this.transportMode = 'direct'
        }
      }

      // Fall back to WebSocket relay if direct path is not open
      if (!sent) {
        sent = this.wsClient.send(wireFrame as unknown as Record<string, unknown>)
        this.transportMode = 'relay'
      }

      if (sent) {
        this.lastSyncedContent = this.content
        this.lastSyncedAt = new Date()
        if (this.storageMode === 'history') {
          this.revisions = [
            ...this.revisions,
            {
              messageId: header.messageId,
              logicalClock: header.logicalClock,
              createdAt: new Date().toISOString(),
              payloadCiphertext: wireMsg.payload.ciphertext,
              payloadNonce: wireMsg.payload.nonce,
              snapshotSignature: wireMsg.snapshotSignature,
              keyEnvelopesJson: JSON.stringify(wireMsg.keyEnvelopes),
            },
          ]
        }
      }
    } catch (err: unknown) {
      console.error('[ClipSyncService] Encryption / sync failed:', err)
      this.error = err instanceof Error ? err.message : 'Sync failed'
    } finally {
      this.inFlightSyncContent = null
      setTimeout(() => this.setSyncing(false), 500)
      this.notifyState()
    }
  }

  public onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener)
    listener(this.getState())
    return () => {
      this.stateListeners.delete(listener)
    }
  }

  public onContentChange(listener: ContentListener): () => void {
    this.contentListeners.add(listener)
    listener(this.content)
    return () => {
      this.contentListeners.delete(listener)
    }
  }

  public destroy(): void {
    this.clearDebounceTimers()
    if (this.webRtcManager) {
      this.webRtcManager.close()
      this.webRtcManager = null
    }
    if (this.unsubscribeWsMessage) this.unsubscribeWsMessage()
    if (this.unsubscribeWsStatus) this.unsubscribeWsStatus()
    this.stateListeners.clear()
    this.contentListeners.clear()
  }

  public getWebRtcManager(): WebRtcManager | null {
    return this.webRtcManager
  }

  private initWebSocketListeners(): void {
    this.unsubscribeWsStatus = this.wsClient.onStatusChange(() => {
      this.notifyState()
    })

    this.unsubscribeWsMessage = this.wsClient.onMessage((msg) => {
      void this.handleInboundMessage(msg)
    })
  }

  public async handleInboundMessage(msg: Record<string, unknown>): Promise<void> {
    const action = msg.action as string | undefined
    const status = msg.status as string | undefined

    // 1. Inbound session.create acknowledgement
    if (action === 'session.create' && status === 'OK' && msg.data) {
      const data = msg.data as Record<string, unknown>
      this.sessionId = (data.sessionId as string) || this.sessionId
      this.pairingCode = data.pairingCode as string
      if (typeof data.retentionDays === 'number') {
        this.retentionDays = data.retentionDays
      }
      if (data.storageMode) {
        this.storageMode = (data.storageMode as string).toLowerCase() as StorageMode
      }
      this.phase = 'waiting_for_peer'
      this.notifyState()
      return
    }

    // 2. Inbound session.join acknowledgement
    if (action === 'session.join') {
      if (status === 'OK') {
        this.phase = 'paired'
        this.notifyState()
      } else {
        this.error = (msg.errorMessage as string) || 'Failed to join session (invalid code)'
        this.phase = 'unpaired'
        this.notifyState()
      }
      return
    }

    // 3. Inbound peer.joined broadcast
    if (action === 'peer.joined') {
      const peerDeviceId = msg.deviceId as string
      const publicSigningKeyB64 = msg.publicSigningKeyB64 as string
      const publicHpkeKeyB64 = msg.publicHpkeKeyB64 as string

      if (peerDeviceId && publicSigningKeyB64 && publicHpkeKeyB64 && peerDeviceId !== this.deviceId) {
        this.peers[peerDeviceId] = {
          deviceId: peerDeviceId,
          publicSigningKeyB64,
          publicHpkeKeyB64,
        }
        this.phase = 'paired'

        // Initiate WebRTC Direct DataChannel negotiation (DEC-010) immediately
        // Deterministic role: lexicographically smaller deviceId acts as initiator to prevent glare
        const isInitiator = this.deviceId < peerDeviceId
        this.setupWebRtc(peerDeviceId, isInitiator)

        // Derive SAS Fingerprint (DEC-007)
        if (this.sessionId && this.deviceKeys) {
          try {
            this.sas = await this.cryptoProvider.deriveSAS(
              this.sessionId,
              this.deviceKeys.publicSigningKeyB64,
              publicSigningKeyB64
            )
          } catch (e) {
            console.warn('[ClipSyncService] SAS derivation error:', e)
          }
        }

        this.notifyState()

        // If we have content, sync it to the newly arrived peer immediately
        if (this.content) {
          void this.syncNow()
        }
      }
      return
    }

    // 4. Inbound WebRTC signaling frame (offer, answer, ice)
    if (
      action &&
      (action === 'signaling.offer' || action === 'signaling.answer' || action === 'signaling.ice')
    ) {
      const fromDeviceId = (msg.deviceId as string) || (msg.senderDeviceId as string)
      if (fromDeviceId && msg.signal) {
        if (!this.webRtcManager) {
          this.setupWebRtc(fromDeviceId, false)
        }
        if (this.webRtcManager) {
          void this.webRtcManager.handleSignaling(action, fromDeviceId, msg.signal)
        }
      }
      return
    }

    // 5. Inbound clipboard.update payload
    if (action === 'clipboard.update' && msg.header && msg.payload) {
      const wireMsg = msg as unknown as WireMessage
      const senderDeviceId = wireMsg.header.senderDeviceId

      // Echo loop prevention: ignore snapshots generated by myself
      if (senderDeviceId === this.deviceId) {
        return
      }

      // Duplicate suppression across paths (SEC-14 / Phase 6)
      if (wireMsg.header.messageId && !this.markMessageProcessed(wireMsg.header.messageId)) {
        return
      }

      // Logical clock verification: reject older or equal revision if already applied
      if (wireMsg.header.logicalClock <= this.logicalClock && this.content === this.lastSyncedContent) {
        // Already processed or stale
        return
      }

      // Check if we know the sender's signing key
      const senderPeer = this.peers[senderDeviceId]
      if (!senderPeer) {
        console.warn('[ClipSyncService] Received clipboard.update from unverified peer:', senderDeviceId)
        return
      }

      if (!this.deviceKeys) {
        return
      }

      try {
        this.setSyncing(true)
        const decryptedText = await this.cryptoProvider.decryptSnapshot(
          wireMsg,
          this.deviceKeys,
          senderPeer.publicSigningKeyB64
        )

        this.content = decryptedText
        this.lastSyncedContent = decryptedText
        this.logicalClock = Math.max(this.logicalClock, wireMsg.header.logicalClock)
        this.lastSyncedAt = new Date()
        if (this.storageMode === 'history') {
          this.revisions = [
            ...this.revisions,
            {
              messageId: wireMsg.header.messageId,
              logicalClock: wireMsg.header.logicalClock,
              createdAt: new Date().toISOString(),
              payloadCiphertext: wireMsg.payload.ciphertext,
              payloadNonce: wireMsg.payload.nonce,
              snapshotSignature: wireMsg.snapshotSignature,
              keyEnvelopesJson: JSON.stringify(wireMsg.keyEnvelopes),
            },
          ]
        }
        this.notifyContent()
      } catch (err: unknown) {
        console.error('[ClipSyncService] Inbound verification failed:', err)
        this.error = 'Decryption failed: signature or ciphertext mismatch'
      } finally {
        setTimeout(() => this.setSyncing(false), 500)
        this.notifyState()
      }
      return
    }

    // 6. Inbound session.close acknowledgement / notification
    if (action === 'session.close') {
      this.leaveSession()
      return
    }

    // 7. Inbound sync.resume acknowledgement
    if (action === 'sync.resume') {
      if (status === 'OK' && msg.data) {
        const data = msg.data as Record<string, unknown>
        this.sessionId = (data.sessionId as string) || this.sessionId
        if (data.storageMode) {
          this.storageMode = (data.storageMode as string).toLowerCase() as StorageMode
        }
        if (typeof data.retentionDays === 'number') {
          this.retentionDays = data.retentionDays
        }
        this.phase = 'paired'

        if (Array.isArray(data.revisions)) {
          this.revisions = (data.revisions as Record<string, unknown>[]).map((r) => ({
            messageId: r.messageId as string,
            logicalClock: (r.logicalClock as number) || 0,
            createdAt: r.createdAt as string | undefined,
            payloadCiphertext: r.payloadCiphertext as string,
            payloadNonce: r.payloadNonce as string,
            snapshotSignature: r.snapshotSignature as string,
            keyEnvelopesJson: (r.keyEnvelopesJson as string) || '[]',
          }))
        } else {
          this.revisions = []
        }

        if (data.latestSnapshot) {
          const snap = data.latestSnapshot as Record<string, unknown>
          const snapClock = (snap.logicalClock as number) || 0
          if (snapClock > this.logicalClock) {
            this.logicalClock = snapClock
          }
        }

        this.notifyState()
      } else {
        this.error = (msg.errorMessage as string) || 'Failed to resume session'
        this.phase = 'unpaired'
        this.notifyState()
      }
      return
    }
  }

  private setupWebRtc(targetDeviceId: string, isInitiator: boolean): void {
    if (!this.sessionId) return

    if (this.webRtcManager) {
      const currentState = this.webRtcManager.getState()
      if (currentState === 'connected' || currentState === 'connecting') {
        return
      }
      this.webRtcManager.close()
    }

    this.webRtcManager = this.webRtcFactory({
      sessionId: this.sessionId,
      myDeviceId: this.deviceId,
      targetDeviceId,
      isInitiator,
      signalingSender: {
        sendSignaling: (action, target, signal) => this.sendSignaling(action, target, signal),
      },
    })

    this.webRtcManager.onStateChange((state) => {
      this.webrtcStatus = state
      this.transportMode = state === 'connected' ? 'direct' : 'relay'
      this.notifyState()
    })

    this.webRtcManager.onMessage((data) => {
      try {
        const parsed = JSON.parse(data) as Record<string, unknown>
        this.transportMode = 'direct'
        void this.handleInboundMessage(parsed)
      } catch (e) {
        console.warn('[ClipSyncService] Failed to parse direct P2P message:', e)
      }
    })

    this.webRtcManager.start()
  }

  private sendSignaling(action: string, targetDeviceId: string, signal: unknown): boolean {
    if (!this.sessionId) return false
    return this.wsClient.send({
      v: 1,
      action,
      requestId: 'sig-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      sessionId: this.sessionId,
      deviceId: this.deviceId,
      targetDeviceId,
      signal,
    })
  }

  private setSyncing(syncing: boolean): void {
    if (this.isSyncing !== syncing) {
      this.isSyncing = syncing
      this.notifyState()
    }
  }

  private clearDebounceTimers(): void {
    if (this.typingDebounceTimer) {
      clearTimeout(this.typingDebounceTimer)
      this.typingDebounceTimer = null
    }
    if (this.maxIntervalTimer) {
      clearTimeout(this.maxIntervalTimer)
      this.maxIntervalTimer = null
    }
  }

  private markMessageProcessed(messageId: string): boolean {
    if (this.processedMessageIds.has(messageId)) {
      return false
    }
    this.processedMessageIds.add(messageId)
    this.messageIdHistory.push(messageId)
    if (this.messageIdHistory.length > this.MAX_SEEN_MESSAGES) {
      const oldest = this.messageIdHistory.shift()
      if (oldest) this.processedMessageIds.delete(oldest)
    }
    return true
  }

  private notifyState(): void {
    const s = this.getState()
    this.stateListeners.forEach((l) => {
      try {
        l(s)
      } catch (err) {
        console.error('[ClipSyncService] Error in state listener:', err)
      }
    })
  }

  private notifyContent(): void {
    this.contentListeners.forEach((l) => {
      try {
        l(this.content)
      } catch (err) {
        console.error('[ClipSyncService] Error in content listener:', err)
      }
    })
  }
}
