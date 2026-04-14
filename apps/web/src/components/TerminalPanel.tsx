import { useCallback, useEffect, useRef } from 'react'
import { Terminal, X, ChevronDown } from 'lucide-react'
import type { ProcessingLogEntry, ProcessingStatus, ProcessingStage } from '../hooks/useProcessingLogs'

const STAGE_LABELS: Record<ProcessingStage, string> = {
  feed_fetch: 'FEED',
  feed_parse: 'PARSE',
  deduplication: 'DEDUP',
  content_fetch: 'FETCH',
  content_parse: 'EXTRACT',
  ai_processing: 'AI',
  ai_tool_call: 'TOOL',
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
  info: '○',
  success: '●',
  warn: '▲',
  error: '✕',
  start: '→',
}

interface TerminalPanelProps {
  logs: ProcessingLogEntry[]
  isEnabled: boolean
  isConnected: boolean
  isOpen: boolean
  onToggle: () => void
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

function truncateUrl(url: string, maxLen = 50): string {
  if (url.length <= maxLen) return url
  return url.slice(0, maxLen - 3) + '...'
}

export function TerminalPanel({
  logs,
  isEnabled,
  isConnected,
  isOpen,
  onToggle,
}: TerminalPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const shouldAutoScroll = useRef(true)

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
      <button
        type="button"
        onClick={onToggle}
        aria-label={isOpen ? 'Close processing terminal' : 'Open processing terminal'}
        className="glass-panel flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-sky-400"
      >
        <Terminal size={14} aria-hidden="true" />
        <span className="hidden sm:inline">Live</span>
        {isConnected && (
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
        )}
        {isOpen ? <ChevronDown size={12} /> : null}
      </button>

      {isOpen && (
        <div
          role="log"
          aria-label="Article processing terminal"
          className="glass-panel animate-in fade-in-0 zoom-in-95 absolute bottom-full right-0 mb-2 w-[640px] max-w-[calc(100vw-1.5rem)] overflow-hidden duration-150"
          style={{ height: 320 }}
        >
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <div className="flex items-center gap-2">
              <Terminal size={12} className="text-sky-400" aria-hidden="true" />
              <span className="text-[11px] font-mono text-slate-300">Processing Terminal</span>
              <span className="text-[9px] text-slate-500 font-mono">
                {logs.length} entries
              </span>
            </div>
            <button
              type="button"
              onClick={onToggle}
              aria-label="Close terminal"
              className="text-slate-400 transition-colors hover:text-white"
            >
              <X size={12} />
            </button>
          </div>

          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="h-[calc(100%-36px)] overflow-y-auto bg-black/30 p-2 font-mono text-[11px] leading-5"
          >
            {logs.length === 0 && (
              <div className="flex h-full items-center justify-center text-slate-500">
                Waiting for processing events...
              </div>
            )}
            {logs.map((log, idx) => (
              <div key={log.id ?? idx} className="flex gap-2 hover:bg-white/5 px-1 py-0.5">
                <span className="shrink-0 text-slate-600">{formatTime(log.createdAt)}</span>
                <span
                  className={`shrink-0 w-12 text-right ${STATUS_COLORS[log.status]}`}
                  aria-hidden="true"
                >
                  {STATUS_INDICATORS[log.status]} {STAGE_LABELS[log.stage]}
                </span>
                <span className="min-w-0 break-all text-slate-300">
                  {log.message}
                  {log.headline && (
                    <span className="text-slate-500"> — {truncateUrl(log.headline, 60)}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
