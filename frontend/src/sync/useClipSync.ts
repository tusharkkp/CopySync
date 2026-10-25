import { useState, useEffect, useCallback } from 'react'
import { ClipSyncService, type ClipSyncState, type StorageMode } from './ClipSyncService'
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
    service.connect()
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
    async (mode: StorageMode = 'ephemeral', retentionDays = 30) => {
      await service.createSession(mode, retentionDays)
    },
    [service]
  )

  const joinSession = useCallback(
    async (sessionId: string, pairingCode: string) => {
      await service.joinSession(sessionId, pairingCode)
    },
    [service]
  )

  const resumeSession = useCallback(
    async (sessionId: string) => {
      await service.resumeSession(sessionId)
    },
    [service]
  )

  const closeSession = useCallback(async () => {
    await service.closeSession()
  }, [service])

  const leaveSession = useCallback(() => {
    service.leaveSession()
  }, [service])

  const syncNow = useCallback(async () => {
    await service.syncNow()
  }, [service])

  const revokeDevice = useCallback(
    async (targetDeviceId: string) => {
      await service.revokeDevice(targetDeviceId)
    },
    [service]
  )

  const dismissConflict = useCallback(
    (conflictId: string) => {
      service.dismissConflict(conflictId)
    },
    [service]
  )

  const clearConflicts = useCallback(() => {
    service.clearConflicts()
  }, [service])

  const joinSessionAuto = useCallback(
    async (sessionId: string, autoPairingToken: string) => {
      await service.joinSessionAuto(sessionId, autoPairingToken)
    },
    [service]
  )

  const probeNearby = useCallback(async () => {
    return await service.probeLocalNetwork()
  }, [service])

  return {
    content,
    setContent,
    state,
    createSession,
    joinSession,
    joinSessionAuto,
    probeNearby,
    resumeSession,
    closeSession,
    leaveSession,
    syncNow,
    revokeDevice,
    dismissConflict,
    clearConflicts,
    service,
  }
}
