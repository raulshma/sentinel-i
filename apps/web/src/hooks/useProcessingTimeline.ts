import { useCallback, useMemo, useState } from "react";

import type { ProcessingLogEntry } from "./useProcessingLogs";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export interface ProcessingTimelineQuery {
  limit?: number;
  hours?: number;
  traceId?: string;
  sourceUrl?: string;
  articleId?: string;
  runId?: string;
  jobId?: string;
}

export interface ProcessingTimelineGroup {
  groupId: string;
  traceId?: string;
  runId?: string;
  jobId?: string;
  articleId?: string;
  sourceUrl: string;
  headline: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number | null;
  eventCount: number;
  startCount: number;
  successCount: number;
  warnCount: number;
  errorCount: number;
  stages: string[];
  eventIds: string[];
}

interface ProcessingTimelineResponse {
  data: ProcessingLogEntry[];
  groups: ProcessingTimelineGroup[];
  meta: {
    count: number;
    groupCount: number;
    query: ProcessingTimelineQuery;
    devToolsEnabled: boolean;
  };
}

const buildQueryString = (query: ProcessingTimelineQuery): string => {
  const params = new URLSearchParams();

  if (query.limit != null) params.set("limit", String(query.limit));
  if (query.hours != null) params.set("hours", String(query.hours));
  if (query.traceId) params.set("traceId", query.traceId);
  if (query.sourceUrl) params.set("sourceUrl", query.sourceUrl);
  if (query.articleId) params.set("articleId", query.articleId);
  if (query.runId) params.set("runId", query.runId);
  if (query.jobId) params.set("jobId", query.jobId);

  const serialized = params.toString();
  return serialized.length > 0 ? `?${serialized}` : "";
};

export const useProcessingTimeline = () => {
  const [data, setData] = useState<ProcessingLogEntry[]>([]);
  const [groups, setGroups] = useState<ProcessingTimelineGroup[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState<ProcessingTimelineQuery>({
    limit: 1200,
    hours: 24,
  });

  const fetchTimeline = useCallback(
    async (query?: ProcessingTimelineQuery) => {
      const nextQuery = {
        ...lastQuery,
        ...(query ?? {}),
      };

      setLastQuery(nextQuery);
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `${API_BASE}/api/v1/processing/timeline${buildQueryString(nextQuery)}`,
        );

        if (!response.ok) {
          setData([]);
          setGroups([]);
          setError(
            response.status === 404
              ? "Timeline is not available in this mode."
              : "Failed to load timeline",
          );
          return;
        }

        const payload = (await response.json()) as ProcessingTimelineResponse;
        setData(payload.data);
        setGroups(payload.groups ?? []);
      } catch {
        setData([]);
        setGroups([]);
        setError("Network error while loading timeline");
      } finally {
        setIsLoading(false);
      }
    },
    [lastQuery],
  );

  return useMemo(
    () => ({
      data,
      groups,
      isLoading,
      error,
      lastQuery,
      fetchTimeline,
    }),
    [data, groups, isLoading, error, lastQuery, fetchTimeline],
  );
};
