import { SYNC_CONFIG } from '../config/syncConfig'

export type WebRtcState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'failed'

export interface SignalingSender {
  sendSignaling: (action: string, targetDeviceId: string, signal: unknown) => boolean
}

export type DirectMessageHandler = (data: string) => void
export type WebRtcStateListener = (state: WebRtcState) => void

export interface WebRtcOptions {
  sessionId: string
  myDeviceId: string
  targetDeviceId: string
  isInitiator: boolean
  signalingSender: SignalingSender
  iceServers?: RTCIceServer[]
  rtcPeerConnectionFactory?: (config: RTCConfiguration) => RTCPeerConnection
}

export class WebRtcManager {
  private sessionId: string
  private myDeviceId: string
  private targetDeviceId: string
  private isInitiator: boolean
  private signalingSender: SignalingSender
  private iceServers: RTCIceServer[]
  private rtcPeerConnectionFactory: (config: RTCConfiguration) => RTCPeerConnection

  private pc: RTCPeerConnection | null = null
  private dataChannel: RTCDataChannel | null = null
  private state: WebRtcState = 'idle'
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null

  private messageHandlers = new Set<DirectMessageHandler>()
  private stateListeners = new Set<WebRtcStateListener>()

  constructor(options: WebRtcOptions) {
    this.sessionId = options.sessionId
    this.myDeviceId = options.myDeviceId
    this.targetDeviceId = options.targetDeviceId
    this.isInitiator = options.isInitiator
    this.signalingSender = options.signalingSender
    this.iceServers = options.iceServers ?? (SYNC_CONFIG.STUN_SERVERS as unknown as RTCIceServer[])
    this.rtcPeerConnectionFactory =
      options.rtcPeerConnectionFactory ??
      ((config: RTCConfiguration) => {
        if (typeof RTCPeerConnection === 'undefined') {
          throw new Error('RTCPeerConnection is not supported in this environment')
        }
        return new RTCPeerConnection(config)
      })
  }

  public getState(): WebRtcState {
    return this.state
  }

  public isOpen(): boolean {
    return this.state === 'connected' && this.dataChannel?.readyState === 'open'
  }

