import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'

export type ProcessingStage =
  | 'feed_fetch'
  | 'feed_parse'
  | 'deduplication'
  | 'content_fetch'
  | 'content_parse'
  | 'ai_processing'
  | 'ai_tool_call'
  | 'ai_reasoning'
  | 'geocoding'
  | 'fact_check'
  | 'storage'
  | 'complete'
  | 'error'

export type ProcessingStatus = 'info' | 'success' | 'warn' | 'error' | 'start'

export interface ProcessingLogEntry {
  id?: string
  sourceUrl: string
  headline: string | null
  stage: ProcessingStage
  message: string
  status: ProcessingStatus
  metadata?: Record<string, unknown>
  streamId?: string
  isStreaming?: boolean
  createdAt: string
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''
const SOCKET_BASE_URL = import.meta.env.VITE_SOCKET_URL
const MAX_LOG_ENTRIES = 500

function mergeStreamingEntry(
  prev: ProcessingLogEntry[],
  entry: ProcessingLogEntry,
): ProcessingLogEntry[] {
  if (entry.streamId) {
    const idx = prev.findLastIndex((e) => e.streamId === entry.streamId && e.isStreaming)
    if (idx !== -1) {
      const updated = prev.slice()
      updated[idx] = entry
      return updated
    }
  }

  return [...prev.slice(-(MAX_LOG_ENTRIES - 1)), entry]
}

export const useProcessingLogs = () => {
  const [logs, setLogs] = useState<ProcessingLogEntry[]>([])
  const [isEnabled, setIsEnabled] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const socketRef = useRef<ReturnType<typeof io> | null>(null)

  const fetchHistoricalLogs = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/v1/processing/logs`)
      if (!response.ok) return

      const payload = (await response.json()) as {
        data: ProcessingLogEntry[]
        liveUpdatesEnabled: boolean
      }

      setIsEnabled(payload.liveUpdatesEnabled)
      setLogs(payload.data.slice(-MAX_LOG_ENTRIES))
    } catch {
      // Swallow network errors
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadInitial = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/v1/processing/logs`)
        if (!response.ok || cancelled) return

        const payload = (await response.json()) as {
          data: ProcessingLogEntry[]
          liveUpdatesEnabled: boolean
        }

        if (!cancelled) {
          setIsEnabled(payload.liveUpdatesEnabled)
          setLogs(payload.data.slice(-MAX_LOG_ENTRIES))
        }
      } catch {
        // Swallow
      }
    }

    void loadInitial()

    const socket = io(SOCKET_BASE_URL ?? window.location.origin, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      withCredentials: true,
      timeout: 5_000,
    })

    socketRef.current = socket

    socket.on('connect', () => {
      setIsConnected(true)
    })

    socket.on('disconnect', () => {
      setIsConnected(false)
    })

    socket.on('processing:log', (entry: ProcessingLogEntry) => {
      setIsEnabled(true)
      setLogs((prev) => mergeStreamingEntry(prev, entry))
    })

    return () => {
      cancelled = true
      socket.close()
      socketRef.current = null
    }
  }, [])

  return useMemo(
    () => ({
      logs,
      isEnabled,
      isConnected,
      refetch: fetchHistoricalLogs,
    }),
    [logs, isEnabled, isConnected, fetchHistoricalLogs],
  )
}
