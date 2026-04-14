import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'

type RealtimeStatsResponse = {
  data: {
    connectedUsers: number
    websocketEnabled: boolean
    fallbackPollingIntervalMs: number
  }
}

type ConnectionMode = 'websocket' | 'polling'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''
const SOCKET_BASE_URL = import.meta.env.VITE_SOCKET_URL
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

    const socket = io(SOCKET_BASE_URL ?? window.location.origin, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      withCredentials: true,
      timeout: 5_000,
    })

    socket.on('connect', () => {
      setIsSocketConnected(true)
      setMode('websocket')
      stopPolling()
      void fetchStats()
    })

    socket.on('disconnect', () => {
      setIsSocketConnected(false)
      setMode('polling')
      startPolling()
    })

    socket.on('connect_error', () => {
      setIsSocketConnected(false)
      setMode('polling')
      startPolling()
    })

    socket.on('presence:user-count', (payload: { connectedUsers: number }) => {
      setConnectedUsers(payload.connectedUsers)
    })

    startPolling()

    return () => {
      stopPolling()
      socket.close()
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
