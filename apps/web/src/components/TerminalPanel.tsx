import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BarChart3,
  ListOrdered,
  Terminal,
  X,
  ChevronDown,
  Play,
  Clock,
  Maximize2,
  Minimize2,
  RefreshCw,
  Search,
} from "lucide-react";
import type {
  ProcessingLogEntry,
  ProcessingStatus,
  ProcessingStage,
} from "../hooks/useProcessingLogs";
import { useProcessingAnalytics } from "../hooks/useProcessingAnalytics";
import {
  type ProcessingTimelineGroup,
  type ProcessingTimelineQuery,
  useProcessingTimeline,
} from "../hooks/useProcessingTimeline";

type TerminalTab = "stream" | "timeline" | "analytics";

const STAGE_LABELS: Record<ProcessingStage, string> = {
  queue: "QUEUE",
  feed_fetch: "FEED",
  feed_parse: "PARSE",
  deduplication: "DEDUP",
  content_fetch: "FETCH",
  content_parse: "EXTRACT",
  ai_processing: "AI",
  ai_tool_call: "TOOL",
  ai_reasoning: "THINK",
  geocoding: "GEO",
  fact_check: "FACT",
  storage: "STORE",
  complete: "DONE",
  error: "ERROR",
};

const STATUS_COLORS: Record<ProcessingStatus, string> = {
  info: "text-slate-400",
  success: "text-emerald-400",
  warn: "text-amber-400",
  error: "text-red-400",
  start: "text-sky-400",
};

const STATUS_INDICATORS: Record<ProcessingStatus, string> = {
  info: "\u25CB",
  success: "\u25CF",
  warn: "\u25B2",
  error: "\u2715",
  start: "\u2192",
};

