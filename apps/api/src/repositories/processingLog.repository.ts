import { and, asc, desc, eq, gte, sql } from "drizzle-orm";

import { getDb } from "../config/db.js";
import { logger } from "../config/logger.js";
import { processingLogs } from "../db/schema.js";
import type { ProcessingLogEntry } from "../services/processingEventBus.js";

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

export interface ProcessingTimelineResult {
  events: ProcessingLogEntry[];
  groups: ProcessingTimelineGroup[];
}

export interface ProcessingStageAnalytics {
  stage: string;
  startCount: number;
  successCount: number;
  warnCount: number;
  errorCount: number;
  avgDurationMs: number | null;
  p50DurationMs: number | null;
  p95DurationMs: number | null;
}

export interface FailureTaxonomyRow {
  failureType: string;
  count: number;
}

export interface ProcessingActivityBucket {
  bucketStart: string;
  totalEvents: number;
  successEvents: number;
  warnEvents: number;
  errorEvents: number;
  avgDurationMs: number | null;
}

export interface ProcessingAnalytics {
  windowHours: number;
  stageMetrics: ProcessingStageAnalytics[];
  activitySeries: ProcessingActivityBucket[];
  failureTaxonomy: FailureTaxonomyRow[];
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

const toNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
};

const toIsoString = (value: unknown): string => {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? new Date().toISOString()
      : date.toISOString();
  }

  return new Date().toISOString();
};

const resolveTimelineGroupKey = (entry: ProcessingLogEntry): string => {
  if (entry.traceId) {
    return `trace:${entry.traceId}`;
  }

  if (entry.articleId) {
    return `article:${entry.articleId}`;
  }

  if (entry.jobId) {
    return `job:${entry.jobId}`;
  }

  if (entry.runId) {
    return `run:${entry.runId}`;
  }

  return `source:${entry.sourceUrl}`;
};

const buildTimelineGroups = (
  events: ProcessingLogEntry[],
): ProcessingTimelineGroup[] => {
  const groupMap = new Map<string, ProcessingTimelineGroup>();

  for (const event of events) {
    const groupId = resolveTimelineGroupKey(event);
    const createdAt = toIsoString(event.createdAt);
    const eventId = event.id ?? `${groupId}-${createdAt}`;

    const existing = groupMap.get(groupId);

    if (!existing) {
      groupMap.set(groupId, {
        groupId,
        traceId: event.traceId,
        runId: event.runId,
        jobId: event.jobId,
        articleId: event.articleId,
        sourceUrl: event.sourceUrl,
        headline: event.headline,
        startedAt: createdAt,
        finishedAt: createdAt,
        durationMs: event.durationMs ?? null,
        eventCount: 1,
        startCount: event.status === "start" ? 1 : 0,
        successCount: event.status === "success" ? 1 : 0,
        warnCount: event.status === "warn" ? 1 : 0,
        errorCount: event.status === "error" ? 1 : 0,
        stages: [event.stage],
        eventIds: [eventId],
      });

      continue;
    }

    if (createdAt < existing.startedAt) {
      existing.startedAt = createdAt;
    }

    if (createdAt > existing.finishedAt) {
      existing.finishedAt = createdAt;
    }

    if (!existing.headline && event.headline) {
      existing.headline = event.headline;
    }

    if (!existing.traceId && event.traceId) {
      existing.traceId = event.traceId;
    }

    if (!existing.runId && event.runId) {
      existing.runId = event.runId;
    }

    if (!existing.jobId && event.jobId) {
      existing.jobId = event.jobId;
    }

    if (!existing.articleId && event.articleId) {
      existing.articleId = event.articleId;
    }

    if (event.durationMs != null) {
      existing.durationMs = (existing.durationMs ?? 0) + event.durationMs;
    }

    existing.eventCount += 1;
    if (event.status === "start") existing.startCount += 1;
    if (event.status === "success") existing.successCount += 1;
    if (event.status === "warn") existing.warnCount += 1;
    if (event.status === "error") existing.errorCount += 1;

    if (!existing.stages.includes(event.stage)) {
      existing.stages.push(event.stage);
    }

    existing.eventIds.push(eventId);
  }

  return [...groupMap.values()].sort((a, b) =>
    b.finishedAt.localeCompare(a.finishedAt),
  );
};

