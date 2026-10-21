import { SYNC_CONFIG } from '../config/syncConfig'

export type WebSocketStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

export type MessageHandler = (data: Record<string, unknown>) => void
export type StatusHandler = (status: WebSocketStatus) => void

export interface WebSocketClientOptions {
  url?: string
  autoReconnect?: boolean
  heartbeatIntervalMs?: number
  reconnectBaseMs?: number
  reconnectMaxMs?: number
  maxReconnectAttempts?: number
  webSocketFactory?: (url: string) => WebSocket
}

export class WebSocketClient {
  private url: string
  private autoReconnect: boolean
  private heartbeatIntervalMs: number
  private reconnectBaseMs: number
  private reconnectMaxMs: number
  private maxReconnectAttempts: number
  private webSocketFactory: (url: string) => WebSocket

  private ws: WebSocket | null = null
  private status: WebSocketStatus = 'disconnected'
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null

  private messageHandlers = new Set<MessageHandler>()
  private statusHandlers = new Set<StatusHandler>()

  constructor(options: WebSocketClientOptions = {}) {
    this.url =
      options.url ||
      (typeof import.meta !== 'undefined' && import.meta.env?.VITE_WS_URL) ||
      'wss://7s7zejevia.execute-api.ap-south-1.amazonaws.com/dev'
    this.autoReconnect = options.autoReconnect ?? true
    this.heartbeatIntervalMs =
      options.heartbeatIntervalMs ?? SYNC_CONFIG.HEARTBEAT_INTERVAL_MS
    this.reconnectBaseMs =
      options.reconnectBaseMs ?? SYNC_CONFIG.RETRY_BACKOFF_BASE_MS
    this.reconnectMaxMs =
      options.reconnectMaxMs ?? SYNC_CONFIG.RETRY_BACKOFF_MAX_MS
    this.maxReconnectAttempts =
      options.maxReconnectAttempts ?? 10
    this.webSocketFactory =
      options.webSocketFactory ?? ((url: string) => new WebSocket(url))
  }

  public getStatus(): WebSocketStatus {
    return this.status
  }

  public getUrl(): string {
    return this.url
  }

  public setUrl(url: string): void {
    const shouldReconnect = this.status === 'connected' || this.status === 'connecting'
    this.url = url
    if (shouldReconnect) {
      this.disconnect()
      this.connect()
    }
  }

  public async ensureConnected(timeoutMs = 10000): Promise<void> {
    if (this.status === 'connected' || this.ws?.readyState === 1) {
      if (this.status !== 'connected' && this.ws?.readyState === 1) {
        this.setStatus('connected')
      }
      return
    }

    if (this.status !== 'connecting' && this.status !== 'reconnecting') {
      this.connect()
    }

    if ((this.ws?.readyState as number) === 1) {
      this.setStatus('connected')
      return
    }

    return new Promise<void>((resolve, reject) => {
      if (this.status === 'connected' || (this.ws?.readyState as number) === 1) {
        if (this.status !== 'connected') this.setStatus('connected')
        resolve()
        return
      }

      let timer: ReturnType<typeof setTimeout> | null = null
      let unsub: (() => void) | null = null

      timer = setTimeout(() => {
        if (unsub) unsub()
        reject(
          new Error(
            `WebSocket connection timed out after ${timeoutMs}ms (current status: ${this.status})`
          )
        )
      }, timeoutMs)

      unsub = this.onStatusChange((status) => {
        if (status === 'connected' || this.ws?.readyState === 1) {
          if (timer) clearTimeout(timer)
          if (unsub) unsub()
          resolve()
        }
      })
    })
  }

  public connect(urlOverride?: string): void {
    if (urlOverride) {
      this.url = urlOverride
    }

    if (this.status === 'connected' || this.status === 'connecting') {
      return
    }

    this.setStatus(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting')

    try {
      this.ws = this.webSocketFactory(this.url)

      this.ws.onopen = () => {
        this.reconnectAttempts = 0
        this.setStatus('connected')
        this.startHeartbeat()
      }

      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const raw = typeof event.data === 'string' ? event.data : ''
          if (!raw) return
          const parsed = JSON.parse(raw) as Record<string, unknown>
          this.messageHandlers.forEach((handler) => {
            try {
              handler(parsed)
            } catch (err) {
              console.error('[WebSocketClient] Error in message handler:', err)
            }
          })
        } catch (err) {
          console.warn('[WebSocketClient] Failed to parse inbound WebSocket message:', err)
        }
      }

      this.ws.onerror = (error) => {
        console.warn('[WebSocketClient] WebSocket error encountered:', error)
      }

      this.ws.onclose = () => {
        this.cleanupSocket()
        if (this.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect()
        } else {
          this.setStatus('disconnected')
        }
      }
    } catch (err) {
      console.error('[WebSocketClient] Connection instantiation failed:', err)
      this.cleanupSocket()
      if (this.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.scheduleReconnect()
      } else {
        this.setStatus('disconnected')
      }
    }
  }

  public disconnect(): void {
    this.autoReconnect = false
    this.clearTimers()
    if (this.ws) {
      this.ws.onclose = null
      this.ws.onerror = null
      this.ws.onmessage = null
      this.ws.onopen = null
      try {
        this.ws.close()
      } catch {
        // Ignored
      }
      this.ws = null
    }
    this.setStatus('disconnected')
  }

  public send(message: Record<string, unknown>): boolean {
    if (!this.ws || this.ws.readyState !== 1 /* WebSocket.OPEN */) {
      console.warn('[WebSocketClient] Cannot send message: socket is not open (status: ' + this.status + ')')
      return false
    }

    try {
      const serialized = JSON.stringify(message)
      this.ws.send(serialized)
      return true
    } catch (err) {
      console.error('[WebSocketClient] Send failed:', err)
      return false
    }
  }

  public onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler)
    return () => {
      this.messageHandlers.delete(handler)
    }
  }

  public onStatusChange(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler)
    handler(this.status)
    return () => {
      this.statusHandlers.delete(handler)
    }
  }

  private setStatus(newStatus: WebSocketStatus): void {
    if (this.status !== newStatus) {
      this.status = newStatus
      this.statusHandlers.forEach((handler) => {
        try {
          handler(newStatus)
        } catch (err) {
          console.error('[WebSocketClient] Error in status handler:', err)
        }
      })
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (this.status === 'connected') {
        // Send lightweight ping frame
        this.send({ v: 1, action: '$default', ping: true })
      }
    }, this.heartbeatIntervalMs)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private scheduleReconnect(): void {
    this.setStatus('reconnecting')
    this.reconnectAttempts += 1

    // Exponential backoff with random 0-25% jitter
    const backoff = Math.min(
      this.reconnectBaseMs * Math.pow(1.5, this.reconnectAttempts - 1),
      this.reconnectMaxMs
    )
    const jitter = backoff * (Math.random() * 0.25)
    const delay = Math.round(backoff + jitter)

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
    }

    this.reconnectTimer = setTimeout(() => {
      this.connect()
    }, delay)
  }

  private cleanupSocket(): void {
    this.stopHeartbeat()
    if (this.ws) {
      this.ws = null
    }
  }

  private clearTimers(): void {
    this.stopHeartbeat()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
}
