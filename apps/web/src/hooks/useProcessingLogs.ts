import { useCallback, useEffect, useMemo, useState } from 'react'
import { getSocket } from '../lib/socket'

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
  const [nextSyncAt, setNextSyncAt] = useState<string | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)

  const fetchDevToolsStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/devtools`)
      if (!res.ok) return
      const data = await res.json() as { nextSyncAt: string | null }
      setNextSyncAt(data.nextSyncAt)
    } catch {
      // swallow
    }
  }, [])

  const triggerSync = useCallback(async () => {
    setIsSyncing(true)
    try {
      await fetch(`${API_BASE}/api/v1/sync`, { method: 'POST' })
    } catch {
      // swallow
    } finally {
      setTimeout(() => setIsSyncing(false), 3000)
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
          devToolsEnabled: boolean
        }

        if (!cancelled) {
          setIsEnabled(payload.devToolsEnabled)
          setLogs(payload.data.slice(-MAX_LOG_ENTRIES))
        }
      } catch {
        // Swallow
      }
    }

    void loadInitial()
    void fetchDevToolsStatus()

    const pollInterval = setInterval(() => {
      void fetchDevToolsStatus()
    }, 30_000)

    const socket = getSocket()

    const onConnect = () => {
      setIsConnected(true)
    }

    const onDisconnect = () => {
      setIsConnected(false)
    }

    const onProcessingLog = (entry: ProcessingLogEntry) => {
      setIsEnabled(true)
      setLogs((prev) => mergeStreamingEntry(prev, entry))
    }

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('processing:log', onProcessingLog)

    if (socket.connected) {
      setIsConnected(true)
    }

    return () => {
      cancelled = true
      clearInterval(pollInterval)
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('processing:log', onProcessingLog)
    }
  }, [fetchDevToolsStatus])

  return useMemo(
    () => ({
      logs,
      isEnabled,
      isConnected,
      nextSyncAt,
      isSyncing,
      triggerSync,
    }),
    [logs, isEnabled, isConnected, nextSyncAt, isSyncing, triggerSync],
  )
}