export class ProcessingLogRepository {
  async findRecent(limit = 200): Promise<ProcessingLogEntry[]> {
    try {
      const result = await getDb()
        .select()
        .from(processingLogs)
        .orderBy(desc(processingLogs.createdAt))
        .limit(limit);

      return result
        .map(
          (row): ProcessingLogEntry => ({
            id: String(row.id),
            runId: row.runId ?? undefined,
            jobId: row.jobId ?? undefined,
            traceId: row.traceId ?? undefined,
            articleId: row.articleId ?? undefined,
            sourceUrl: row.sourceUrl,
            feedUrl: row.feedUrl ?? undefined,
            eventType:
              (row.eventType as ProcessingLogEntry["eventType"]) ??
              "checkpoint",
            durationMs: row.durationMs ?? undefined,
            attempt: row.attempt ?? undefined,
            headline: row.headline,
            stage: row.stage as ProcessingLogEntry["stage"],
            message: row.message,
            status: row.status as ProcessingLogEntry["status"],
            streamId: row.streamId ?? undefined,
            isStreaming: row.isStreaming,
            metadata: (row.metadata as Record<string, unknown>) ?? {},
            createdAt: row.createdAt.toISOString(),
          }),
        )
        .reverse();
    } catch (error) {
      logger.warn({ error }, "Failed to fetch recent processing logs");
      return [];
    }
  }

  async findTimeline(
    query: ProcessingTimelineQuery,
  ): Promise<ProcessingTimelineResult> {
    try {
      const limit = Math.min(Math.max(query.limit ?? 800, 1), 2000);
      const hours = Math.min(Math.max(query.hours ?? 24, 1), 168);

      const conditions = [
        gte(
          processingLogs.createdAt,
          sql`NOW() - make_interval(hours => ${hours}::int)`,
        ),
      ];

      if (query.traceId) {
        conditions.push(eq(processingLogs.traceId, query.traceId));
      }

      if (query.sourceUrl) {
        conditions.push(eq(processingLogs.sourceUrl, query.sourceUrl));
      }

      if (query.articleId) {
        conditions.push(eq(processingLogs.articleId, query.articleId));
      }

      if (query.runId) {
        conditions.push(eq(processingLogs.runId, query.runId));
      }

      if (query.jobId) {
        conditions.push(eq(processingLogs.jobId, query.jobId));
      }

      const result = await getDb()
        .select()
        .from(processingLogs)
        .where(and(...conditions))
        .orderBy(asc(processingLogs.createdAt), asc(processingLogs.id))
        .limit(limit);

      const events = result.map(
        (row): ProcessingLogEntry => ({
          id: String(row.id),
          runId: row.runId ?? undefined,
          jobId: row.jobId ?? undefined,
          traceId: row.traceId ?? undefined,
          articleId: row.articleId ?? undefined,
          sourceUrl: row.sourceUrl,
          feedUrl: row.feedUrl ?? undefined,
          eventType:
            (row.eventType as ProcessingLogEntry["eventType"]) ?? "checkpoint",
          durationMs: row.durationMs ?? undefined,
          attempt: row.attempt ?? undefined,
          headline: row.headline,
          stage: row.stage as ProcessingLogEntry["stage"],
          message: row.message,
          status: row.status as ProcessingLogEntry["status"],
          streamId: row.streamId ?? undefined,
          isStreaming: row.isStreaming,
          metadata: (row.metadata as Record<string, unknown>) ?? {},
          createdAt: row.createdAt.toISOString(),
        }),
      );

      return {
        events,
        groups: buildTimelineGroups(events),
      };
    } catch (error) {
      logger.warn({ error, query }, "Failed to fetch processing timeline");
      return {
        events: [],
        groups: [],
      };
    }
  }

