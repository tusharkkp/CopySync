import { useState, useEffect, useCallback } from 'react'
import { ClipSyncService, ClipSyncState, StorageMode } from './ClipSyncService'
import { WebCryptoProvider } from '../crypto/WebCryptoProvider'
import { WebSocketClient } from '../transport/WebSocketClient'

export interface UseClipSyncOptions {
  wsUrl?: string
  deviceId?: string
  initialContent?: string
  serviceOverride?: ClipSyncService
}

export function useClipSync(options: UseClipSyncOptions = {}) {
  const [service] = useState<ClipSyncService>(() => {
    if (options.serviceOverride) {
      return options.serviceOverride
    }
    const cryptoProvider = new WebCryptoProvider()
    const wsClient = new WebSocketClient({ url: options.wsUrl })
    return new ClipSyncService(
      cryptoProvider,
      wsClient,
      options.deviceId
    )
  })

  const [state, setState] = useState<ClipSyncState>(() => service.getState())
  const [content, setContentState] = useState<string>(
    () => options.initialContent ?? service.getContent()
  )

  useEffect(() => {
    const unsubState = service.onStateChange((s) => setState(s))
    const unsubContent = service.onContentChange((c) => setContentState(c))

    return () => {
      unsubState()
      unsubContent()
    }
  }, [service])

  const setContent = useCallback(
    (newContent: string, isPaste = false) => {
      service.setContentFromLocal(newContent, isPaste)
    },
    [service]
  )

  const createSession = useCallback(
    async (mode: StorageMode = 'ephemeral') => {
      await service.createSession(mode)
    },
    [service]
  )

  const joinSession = useCallback(
    async (sessionId: string, pairingCode: string) => {
      await service.joinSession(sessionId, pairingCode)
    },
    [service]
  )

  const leaveSession = useCallback(() => {
    service.leaveSession()
  }, [service])

  const syncNow = useCallback(async () => {
    await service.syncNow()
  }, [service])

  return {
    content,
    setContent,
    state,
    createSession,
    joinSession,
    leaveSession,
    syncNow,
    service,
  }
}