  public start(): void {
    if (this.state === 'connected' || this.state === 'connecting') {
      return
    }

    this.setState('connecting')
    this.startNegotiationTimeout()

    try {
      this.pc = this.rtcPeerConnectionFactory({
        iceServers: this.iceServers,
      })

      this.pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
        if (event.candidate) {
          this.signalingSender.sendSignaling(
            'signaling.ice',
            this.targetDeviceId,
            event.candidate.toJSON()
          )
        }
      }

      this.pc.onconnectionstatechange = () => {
        if (!this.pc) return
        const connectionState = this.pc.connectionState
        if (connectionState === 'failed') {
          this.setState('failed')
        } else if (connectionState === 'disconnected') {
          this.setState('disconnected')
        }
      }

      if (this.isInitiator) {
        // Initiator creates DataChannel and sends offer
        this.dataChannel = this.pc.createDataChannel('clipsync-direct', {
          ordered: true,
        })
        this.setupDataChannel(this.dataChannel)

        void this.createAndSendOffer()
      } else {
        // Answerer waits for datachannel
        this.pc.ondatachannel = (event: RTCDataChannelEvent) => {
          this.dataChannel = event.channel
          this.setupDataChannel(this.dataChannel)
        }
      }
    } catch (err) {
      console.warn(
        '[WebRtcManager] Failed to initialize RTCPeerConnection; falling back to relay:',
        err instanceof Error ? err.message : err
      )
      this.setState('failed')
    }
  }

  public async handleSignaling(
    action: string,
    fromDeviceId: string,
    signal: unknown
  ): Promise<void> {
    if (fromDeviceId !== this.targetDeviceId) {
      return
    }

    if (!this.pc) {
      if (action === 'signaling.offer') {
        // Start as answerer if receiving offer
        this.start()
      } else {
        return
      }
    }

    if (!this.pc) return

    try {
      if (action === 'signaling.offer') {
        const offer = signal as RTCSessionDescriptionInit
        await this.pc.setRemoteDescription(offer)
        const answer = await this.pc.createAnswer()
        await this.pc.setLocalDescription(answer)

        this.signalingSender.sendSignaling(
          'signaling.answer',
          this.targetDeviceId,
          answer
        )
      } else if (action === 'signaling.answer') {
        const answer = signal as RTCSessionDescriptionInit
        await this.pc.setRemoteDescription(answer)
      } else if (action === 'signaling.ice') {
        const candidateInit = signal as RTCIceCandidateInit
        if (candidateInit) {
          await this.pc.addIceCandidate(candidateInit)
        }
      }
    } catch (err) {
      console.warn('[WebRtcManager] Error processing signaling frame:', err)
    }
  }

  public send(payload: string): boolean {
    if (!this.isOpen() || !this.dataChannel) {
      return false
    }

    try {
      this.dataChannel.send(payload)
      return true
    } catch (err) {
      console.warn('[WebRtcManager] Direct DataChannel send error:', err)
      return false
    }
  }

  public onMessage(handler: DirectMessageHandler): () => void {
    this.messageHandlers.add(handler)
    return () => {
      this.messageHandlers.delete(handler)
    }
  }

  public onStateChange(listener: WebRtcStateListener): () => void {
    this.stateListeners.add(listener)
    listener(this.state)
    return () => {
      this.stateListeners.delete(listener)
    }
  }

  public close(): void {
    this.clearTimeout()
    if (this.dataChannel) {
      this.dataChannel.onopen = null
      this.dataChannel.onclose = null
      this.dataChannel.onmessage = null
      this.dataChannel.onerror = null
      try {
        this.dataChannel.close()
      } catch {
        // Ignored
      }
      this.dataChannel = null
    }

    if (this.pc) {
      this.pc.onicecandidate = null
      this.pc.ondatachannel = null
      this.pc.onconnectionstatechange = null
      try {
        this.pc.close()
      } catch {
        // Ignored
      }
      this.pc = null
    }

    this.setState('disconnected')
  }

  private setupDataChannel(channel: RTCDataChannel): void {
    channel.onopen = () => {
      this.clearTimeout()
      this.setState('connected')
    }

    channel.onmessage = (event: MessageEvent) => {
      const data = typeof event.data === 'string' ? event.data : ''
      if (data) {
        this.messageHandlers.forEach((h) => {
          try {
            h(data)
          } catch (err) {
            console.error('[WebRtcManager] Message handler error:', err)
          }
        })
      }
    }

    channel.onclose = () => {
      this.setState('disconnected')
    }

    channel.onerror = (err) => {
      console.warn('[WebRtcManager] DataChannel error:', err)
      this.setState('failed')
    }
  }

  private async createAndSendOffer(): Promise<void> {
    if (!this.pc) return

    try {
      const offer = await this.pc.createOffer()
      await this.pc.setLocalDescription(offer)

      this.signalingSender.sendSignaling(
        'signaling.offer',
        this.targetDeviceId,
        offer
      )
    } catch (err) {
      console.warn('[WebRtcManager] Failed to create / send offer:', err)
      this.setState('failed')
    }
  }

  private setState(newState: WebRtcState): void {
    if (this.state !== newState) {
      this.state = newState
      this.stateListeners.forEach((l) => {
        try {
          l(newState)
        } catch (err) {
          console.error('[WebRtcManager] Error in state listener:', err)
        }
      })
    }
  }

  private startNegotiationTimeout(): void {
    this.clearTimeout()
    this.timeoutTimer = setTimeout(() => {
      if (this.state === 'connecting') {
        console.info('[WebRtcManager] P2P negotiation timed out; falling back to WebSocket relay')
        this.setState('failed')
      }
    }, SYNC_CONFIG.WEBRTC_CONNECT_TIMEOUT_MS)
  }

  private clearTimeout(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer)
      this.timeoutTimer = null
    }
  }
}
