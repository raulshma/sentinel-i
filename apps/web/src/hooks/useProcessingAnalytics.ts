import { useCallback, useMemo, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export interface StageMetric {
  stage: string;
  startCount: number;
  successCount: number;
  warnCount: number;
  errorCount: number;
  avgDurationMs: number | null;
  p50DurationMs: number | null;
  p95DurationMs: number | null;
}

export interface ActivityBucket {
  bucketStart: string;
  totalEvents: number;
  successEvents: number;
  warnEvents: number;
  errorEvents: number;
  avgDurationMs: number | null;
}

export interface FailureTaxonomyItem {
  failureType: string;
  count: number;
}

export interface ProcessingAnalytics {
  windowHours: number;
  stageMetrics: StageMetric[];
  activitySeries: ActivityBucket[];
  failureTaxonomy: FailureTaxonomyItem[];
  aiUsage: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
  queueMetrics: {
    totalJobs: number;
    retryEvents: number;
    maxAttempt: number;
    failedJobs: number;
    successfulJobs: number;
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