  async getAnalytics(hours = 24): Promise<ProcessingAnalytics> {
    const windowHours = Math.min(Math.max(hours, 1), 168);
    const bucketUnit = windowHours <= 72 ? "hour" : "day";

    try {
      const [
        stageMetricsResult,
        activitySeriesResult,
        failureTaxonomyResult,
        aiUsageResult,
        queueMetricsResult,
      ] = await Promise.all([
        getDb().execute(sql`
          SELECT
            stage,
            COUNT(*) FILTER (WHERE event_type = 'start')::int AS start_count,
            COUNT(*) FILTER (WHERE status = 'success')::int AS success_count,
            COUNT(*) FILTER (WHERE status = 'warn')::int AS warn_count,
            COUNT(*) FILTER (WHERE status = 'error')::int AS error_count,
            ROUND(AVG(duration_ms) FILTER (WHERE duration_ms IS NOT NULL))::int AS avg_duration_ms,
            ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE duration_ms IS NOT NULL))::int AS p50_duration_ms,
            ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE duration_ms IS NOT NULL))::int AS p95_duration_ms
          FROM ${processingLogs}
          WHERE created_at >= NOW() - make_interval(hours => ${windowHours}::int)
            AND stage IN ('queue', 'feed_fetch', 'feed_parse', 'deduplication', 'content_fetch', 'content_parse', 'ai_processing', 'ai_tool_call', 'ai_reasoning', 'geocoding', 'fact_check', 'storage', 'complete', 'error')
          GROUP BY stage
          ORDER BY stage ASC
        `),
        getDb().execute(sql`
          SELECT
            date_trunc(${bucketUnit}, created_at) AS bucket_start,
            COUNT(*)::int AS total_events,
            COUNT(*) FILTER (WHERE status = 'success')::int AS success_events,
            COUNT(*) FILTER (WHERE status = 'warn')::int AS warn_events,
            COUNT(*) FILTER (WHERE status = 'error')::int AS error_events,
            ROUND(AVG(duration_ms) FILTER (WHERE duration_ms IS NOT NULL))::int AS avg_duration_ms
          FROM ${processingLogs}
          WHERE created_at >= NOW() - make_interval(hours => ${windowHours}::int)
          GROUP BY bucket_start
          ORDER BY bucket_start ASC
        `),
        getDb().execute(sql`
          SELECT
            COALESCE(metadata->>'failureType', metadata->>'reason', stage, 'unknown') AS failure_type,
            COUNT(*)::int AS count
          FROM ${processingLogs}
          WHERE created_at >= NOW() - make_interval(hours => ${windowHours}::int)
            AND status IN ('warn', 'error')
          GROUP BY failure_type
          ORDER BY count DESC, failure_type ASC
          LIMIT 20
        `),
        getDb().execute(sql`
          SELECT
            SUM(CASE WHEN metadata->>'inputTokens' ~ '^[0-9]+$' THEN (metadata->>'inputTokens')::bigint ELSE 0 END)::bigint AS input_tokens,
            SUM(CASE WHEN metadata->>'outputTokens' ~ '^[0-9]+$' THEN (metadata->>'outputTokens')::bigint ELSE 0 END)::bigint AS output_tokens,
            SUM(CASE WHEN metadata->>'reasoningTokens' ~ '^[0-9]+$' THEN (metadata->>'reasoningTokens')::bigint ELSE 0 END)::bigint AS reasoning_tokens,
            SUM(CASE WHEN metadata->>'totalTokens' ~ '^[0-9]+$' THEN (metadata->>'totalTokens')::bigint ELSE 0 END)::bigint AS total_tokens,
            SUM(CASE WHEN metadata->>'estimatedCostUsd' ~ '^[0-9]+(\\.[0-9]+)?$' THEN (metadata->>'estimatedCostUsd')::numeric ELSE 0 END)::text AS estimated_cost_usd
          FROM ${processingLogs}
          WHERE created_at >= NOW() - make_interval(hours => ${windowHours}::int)
            AND stage = 'ai_processing'
            AND status = 'success'
        `),
        getDb().execute(sql`
          WITH queue_events AS (
            SELECT job_id, status, attempt
            FROM ${processingLogs}
            WHERE created_at >= NOW() - make_interval(hours => ${windowHours}::int)
              AND stage = 'queue'
              AND job_id IS NOT NULL
          )
          SELECT
            COUNT(DISTINCT job_id)::int AS total_jobs,
            COUNT(*) FILTER (WHERE attempt > 1)::int AS retry_events,
            COALESCE(MAX(attempt), 0)::int AS max_attempt,
            COUNT(DISTINCT CASE WHEN status = 'error' THEN job_id END)::int AS failed_jobs,
            COUNT(DISTINCT CASE WHEN status = 'success' THEN job_id END)::int AS successful_jobs
          FROM queue_events
        `),
      ]);

      const stageMetrics: ProcessingStageAnalytics[] =
        stageMetricsResult.rows.map((row) => ({
          stage: String(row.stage),
          startCount: toNumber(row.start_count),
          successCount: toNumber(row.success_count),
          warnCount: toNumber(row.warn_count),
          errorCount: toNumber(row.error_count),
          avgDurationMs:
            row.avg_duration_ms == null ? null : toNumber(row.avg_duration_ms),
          p50DurationMs:
            row.p50_duration_ms == null ? null : toNumber(row.p50_duration_ms),
          p95DurationMs:
            row.p95_duration_ms == null ? null : toNumber(row.p95_duration_ms),
        }));

      const activitySeries: ProcessingActivityBucket[] =
        activitySeriesResult.rows.map((row) => ({
          bucketStart: toIsoString(row.bucket_start),
          totalEvents: toNumber(row.total_events),
          successEvents: toNumber(row.success_events),
          warnEvents: toNumber(row.warn_events),
          errorEvents: toNumber(row.error_events),
          avgDurationMs:
            row.avg_duration_ms == null ? null : toNumber(row.avg_duration_ms),
        }));

      const failureTaxonomy: FailureTaxonomyRow[] =
        failureTaxonomyResult.rows.map((row) => ({
          failureType: String(row.failure_type),
          count: toNumber(row.count),
        }));

      const aiUsageRow = aiUsageResult.rows[0];
      const queueMetricsRow = queueMetricsResult.rows[0];

      return {
        windowHours,
        stageMetrics,
        activitySeries,
        failureTaxonomy,
        aiUsage: {
          inputTokens: toNumber(aiUsageRow?.input_tokens),
          outputTokens: toNumber(aiUsageRow?.output_tokens),
          reasoningTokens: toNumber(aiUsageRow?.reasoning_tokens),
          totalTokens: toNumber(aiUsageRow?.total_tokens),
          estimatedCostUsd: toNumber(aiUsageRow?.estimated_cost_usd),
        },
        queueMetrics: {
          totalJobs: toNumber(queueMetricsRow?.total_jobs),
          retryEvents: toNumber(queueMetricsRow?.retry_events),
          maxAttempt: toNumber(queueMetricsRow?.max_attempt),
          failedJobs: toNumber(queueMetricsRow?.failed_jobs),
          successfulJobs: toNumber(queueMetricsRow?.successful_jobs),
        },
      };
    } catch (error) {
      logger.warn(
        { error, windowHours },
        "Failed to compute processing analytics",
      );
      return {
        windowHours,
        stageMetrics: [],
        activitySeries: [],
        failureTaxonomy: [],
        aiUsage: {
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          totalTokens: 0,
          estimatedCostUsd: 0,
        },
        queueMetrics: {
          totalJobs: 0,
          retryEvents: 0,
          maxAttempt: 0,
          failedJobs: 0,
          successfulJobs: 0,
        },
      };
    }
  }
}

export const processingLogRepository = new ProcessingLogRepository();
