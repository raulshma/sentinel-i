import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal, X, ChevronDown, Play, Clock, Maximize2, Minimize2 } from 'lucide-react'
import type { ProcessingLogEntry, ProcessingStatus, ProcessingStage } from '../hooks/useProcessingLogs'

const STAGE_LABELS: Record<ProcessingStage, string> = {
  feed_fetch: 'FEED',
  feed_parse: 'PARSE',
  deduplication: 'DEDUP',
  content_fetch: 'FETCH',
  content_parse: 'EXTRACT',
  ai_processing: 'AI',
  ai_tool_call: 'TOOL',
  ai_reasoning: 'THINK',
  geocoding: 'GEO',
  fact_check: 'FACT',
  storage: 'STORE',
  complete: 'DONE',
  error: 'ERROR',
}

const STATUS_COLORS: Record<ProcessingStatus, string> = {
  info: 'text-slate-400',
  success: 'text-emerald-400',
  warn: 'text-amber-400',
  error: 'text-red-400',
  start: 'text-sky-400',
}

const STATUS_INDICATORS: Record<ProcessingStatus, string> = {
  info: '\u25CB',
  success: '\u25CF',
  warn: '\u25B2',
  error: '\u2715',
  start: '\u2192',
}

interface TerminalPanelProps {
  logs: ProcessingLogEntry[]
  isEnabled: boolean
  isConnected: boolean
  isOpen: boolean
  onToggle: () => void
  nextSyncAt: string | null
  isSyncing: boolean
  onTriggerSync: () => void
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatNextSync(iso: string | null): string {
  if (!iso) return '...'
  const date = new Date(iso)
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  if (diffMs <= 0) return 'now'
  const mins = Math.floor(diffMs / 60_000)
  const secs = Math.floor((diffMs % 60_000) / 1000)
  if (mins > 0) return `${mins}m ${secs}s`
  return `${secs}s`
}

function truncateText(text: string, maxLen = 50): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 3) + '...'
}

function LogEntry({ log }: { log: ProcessingLogEntry }) {
  const isReasoning = log.stage === 'ai_reasoning'
  const isStreaming = isReasoning && log.isStreaming

  return (
    <div
      className={`flex gap-2 px-1 py-0.5 ${isReasoning ? 'bg-violet-500/5 border-l-2 border-violet-500/30' : 'hover:bg-white/5'}`}
    >
      <span className="shrink-0 text-slate-600">{formatTime(log.createdAt)}</span>
      <span
        className={`shrink-0 w-12 text-right ${STATUS_COLORS[log.status]} ${isReasoning ? '!text-violet-400' : ''}`}
        aria-hidden="true"
      >
        {STATUS_INDICATORS[log.status]} {STAGE_LABELS[log.stage]}
      </span>
      <span className={`min-w-0 break-all whitespace-pre-wrap ${isReasoning ? 'text-violet-300/80 text-[10px] italic' : 'text-slate-300'}`}>
        {isReasoning ? `Reasoning: ${log.message}` : log.message}
        {isStreaming && (
          <span className="inline-block w-1.5 h-3 ml-0.5 bg-violet-400 animate-pulse align-text-bottom" />
        )}
        {log.headline && !isReasoning && (
          <span className="text-slate-500">{' \u2014 '}{truncateText(log.headline, 60)}</span>
        )}
      </span>
    </div>
  )
}

function NextSyncCountdown({ nextSyncAt }: { nextSyncAt: string | null }) {
  const [display, setDisplay] = useState(() => formatNextSync(nextSyncAt))

  useEffect(() => {
    const update = () => setDisplay(formatNextSync(nextSyncAt))
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [nextSyncAt])

  return <span>next sync in {display}</span>
}

export function TerminalPanel({
  logs,
  isEnabled,
  isConnected,
  isOpen,
  onToggle,
  nextSyncAt,
  isSyncing,
  onTriggerSync,
}: TerminalPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const shouldAutoScroll = useRef(true)
  const [isMaximized, setIsMaximized] = useState(false)

  const handleToggleMaximize = useCallback(() => {
    setIsMaximized((prev) => !prev)
  }, [])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    shouldAutoScroll.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 50
  }, [])

  useEffect(() => {
    if (shouldAutoScroll.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs])

  if (!isEnabled) return null

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          aria-label={isOpen ? 'Close processing terminal' : 'Open processing terminal'}
          className="glass-panel flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-sky-400"
        >
          <Terminal size={14} aria-hidden="true" />
          <span className="hidden sm:inline">DevTools</span>
          {isConnected && (
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
          )}
          {isOpen ? <ChevronDown size={12} /> : null}
        </button>

        <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
          <Clock size={10} aria-hidden="true" />
          <NextSyncCountdown nextSyncAt={nextSyncAt} />
        </div>

        <button
          type="button"
          onClick={onTriggerSync}
          disabled={isSyncing}
          aria-label="Trigger manual sync"
          className="flex items-center gap-1 rounded-md bg-sky-500/20 px-2 py-1 text-[10px] font-medium text-sky-300 transition-colors hover:bg-sky-500/30 disabled:opacity-40"
        >
          <Play size={9} className={isSyncing ? 'animate-spin' : ''} aria-hidden="true" />
          {isSyncing ? 'Syncing...' : 'Sync'}
        </button>
      </div>

      <div
        role="log"
        aria-label="Article processing terminal"
        className={`glass-panel overflow-hidden rounded-xl transition-all duration-200 ${
          isMaximized && isOpen
            ? 'fixed inset-3 z-50 flex flex-col'
            : 'absolute bottom-full right-0 mb-2 w-[640px] max-w-[calc(100vw-1.5rem)]'
        } ${isOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none invisible opacity-0'}`}
        style={isMaximized && isOpen ? undefined : { height: 320 }}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-3 py-2">
          <div className="flex items-center gap-2">
            <Terminal size={12} className="text-sky-400" aria-hidden="true" />
            <span className="text-[11px] font-mono text-slate-300">Processing Terminal</span>
            <span className="text-[9px] text-slate-500 font-mono">
              {logs.length} entries
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleToggleMaximize}
              aria-label={isMaximized ? 'Restore terminal' : 'Maximize terminal'}
              className="text-slate-400 transition-colors hover:text-white"
            >
              {isMaximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            </button>
            <button
              type="button"
              onClick={onToggle}
              aria-label="Close terminal"
              className="text-slate-400 transition-colors hover:text-white"
            >
              <X size={12} />
            </button>
          </div>
        </div>

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className={`overflow-y-auto bg-black/30 p-2 font-mono text-[11px] leading-5 ${
            isMaximized ? 'min-h-0 flex-1' : 'h-[calc(100%-36px)]'
          }`}
        >
          {logs.length === 0 && (
            <div className="flex h-full items-center justify-center text-slate-500">
              Waiting for processing events...
            </div>
          )}
          {logs.map((log, idx) => (
            <LogEntry key={log.streamId ?? log.id ?? idx} log={log} />
          ))}
        </div>
      </div>
    </>
  )
}
