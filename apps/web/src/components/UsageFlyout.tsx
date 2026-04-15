import { useEffect, useRef } from 'react'
import { X, RefreshCw, CreditCard, Zap, Calendar, AlertCircle } from 'lucide-react'
import type { UsageLimitsData } from '../hooks/useUsageLimits'

interface UsageFlyoutProps {
  isOpen: boolean
  onClose: () => void
  data: UsageLimitsData | null
  isLoading: boolean
  error: string | null
  onRefresh: () => void
}

function formatCredits(value: number): string {
  if (value === 0) return '0'
  if (value < 0.01) return '< $0.01'
  if (value < 1) return `$${value.toFixed(4)}`
  if (value < 1000) return `$${value.toFixed(2)}`
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}

function CreditBar({ used, limit }: { used: number; limit: number | null }) {
  if (limit === null) {
    return (
      <div className="space-y-1">
        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-sky-400 w-full opacity-40" />
        </div>
        <span className="text-[9px] text-slate-500">Unlimited</span>
      </div>
    )
  }

  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0
  const remaining = Math.max(limit - used, 0)
  const barColor =
    pct > 90 ? 'from-red-500 to-red-400' :
    pct > 70 ? 'from-amber-500 to-amber-400' :
    'from-emerald-500 to-sky-400'

  return (
    <div className="space-y-1">
      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${barColor} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between">
        <span className="text-[9px] text-slate-500">{pct.toFixed(1)}% used</span>
        <span className="text-[9px] text-slate-500">{formatCredits(remaining)} left</span>
      </div>
    </div>
  )
}

function UsageRow({ label, value, icon: Icon }: { label: string; value: string; icon?: React.ComponentType<{ size?: number; className?: string }> }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2">
        {Icon && <Icon size={11} className="text-slate-500" />}
        <span className="text-[11px] text-slate-400">{label}</span>
      </div>
      <span className="text-[11px] font-mono text-white/90">{value}</span>
    </div>
  )
}

function SectionCard({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 transition-all duration-200 hover:border-white/10 ${className ?? ''}`}>
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">{title}</h3>
      {children}
    </div>
  )
}

export function UsageFlyout({ isOpen, onClose, data, isLoading, error, onRefresh }: UsageFlyoutProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return

    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [isOpen, onClose])

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  if (!isOpen) return null

  const keyData = data?.data

  return (
    <>
      <div className="fixed inset-0 z-[90] bg-black/20 backdrop-blur-[2px] animate-fade-in duration-200" />
      <div
        ref={panelRef}
        role="dialog"
        aria-label="OpenRouter API Usage & Limits"
        className="fixed z-[91] bottom-16 right-4 w-[340px] max-h-[calc(100vh-100px)] overflow-y-auto
          rounded-2xl border border-white/[0.08] bg-[#1c1c1c]/95 backdrop-blur-2xl
          shadow-[0_24px_80px_-12px_rgba(0,0,0,0.8),0_0_1px_rgba(255,255,255,0.1)]
          animate-slide-in-up duration-200"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/[0.06] bg-[#1c1c1c]/90 backdrop-blur-xl px-4 py-3 rounded-t-2xl">
          <div className="flex items-center gap-2">
            <CreditCard size={14} className="text-sky-400" />
            <span className="text-sm font-semibold text-white">Usage & Limits</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onRefresh}
              disabled={isLoading}
              aria-label="Refresh usage data"
              className="rounded-lg p-1.5 text-slate-400 transition-all duration-150 hover:bg-white/10 hover:text-white hover:rotate-90 disabled:opacity-40"
            >
              <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close usage panel"
              className="rounded-lg p-1.5 text-slate-400 transition-all duration-150 hover:bg-white/10 hover:text-white hover:rotate-90"
            >
              <X size={13} />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-3">
          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
              <AlertCircle size={13} className="text-red-400 shrink-0" />
              <span className="text-[11px] text-red-300">{error}</span>
            </div>
          )}

          {!data?.configured && !error && (
            <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-3">
              <AlertCircle size={13} className="text-amber-400 shrink-0" />
              <span className="text-[11px] text-amber-300">OpenRouter API key not configured</span>
            </div>
          )}

          {keyData && (
            <>
              <div className="flex items-center gap-2 px-1">
                <span className="text-xs text-slate-400">Key:</span>
                <span className="text-xs font-mono text-slate-200">{keyData.label || 'Unnamed'}</span>
                {keyData.is_free_tier && (
                  <span className="rounded-md bg-slate-500/20 px-1.5 py-0.5 text-[9px] font-medium text-slate-400">
                    Free Tier
                  </span>
                )}
              </div>

              {keyData.limit !== null && (
                <SectionCard title="Credit Limit" className="animate-fade-in stagger-1">
                  <CreditBar used={keyData.usage} limit={keyData.limit} />
                  <div className="mt-2 space-y-0">
                    <UsageRow label="Total Limit" value={formatCredits(keyData.limit)} icon={CreditCard} />
                    <UsageRow label="Remaining" value={formatCredits(keyData.limit_remaining ?? 0)} icon={CreditCard} />
                    {keyData.limit_reset && (
                      <UsageRow label="Resets" value={keyData.limit_reset} icon={Calendar} />
                    )}
                  </div>
                </SectionCard>
              )}

              <SectionCard title="API Usage" className="animate-fade-in stagger-2">
                <UsageRow label="All Time" value={formatCredits(keyData.usage)} icon={Zap} />
                <div className="border-t border-white/[0.04] my-1" />
                <UsageRow label="Today" value={formatCredits(keyData.usage_daily)} />
                <UsageRow label="This Week" value={formatCredits(keyData.usage_weekly)} />
                <UsageRow label="This Month" value={formatCredits(keyData.usage_monthly)} />
              </SectionCard>

              {(keyData.byok_usage > 0 || keyData.byok_usage_daily > 0) && (
                <SectionCard title="BYOK Usage" className="animate-fade-in stagger-3">
                  <UsageRow label="All Time" value={formatCredits(keyData.byok_usage)} icon={Zap} />
                  <div className="border-t border-white/[0.04] my-1" />
                  <UsageRow label="Today" value={formatCredits(keyData.byok_usage_daily)} />
                  <UsageRow label="This Week" value={formatCredits(keyData.byok_usage_weekly)} />
                  <UsageRow label="This Month" value={formatCredits(keyData.byok_usage_monthly)} />
                </SectionCard>
              )}
            </>
          )}

          {isLoading && !data && (
            <div className="flex items-center justify-center py-8">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
            </div>
          )}
        </div>
      </div>
    </>
  )
}
