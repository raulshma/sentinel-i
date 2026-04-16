import { useCallback, useMemo, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export interface StageMetric {
  stage: string;
  totalEvents: number;
  startCount: number;
  successCount: number;
  warnCount: number;
  errorCount: number;
  successRate: number;
  warnRate: number;
  errorRate: number;
  avgDurationMs: number | null;
  p50DurationMs: number | null;
  p95DurationMs: number | null;
}

export interface ActivityBucket {
  bucketStart: string;
  totalEvents: number;
  startEvents: number;
  successEvents: number;
  warnEvents: number;
  errorEvents: number;
  traceCount: number;
  avgDurationMs: number | null;
}

export interface FailureTaxonomyItem {
  failureType: string;
  count: number;
}

export interface SummaryMetric {
  totalEvents: number;
  startEvents: number;
  successEvents: number;
  warnEvents: number;
  errorEvents: number;
  distinctTraces: number;
  distinctRuns: number;
  distinctJobs: number;
  distinctArticles: number;
  distinctSources: number;
  avgDurationMs: number | null;
  p95DurationMs: number | null;
  eventsPerMinute: number;
  eventsPerHour: number;
  successRate: number;
  warnRate: number;
  errorRate: number;
}

export interface SourceFailureHotspot {
  source: string;
  totalEvents: number;
  failureEvents: number;
  failureRate: number;
}

export interface AiProviderMetric {
  provider: string;
  count: number;
}

export interface AiToolMetric {
  toolName: string;
  callCount: number;
  successCount: number;
  failureCount: number;
  successRate: number;
}

export interface QueueAttemptHistogramBucket {
  attempt: number;
  count: number;
}

export interface ProcessingAnalytics {
  windowHours: number;
  windowStart: string;
  windowEnd: string;
  bucketUnit: "hour" | "day";
  summary: SummaryMetric;
  stageMetrics: StageMetric[];
  activitySeries: ActivityBucket[];
  failureTaxonomy: FailureTaxonomyItem[];
  sourceFailures: SourceFailureHotspot[];
  aiUsage: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    avgLatencyMs: number | null;
    p95LatencyMs: number | null;
    avgThroughputTokensPerSecond: number | null;
    providers: AiProviderMetric[];
    toolCalls: {
      total: number;
      success: number;
      warn: number;
      error: number;
      successRate: number;
    };
    toolBreakdown: AiToolMetric[];
  };
  queueMetrics: {
    totalJobs: number;
    retriedJobs: number;
    retryEvents: number;
    maxAttempt: number;
    failedJobs: number;
    successfulJobs: number;
    inFlightJobs: number;
    retryRate: number;
    successRate: number;
    failureRate: number;
    avgJobDurationMs: number | null;
    p95JobDurationMs: number | null;
    attemptHistogram: QueueAttemptHistogramBucket[];
  };
}

interface ProcessingAnalyticsResponse {
  data: ProcessingAnalytics;
  devToolsEnabled: boolean;
}

export const useProcessingAnalytics = () => {
  const [data, setData] = useState<ProcessingAnalytics | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [windowHours, setWindowHours] = useState(24);

  const fetchAnalytics = useCallback(
    async (hours = windowHours) => {
      const boundedHours = Math.max(1, Math.min(hours, 168));

      setWindowHours(boundedHours);
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `${API_BASE}/api/v1/processing/analytics?hours=${boundedHours}`,
        );

        if (!response.ok) {
          setData(null);
          setError(
            response.status === 404
              ? "Analytics is not available in this mode."
              : "Failed to load analytics",
          );
          return;
        }

        const payload = (await response.json()) as ProcessingAnalyticsResponse;
        setData(payload.data);
      } catch {
        setData(null);
        setError("Network error while loading analytics");
      } finally {
        setIsLoading(false);
      }
    },
    [windowHours],
  );

  return useMemo(
    () => ({
      data,
      isLoading,
      error,
      windowHours,
      fetchAnalytics,
    }),
    [data, isLoading, error, windowHours, fetchAnalytics],
  );
};