interface TerminalPanelProps {
  logs: ProcessingLogEntry[];
  isEnabled: boolean;
  isConnected: boolean;
  isOpen: boolean;
  onToggle: () => void;
  nextSyncAt: string | null;
  isSyncing: boolean;
  onTriggerSync: () => void;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatNextSync(iso: string | null): string {
  if (!iso) return "...";
  const date = new Date(iso);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  if (diffMs <= 0) return "now";
  const mins = Math.floor(diffMs / 60_000);
  const secs = Math.floor((diffMs % 60_000) / 1000);
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function truncateText(text: string, maxLen = 50): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

function formatDuration(durationMs?: number): string {
  if (durationMs == null) return "—";
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(2)}s`;
}

function formatActivityBucketLabel(iso: string, windowHours: number): string {
  const date = new Date(iso);

  if (windowHours <= 72) {
    return date.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatCostUsd(cost: number): string {
  if (cost <= 0) return "$0.00";
  if (cost < 0.01) return "< $0.01";
  return `$${cost.toFixed(4)}`;
}

function formatTimelineGroupTitle(group: ProcessingTimelineGroup): string {
  if (group.headline) {
    return truncateText(group.headline, 44);
  }

  return truncateText(group.sourceUrl, 44);
}

function formatTimelineGroupIdentity(group: ProcessingTimelineGroup): string {
  if (group.traceId) return `trace:${truncateText(group.traceId, 14)}`;
  if (group.articleId) return `article:${truncateText(group.articleId, 14)}`;
  if (group.jobId) return `job:${truncateText(group.jobId, 14)}`;
  if (group.runId) return `run:${truncateText(group.runId, 14)}`;
  return truncateText(group.sourceUrl, 18);
}

const LogEntry = memo(function LogEntry({ log }: { log: ProcessingLogEntry }) {
  const isReasoning = log.stage === "ai_reasoning";
  const isStreaming = isReasoning && log.isStreaming;

  return (
    <div
      className={`flex gap-2 px-1 py-0.5 ${isReasoning ? "bg-violet-500/5 border-l-2 border-violet-500/30" : "hover:bg-white/5"}`}
    >
      <span className="shrink-0 text-slate-600">
        {formatTime(log.createdAt)}
      </span>
      <span
        className={`shrink-0 w-12 text-right ${STATUS_COLORS[log.status]} ${isReasoning ? "text-violet-400!" : ""}`}
        aria-hidden="true"
      >
        {STATUS_INDICATORS[log.status]} {STAGE_LABELS[log.stage]}
      </span>
      <span
        className={`min-w-0 break-all whitespace-pre-wrap ${isReasoning ? "text-violet-300/80 text-[10px] italic" : "text-slate-300"}`}
      >
        {isReasoning ? `Reasoning: ${log.message}` : log.message}
        {isStreaming && (
          <span className="inline-block w-1.5 h-3 ml-0.5 bg-violet-400 animate-pulse align-text-bottom" />
        )}
        {log.headline && !isReasoning && (
          <span className="text-slate-500">
            {" \u2014 "}
            {truncateText(log.headline, 60)}
          </span>
        )}
      </span>
    </div>
  );
});

const TimelineEntry = memo(function TimelineEntry({
  log,
}: {
  log: ProcessingLogEntry;
}) {
  return (
    <div className="grid grid-cols-[68px_58px_62px_1fr] gap-2 border-b border-white/5 px-1 py-1 text-[10px]">
      <span className="text-slate-600">{formatTime(log.createdAt)}</span>
      <span className={`font-mono ${STATUS_COLORS[log.status]}`}>
        {STAGE_LABELS[log.stage]}
      </span>
      <span className="text-slate-500">{formatDuration(log.durationMs)}</span>
      <div className="min-w-0">
        <p className="truncate text-slate-300">{log.message}</p>
        <p className="truncate text-[9px] text-slate-500">
          {log.traceId ? `trace:${truncateText(log.traceId, 12)}` : "trace:-"}
          {" · "}
          {log.jobId ? `job:${truncateText(log.jobId, 12)}` : "job:-"}
          {" · "}
          {truncateText(log.sourceUrl, 56)}
        </p>
      </div>
    </div>
  );
});

function NextSyncCountdown({ nextSyncAt }: { nextSyncAt: string | null }) {
  const [display, setDisplay] = useState(() => formatNextSync(nextSyncAt));

  useEffect(() => {
    const update = () => setDisplay(formatNextSync(nextSyncAt));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [nextSyncAt]);

  return <span>next sync in {display}</span>;
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);
  const hasAutoLoadedTimeline = useRef(false);
  const hasAutoLoadedAnalytics = useRef(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(window.innerHeight);
  const [activeTab, setActiveTab] = useState<TerminalTab>("stream");
  const [timelineHours, setTimelineHours] = useState(24);
  const [timelineSearch, setTimelineSearch] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  const {
    data: timelineData,
    groups: timelineGroups,
    isLoading: isTimelineLoading,
    error: timelineError,
    fetchTimeline,
  } = useProcessingTimeline();

  const {
    data: analytics,
    isLoading: isAnalyticsLoading,
    error: analyticsError,
    windowHours,
    fetchAnalytics,
  } = useProcessingAnalytics();

  const buildTimelineQuery = useCallback((): ProcessingTimelineQuery => {
    const query: ProcessingTimelineQuery = {
      limit: 1200,
      hours: timelineHours,
    };

    const term = timelineSearch.trim();
    if (!term) {
      return query;
    }

    if (term.startsWith("trace:")) {
      query.traceId = term.slice(6).trim();
      return query;
    }

    if (term.startsWith("job:")) {
      query.jobId = term.slice(4).trim();
      return query;
    }

    if (term.startsWith("run:")) {
      query.runId = term.slice(4).trim();
      return query;
    }

    if (/^[0-9a-fA-F-]{36}$/.test(term)) {
      query.articleId = term;
      return query;
    }

    query.sourceUrl = term;
    return query;
  }, [timelineHours, timelineSearch]);

  const loadTimeline = useCallback(() => {
    void fetchTimeline(buildTimelineQuery());
  }, [buildTimelineQuery, fetchTimeline]);

  const loadAnalytics = useCallback(
    (hours = windowHours) => {
      void fetchAnalytics(hours);
    },
    [fetchAnalytics, windowHours],
  );

  const handleTabChange = useCallback(
    (nextTab: TerminalTab) => {
      setActiveTab(nextTab);

      if (nextTab === "timeline" && !hasAutoLoadedTimeline.current) {
        hasAutoLoadedTimeline.current = true;
        void fetchTimeline(buildTimelineQuery());
      }

      if (nextTab === "analytics" && !hasAutoLoadedAnalytics.current) {
        hasAutoLoadedAnalytics.current = true;
        void fetchAnalytics(windowHours);
      }
    },
    [buildTimelineQuery, fetchAnalytics, fetchTimeline, windowHours],
  );

  const selectedTimelineGroup = useMemo(
    () =>
      selectedGroupId
        ? (timelineGroups.find((group) => group.groupId === selectedGroupId) ??
          null)
        : null,
    [selectedGroupId, timelineGroups],
  );

  const filteredTimelineEvents = useMemo(() => {
    if (!selectedTimelineGroup) {
      return timelineData;
    }

    const eventIds = new Set(selectedTimelineGroup.eventIds);
    return timelineData.filter((event) =>
      event.id ? eventIds.has(event.id) : false,
    );
  }, [selectedTimelineGroup, timelineData]);

  useEffect(() => {
    if (!isMaximized) return;
    const update = () => setViewportHeight(window.innerHeight);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [isMaximized]);

  useEffect(() => {
    if (!isMaximized || !isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMaximized, isOpen]);

  const handleToggleMaximize = useCallback(() => {
    setIsMaximized((prev) => !prev);
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    shouldAutoScroll.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 50;
  }, []);

  useEffect(() => {
    if (shouldAutoScroll.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  if (!isEnabled) return null;

  const panel = (
    <div
      role="log"
      aria-label="Article processing terminal"
      className={`glass-panel overflow-hidden rounded-xl transition-all duration-200 ${
        isMaximized && isOpen
          ? "fixed inset-x-3 top-3 z-120 flex flex-col animate-scale-in"
          : "absolute bottom-full right-0 mb-2 w-160 max-w-[calc(100vw-1.5rem)]"
      } ${isOpen ? "pointer-events-auto opacity-100 animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-3 duration-200" : "pointer-events-none invisible opacity-0"}`}
      style={
        isMaximized && isOpen
          ? { height: viewportHeight - 24 }
          : { height: 320 }
      }
    >
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-3 py-2">
        <div className="flex items-center gap-2">
          <Terminal size={12} className="text-sky-400" aria-hidden="true" />
          <span className="text-[11px] font-mono text-slate-300">
            Processing Terminal
          </span>
          {activeTab === "stream" ? (
            <span className="text-[9px] text-slate-500 font-mono">
              {logs.length} entries
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              if (activeTab === "timeline") {
                loadTimeline();
              } else if (activeTab === "analytics") {
                loadAnalytics();
              }
            }}
            aria-label="Refresh current tab"
            className="text-slate-400 transition-all duration-150 hover:text-white hover:scale-110"
          >
            <RefreshCw
              size={12}
              className={
                isTimelineLoading || isAnalyticsLoading
                  ? "animate-spin"
                  : undefined
              }
            />
          </button>
          <button
            type="button"
            onClick={handleToggleMaximize}
            aria-label={isMaximized ? "Restore terminal" : "Maximize terminal"}
            className="text-slate-400 transition-all duration-150 hover:text-white hover:scale-110"
          >
            {isMaximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
          <button
            type="button"
            onClick={onToggle}
            aria-label="Close terminal"
            className="text-slate-400 transition-all duration-150 hover:text-white hover:scale-110 hover:rotate-90"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 border-b border-white/10 px-2 py-1">
        <button
          type="button"
          onClick={() => handleTabChange("stream")}
          className={`rounded-md px-2 py-1 text-[10px] transition-all duration-150 hover:scale-[1.04] active:scale-[0.97] ${
            activeTab === "stream"
              ? "bg-sky-500/20 text-sky-300"
              : "text-slate-400 hover:bg-white/10"
          }`}
        >
          <Terminal size={10} className="mr-1 inline" />
          Stream
        </button>
        <button
          type="button"
          onClick={() => handleTabChange("timeline")}
          className={`rounded-md px-2 py-1 text-[10px] transition-all duration-150 hover:scale-[1.04] active:scale-[0.97] ${
            activeTab === "timeline"
              ? "bg-sky-500/20 text-sky-300"
              : "text-slate-400 hover:bg-white/10"
          }`}
        >
          <ListOrdered size={10} className="mr-1 inline" />
          Timeline
        </button>
        <button
          type="button"
          onClick={() => handleTabChange("analytics")}
          className={`rounded-md px-2 py-1 text-[10px] transition-all duration-150 hover:scale-[1.04] active:scale-[0.97] ${
            activeTab === "analytics"
              ? "bg-sky-500/20 text-sky-300"
              : "text-slate-400 hover:bg-white/10"
          }`}
        >
          <BarChart3 size={10} className="mr-1 inline" />
          Analytics
        </button>
      </div>

      {activeTab === "stream" ? (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className={`overflow-y-auto bg-black/30 p-2 font-mono text-[11px] leading-5 ${
            isMaximized ? "min-h-0 flex-1" : "h-[calc(100%-72px)]"
          }`}
        >
          {logs.length === 0 && (
            <div className="flex h-full items-center justify-center text-slate-500">
              Waiting for processing events...
            </div>
          )}
          {logs.map((log, idx) => (
            <LogEntry key={log.id ?? `${log.streamId}-${log.createdAt}-${idx}`} log={log} />
          ))}
        </div>
      ) : null}

      {activeTab === "timeline" ? (
        <>
          <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-2 py-1.5 text-[10px]">
            <div className="relative min-w-0 flex-1">
              <Search
                size={10}
                className="absolute left-2 top-1.5 text-slate-500"
              />
              <input
                value={timelineSearch}
                onChange={(event) => setTimelineSearch(event.target.value)}
                placeholder="source URL or trace:<id> / job:<id> / run:<id>"
                className="w-full rounded-md border border-white/10 bg-black/30 py-1 pl-6 pr-2 text-[10px] text-slate-300 outline-none focus:border-sky-400/60"
              />
            </div>
            <select
              value={timelineHours}
              onChange={(event) => setTimelineHours(Number(event.target.value))}
              className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[10px] text-slate-300 outline-none"
            >
              <option value={6}>6h</option>
              <option value={24}>24h</option>
              <option value={72}>72h</option>
              <option value={168}>7d</option>
            </select>
            <button
              type="button"
              onClick={() => {
                setSelectedGroupId(null);
                loadTimeline();
              }}
              className="rounded-md bg-sky-500/20 px-2 py-1 text-[10px] text-sky-300 transition-all duration-150 hover:bg-sky-500/30 hover:scale-[1.04] active:scale-[0.97]"
            >
              Load
            </button>
          </div>

          {timelineGroups.length > 0 ? (
            <div className="border-b border-white/10 px-2 py-1.5">
              <div className="mb-1 flex items-center justify-between text-[10px] text-slate-500">
                <span>{timelineGroups.length} grouped traces</span>
                {selectedTimelineGroup ? (
                  <button
                    type="button"
                    onClick={() => setSelectedGroupId(null)}
                    className="rounded-md px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-white/10 hover:text-white"
                  >
                    Clear filter
                  </button>
                ) : null}
              </div>

              <div className="flex gap-1 overflow-x-auto pb-1">
                {timelineGroups.slice(0, 80).map((group) => {
                  const isActive = selectedGroupId === group.groupId;

                  return (
                    <button
                      key={group.groupId}
                      type="button"
                      onClick={() => setSelectedGroupId(group.groupId)}
                      className={`min-w-40 rounded-md border px-2 py-1 text-left transition-all duration-150 hover:scale-[1.02] ${
                        isActive
                          ? "border-sky-400/60 bg-sky-500/20"
                          : "border-white/10 bg-black/30 hover:bg-white/10"
                      }`}
                    >
                      <p className="truncate text-[10px] font-medium text-slate-200">
                        {formatTimelineGroupTitle(group)}
                      </p>
                      <p className="truncate text-[9px] text-slate-500">
                        {formatTimelineGroupIdentity(group)}
                      </p>
                      <p className="mt-0.5 text-[9px] text-slate-400">
                        {group.eventCount} events · err {group.errorCount} ·{" "}
                        {formatDuration(group.durationMs ?? undefined)}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div
            className={`overflow-y-auto bg-black/30 p-2 font-mono ${
              isMaximized ? "min-h-0 flex-1" : "h-[calc(100%-106px)]"
            }`}
          >
            {isTimelineLoading ? (
              <div className="flex h-full items-center justify-center text-slate-500">
                Loading timeline...
              </div>
            ) : timelineError ? (
              <div className="rounded-md border border-red-500/20 bg-red-500/10 p-3 text-[11px] text-red-300">
                {timelineError}
              </div>
            ) : filteredTimelineEvents.length === 0 ? (
              <div className="flex h-full items-center justify-center text-slate-500">
                {selectedTimelineGroup
                  ? "No events found for the selected trace group."
                  : "No timeline events found for the selected filters."}
              </div>
            ) : (
              <>
                {selectedTimelineGroup ? (
                  <div className="mb-2 rounded-md border border-sky-400/30 bg-sky-500/10 px-2 py-1 text-[10px] text-sky-200">
                    <p className="font-medium">
                      {formatTimelineGroupTitle(selectedTimelineGroup)}
                    </p>
                    <p className="text-sky-200/80">
                      {formatTimelineGroupIdentity(selectedTimelineGroup)} ·{" "}
                      {selectedTimelineGroup.eventCount} events · success{" "}
                      {selectedTimelineGroup.successCount} · warn{" "}
                      {selectedTimelineGroup.warnCount} · error{" "}
                      {selectedTimelineGroup.errorCount}
                    </p>
                  </div>
                ) : null}

                {filteredTimelineEvents.map((entry, idx) => (
                  <TimelineEntry
                    key={entry.id ?? `${entry.traceId}-${idx}`}
                    log={entry}
                  />
                ))}
              </>
            )}
          </div>
        </>
      ) : null}

      {activeTab === "analytics" ? (
        <>
          <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-2 py-1.5 text-[10px]">
            <span className="text-slate-500">Window</span>
            <select
              value={windowHours}
              onChange={(event) => loadAnalytics(Number(event.target.value))}
              className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[10px] text-slate-300 outline-none"
            >
              <option value={6}>6h</option>
              <option value={24}>24h</option>
              <option value={72}>72h</option>
              <option value={168}>7d</option>
            </select>
          </div>

          <div
            className={`overflow-y-auto bg-black/30 p-2 text-[11px] ${
              isMaximized ? "min-h-0 flex-1" : "h-[calc(100%-106px)]"
            }`}
          >
            {isAnalyticsLoading ? (
              <div className="flex h-full items-center justify-center text-slate-500">
                Computing analytics...
              </div>
            ) : analyticsError ? (
              <div className="rounded-md border border-red-500/20 bg-red-500/10 p-3 text-[11px] text-red-300">
                {analyticsError}
              </div>
            ) : !analytics ? (
              <div className="flex h-full items-center justify-center text-slate-500">
                No analytics loaded yet.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div className="rounded-md border border-white/10 bg-black/30 p-2">
                    <p className="text-slate-500">Queue jobs</p>
                    <p className="text-sm text-white">
                      {analytics.queueMetrics.totalJobs}
                    </p>
                    <p className="text-slate-500">
                      retries: {analytics.queueMetrics.retryEvents}
                    </p>
                  </div>
                  <div className="rounded-md border border-white/10 bg-black/30 p-2">
                    <p className="text-slate-500">Queue success/fail</p>
                    <p className="text-sm text-white">
                      {analytics.queueMetrics.successfulJobs} /{" "}
                      {analytics.queueMetrics.failedJobs}
                    </p>
                    <p className="text-slate-500">
                      max attempt: {analytics.queueMetrics.maxAttempt}
                    </p>
                  </div>
                  <div className="rounded-md border border-white/10 bg-black/30 p-2">
                    <p className="text-slate-500">AI total tokens</p>
                    <p className="text-sm text-white">
                      {analytics.aiUsage.totalTokens.toLocaleString("en-US")}
                    </p>
                    <p className="text-slate-500">
                      in/out:{" "}
                      {analytics.aiUsage.inputTokens.toLocaleString("en-US")} /{" "}
                      {analytics.aiUsage.outputTokens.toLocaleString("en-US")}
                    </p>
                  </div>
                  <div className="rounded-md border border-white/10 bg-black/30 p-2">
                    <p className="text-slate-500">AI est. cost</p>
                    <p className="text-sm text-white">
                      {formatCostUsd(analytics.aiUsage.estimatedCostUsd)}
                    </p>
                    <p className="text-slate-500">
                      reasoning:{" "}
                      {analytics.aiUsage.reasoningTokens.toLocaleString(
                        "en-US",
                      )}
                    </p>
                  </div>
                </div>

                <div className="rounded-md border border-white/10 bg-black/30 p-2">
                  <p className="mb-2 text-[10px] uppercase tracking-wide text-slate-500">
                    Activity Trend
                  </p>

                  {analytics.activitySeries.length === 0 ? (
                    <p className="text-[10px] text-slate-500">
                      No activity buckets in this window.
                    </p>
                  ) : (
                    (() => {
                      const maxEvents = Math.max(
                        ...analytics.activitySeries.map(
                          (bucket) => bucket.totalEvents,
                        ),
                        1,
                      );

                      const firstBucket = analytics.activitySeries[0];
                      const lastBucket = analytics.activitySeries.at(-1);

                      return (
                        <>
                          <div className="flex h-24 items-end gap-1">
                            {analytics.activitySeries.map((bucket) => {
                              const totalHeight = Math.max(
                                4,
                                Math.round(
                                  (bucket.totalEvents / maxEvents) * 100,
                                ),
                              );
                              const errorHeight =
                                bucket.totalEvents > 0
                                  ? Math.max(
                                      1,
                                      Math.round(
                                        (bucket.errorEvents /
                                          bucket.totalEvents) *
                                          totalHeight,
                                      ),
                                    )
                                  : 0;

                              return (
                                <div
                                  key={bucket.bucketStart}
                                  className="group relative flex-1 animate-fade-in"
                                  style={{ animationDelay: `${analytics.activitySeries.indexOf(bucket) * 15}ms` }}
                                  title={`${formatActivityBucketLabel(bucket.bucketStart, analytics.windowHours)} · total ${bucket.totalEvents} · err ${bucket.errorEvents} · avg ${formatDuration(bucket.avgDurationMs ?? undefined)}`}
                                >
                                  <div
                                    className="absolute bottom-0 left-0 right-0 rounded-sm bg-sky-400/40 transition-colors group-hover:bg-sky-400/60"
                                    style={{ height: `${totalHeight}%` }}
                                  />
                                  {errorHeight > 0 ? (
                                    <div
                                      className="absolute bottom-0 left-0 right-0 rounded-b-sm bg-red-500/70"
                                      style={{ height: `${errorHeight}%` }}
                                    />
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>

                          <div className="mt-1 flex items-center justify-between text-[9px] text-slate-500">
                            <span>
                              {firstBucket
                                ? formatActivityBucketLabel(
                                    firstBucket.bucketStart,
                                    analytics.windowHours,
                                  )
                                : ""}
                            </span>
                            <span>
                              {lastBucket
                                ? formatActivityBucketLabel(
                                    lastBucket.bucketStart,
                                    analytics.windowHours,
                                  )
                                : ""}
                            </span>
                          </div>
                        </>
                      );
                    })()
                  )}
                </div>

                <div className="rounded-md border border-white/10 bg-black/30 p-2">
                  <p className="mb-2 text-[10px] uppercase tracking-wide text-slate-500">
                    Stage Metrics
                  </p>
                  <div className="space-y-1 text-[10px]">
                    {analytics.stageMetrics.length === 0 ? (
                      <p className="text-slate-500">
                        No stage metrics for this window.
                      </p>
                    ) : (
                      analytics.stageMetrics.map((row) => (
                        <div
                          key={row.stage}
                          className="grid grid-cols-[72px_1fr_1fr_1fr] items-center gap-2 border-b border-white/5 py-1"
                        >
                          <span className="font-mono text-slate-400">
                            {STAGE_LABELS[row.stage as ProcessingStage] ??
                              row.stage}
                          </span>
                          <span className="text-slate-300">
                            ok {row.successCount} · err {row.errorCount} · warn{" "}
                            {row.warnCount}
                          </span>
                          <span className="text-slate-400">
                            p50 {formatDuration(row.p50DurationMs ?? undefined)}
                          </span>
                          <span className="text-slate-400">
                            p95 {formatDuration(row.p95DurationMs ?? undefined)}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="rounded-md border border-white/10 bg-black/30 p-2">
                  <p className="mb-2 text-[10px] uppercase tracking-wide text-slate-500">
                    Failure Taxonomy
                  </p>
                  {analytics.failureTaxonomy.length === 0 ? (
                    <p className="text-[10px] text-slate-500">
                      No failures in this window. Nice.
                    </p>
                  ) : (
                    <div className="space-y-1 text-[10px]">
                      {analytics.failureTaxonomy.map((row) => (
                        <div
                          key={row.failureType}
                          className="flex items-center justify-between border-b border-white/5 py-1"
                        >
                          <span className="truncate text-slate-300">
                            {row.failureType}
                          </span>
                          <span className="font-mono text-slate-400">
                            {row.count}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );

  const shouldPortalToBody =
    isMaximized && isOpen && typeof document !== "undefined";

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          aria-label={
            isOpen ? "Close processing terminal" : "Open processing terminal"
          }
          className="glass-panel btn-interactive flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-sky-400"
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
          className="flex items-center gap-1 rounded-md bg-sky-500/20 px-2 py-1 text-[10px] font-medium text-sky-300 transition-all duration-150 hover:bg-sky-500/30 hover:scale-[1.04] active:scale-[0.97] disabled:opacity-40"
        >
          <Play
            size={9}
            className={isSyncing ? "animate-spin" : ""}
            aria-hidden="true"
          />
          {isSyncing ? "Syncing..." : "Sync"}
        </button>
      </div>

      {shouldPortalToBody ? createPortal(panel, document.body) : panel}
    </>
  );
}
