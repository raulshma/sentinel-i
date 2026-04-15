import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getSocket } from '../lib/socket'

type RealtimeStatsResponse = {
  data: {
    connectedUsers: number
    websocketEnabled: boolean
    fallbackPollingIntervalMs: number
  }
}

type ConnectionMode = 'websocket' | 'polling'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''
const DEFAULT_POLL_INTERVAL_MS = 15_000

export const useRealtimeStats = () => {
  const [connectedUsers, setConnectedUsers] = useState(0)
  const [mode, setMode] = useState<ConnectionMode>('polling')
  const [isSocketConnected, setIsSocketConnected] = useState(false)
  const pollIntervalRef = useRef<number | null>(null)

  const fetchStats = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(`${API_BASE}/api/v1/news/stats`)

      if (!response.ok) {
        return
      }

      const payload = (await response.json()) as RealtimeStatsResponse
      setConnectedUsers(payload.data.connectedUsers)
    } catch {
      // Swallow network errors; polling/websocket reconnect handles recovery.
    }
  }, [])

  useEffect(() => {
    const startPolling = () => {
      if (pollIntervalRef.current !== null) {
        return
      }

      pollIntervalRef.current = window.setInterval(() => {
        void fetchStats()
      }, DEFAULT_POLL_INTERVAL_MS)

      void fetchStats()
    }

    const stopPolling = () => {
      if (pollIntervalRef.current === null) {
        return
      }

      window.clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }

    const socket = getSocket()

    const onConnect = () => {
      setIsSocketConnected(true)
      setMode('websocket')
      stopPolling()
      void fetchStats()
    }

    const onDisconnect = () => {
      setIsSocketConnected(false)
      setMode('polling')
      startPolling()
    }

    const onConnectError = () => {
      setIsSocketConnected(false)
      setMode('polling')
      startPolling()
    }

    const onPresence = (payload: { connectedUsers: number }) => {
      setConnectedUsers(payload.connectedUsers)
    }

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('connect_error', onConnectError)
    socket.on('presence:user-count', onPresence)

    startPolling()

    return () => {
      stopPolling()
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('connect_error', onConnectError)
      socket.off('presence:user-count', onPresence)
    }
  }, [fetchStats])

  return useMemo(
    () => ({
      connectedUsers,
      mode,
      isSocketConnected,
    }),
    [connectedUsers, isSocketConnected, mode],
  )
}
