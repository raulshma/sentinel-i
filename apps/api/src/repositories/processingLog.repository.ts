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

export interface FailureTaxonomyRow {
  failureType: string;
  count: number;
}

export interface ProcessingActivityBucket {
  bucketStart: string;
  totalEvents: number;
  startEvents: number;
  successEvents: number;
  warnEvents: number;
  errorEvents: number;
  traceCount: number;
  avgDurationMs: number | null;
}

export interface ProcessingSummaryMetrics {
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
  summary: ProcessingSummaryMetrics;
  stageMetrics: ProcessingStageAnalytics[];
  activitySeries: ProcessingActivityBucket[];
  failureTaxonomy: FailureTaxonomyRow[];
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

const roundTo = (value: number, decimals = 2): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const toRate = (numerator: number, denominator: number): number => {
  if (denominator <= 0) {
    return 0;
  }

  return roundTo((numerator / denominator) * 100, 2);
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
    const bucketUnit: "hour" | "day" = windowHours <= 72 ? "hour" : "day";
    const windowEndDate = new Date();
    const windowStartDate = new Date(
      windowEndDate.getTime() - windowHours * 60 * 60 * 1000,
    );
    const windowStart = windowStartDate.toISOString();
    const windowEnd = windowEndDate.toISOString();

    try {
      const [
        summaryResult,
        stageMetricsResult,
        activitySeriesResult,
        failureTaxonomyResult,
        sourceFailureResult,
        aiUsageResult,
        aiProviderResult,
        aiToolTotalsResult,
        aiToolBreakdownResult,
        queueMetricsResult,
        queueAttemptHistogramResult,
      ] = await Promise.all([
        getDb().execute(sql`
          SELECT
            COUNT(*)::int AS total_events,
            COUNT(*) FILTER (WHERE event_type = 'start')::int AS start_events,
            COUNT(*) FILTER (WHERE status = 'success')::int AS success_events,
            COUNT(*) FILTER (WHERE status = 'warn')::int AS warn_events,
            COUNT(*) FILTER (WHERE status = 'error')::int AS error_events,
            COUNT(DISTINCT trace_id)::int AS distinct_traces,
            COUNT(DISTINCT run_id)::int AS distinct_runs,
            COUNT(DISTINCT job_id)::int AS distinct_jobs,
            COUNT(DISTINCT article_id)::int AS distinct_articles,
            COUNT(DISTINCT source_url)::int AS distinct_sources,
            ROUND(AVG(duration_ms) FILTER (WHERE duration_ms IS NOT NULL))::int AS avg_duration_ms,
            ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE duration_ms IS NOT NULL))::int AS p95_duration_ms
          FROM ${processingLogs}
          WHERE created_at >= NOW() - make_interval(hours => ${windowHours}::int)
        `),
        getDb().execute(sql`
          SELECT
            stage,
            COUNT(*)::int AS total_events,
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
            COUNT(*) FILTER (WHERE event_type = 'start')::int AS start_events,
            COUNT(*) FILTER (WHERE status = 'success')::int AS success_events,
            COUNT(*) FILTER (WHERE status = 'warn')::int AS warn_events,
            COUNT(*) FILTER (WHERE status = 'error')::int AS error_events,
            COUNT(DISTINCT trace_id)::int AS trace_count,
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
            CASE
              WHEN source_url ~* '^https?://' THEN split_part(split_part(source_url, '://', 2), '/', 1)
              ELSE source_url
            END AS source,
            COUNT(*)::int AS total_events,
            COUNT(*) FILTER (WHERE status IN ('warn', 'error'))::int AS failure_events
          FROM ${processingLogs}
          WHERE created_at >= NOW() - make_interval(hours => ${windowHours}::int)
          GROUP BY source
          HAVING COUNT(*) FILTER (WHERE status IN ('warn', 'error')) > 0
          ORDER BY failure_events DESC, total_events DESC, source ASC
          LIMIT 15
        `),
        getDb().execute(sql`
          SELECT
            SUM(CASE WHEN metadata->>'inputTokens' ~ '^[0-9]+$' THEN (metadata->>'inputTokens')::bigint ELSE 0 END)::bigint AS input_tokens,
            SUM(CASE WHEN metadata->>'outputTokens' ~ '^[0-9]+$' THEN (metadata->>'outputTokens')::bigint ELSE 0 END)::bigint AS output_tokens,
            SUM(CASE WHEN metadata->>'reasoningTokens' ~ '^[0-9]+$' THEN (metadata->>'reasoningTokens')::bigint ELSE 0 END)::bigint AS reasoning_tokens,
            SUM(CASE WHEN metadata->>'totalTokens' ~ '^[0-9]+$' THEN (metadata->>'totalTokens')::bigint ELSE 0 END)::bigint AS total_tokens,
            SUM(CASE WHEN metadata->>'estimatedCostUsd' ~ '^[0-9]+(\\.[0-9]+)?$' THEN (metadata->>'estimatedCostUsd')::numeric ELSE 0 END)::text AS estimated_cost_usd,
            ROUND(AVG(duration_ms) FILTER (WHERE duration_ms IS NOT NULL))::int AS avg_latency_ms,
            ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE duration_ms IS NOT NULL))::int AS p95_latency_ms,
            ROUND(AVG(CASE WHEN metadata->>'throughputTokensPerSecond' ~ '^[0-9]+(\\.[0-9]+)?$' THEN (metadata->>'throughputTokensPerSecond')::numeric ELSE NULL END))::int AS avg_throughput_tps
          FROM ${processingLogs}
          WHERE created_at >= NOW() - make_interval(hours => ${windowHours}::int)
            AND stage = 'ai_processing'
            AND status = 'success'
            AND event_type = 'end'
            AND metadata ? 'totalTokens'
        `),
        getDb().execute(sql`
          SELECT
            provider,
            COUNT(*)::int AS count
          FROM (
            SELECT
              COALESCE(
                NULLIF(metadata->>'provider', ''),
                NULLIF(metadata->>'providerName', ''),
                (
                  SELECT key
                  FROM jsonb_object_keys(COALESCE(metadata->'providerMetadata', '{}'::jsonb)) AS key
                  LIMIT 1
                ),
                'unknown'
              ) AS provider
            FROM ${processingLogs}
            WHERE created_at >= NOW() - make_interval(hours => ${windowHours}::int)
              AND stage = 'ai_processing'
              AND status = 'success'
              AND event_type = 'end'
              AND metadata ? 'totalTokens'
          ) providers
          GROUP BY provider
          ORDER BY count DESC, provider ASC
          LIMIT 8
        `),
        getDb().execute(sql`
          SELECT
            COUNT(*) FILTER (WHERE event_type = 'start')::int AS total_calls,
            COUNT(*) FILTER (WHERE status = 'success')::int AS success_calls,
            COUNT(*) FILTER (WHERE status = 'warn')::int AS warn_calls,
            COUNT(*) FILTER (WHERE status = 'error')::int AS error_calls
          FROM ${processingLogs}
          WHERE created_at >= NOW() - make_interval(hours => ${windowHours}::int)
            AND stage = 'ai_tool_call'
        `),
        getDb().execute(sql`
          SELECT
            COALESCE(metadata->>'toolName', 'unknown') AS tool_name,
            COUNT(*) FILTER (WHERE event_type = 'start')::int AS call_count,
            COUNT(*) FILTER (WHERE status = 'success')::int AS success_count,
            COUNT(*) FILTER (WHERE status IN ('warn', 'error'))::int AS failure_count
          FROM ${processingLogs}
          WHERE created_at >= NOW() - make_interval(hours => ${windowHours}::int)
            AND stage = 'ai_tool_call'
          GROUP BY tool_name
          ORDER BY call_count DESC, tool_name ASC
          LIMIT 15
        `),
        getDb().execute(sql`
          WITH queue_events AS (
            SELECT
              id,
              job_id,
              status,
              attempt,
              duration_ms,
              event_type,
              created_at,
              ROW_NUMBER() OVER (
                PARTITION BY job_id
                ORDER BY created_at DESC, id DESC
              ) AS rn
            FROM ${processingLogs}
            WHERE created_at >= NOW() - make_interval(hours => ${windowHours}::int)
              AND stage = 'queue'
              AND job_id IS NOT NULL
          ),
          job_stats AS (
            SELECT
              job_id,
              COALESCE(MAX(attempt), 1)::int AS max_attempt,
              MAX(CASE WHEN rn = 1 THEN status END) AS final_status,
              MAX(duration_ms) FILTER (
                WHERE event_type IN ('end', 'error')
                  AND duration_ms IS NOT NULL
              ) AS terminal_duration_ms
            FROM queue_events
            GROUP BY job_id
          )
          SELECT
            COUNT(*)::int AS total_jobs,
            COUNT(*) FILTER (WHERE max_attempt > 1)::int AS retried_jobs,
            COALESCE(SUM(GREATEST(max_attempt - 1, 0)), 0)::int AS retry_events,
            COALESCE(MAX(max_attempt), 0)::int AS max_attempt,
            COUNT(*) FILTER (WHERE final_status = 'error')::int AS failed_jobs,
            COUNT(*) FILTER (WHERE final_status = 'success')::int AS successful_jobs,
            COUNT(*) FILTER (WHERE final_status = 'start')::int AS in_flight_jobs,
            ROUND(AVG(terminal_duration_ms) FILTER (WHERE terminal_duration_ms IS NOT NULL))::int AS avg_job_duration_ms,
            ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY terminal_duration_ms) FILTER (WHERE terminal_duration_ms IS NOT NULL))::int AS p95_job_duration_ms
          FROM job_stats
        `),
        getDb().execute(sql`
          WITH queue_jobs AS (
            SELECT
              job_id,
              COALESCE(MAX(attempt), 1)::int AS max_attempt
            FROM ${processingLogs}
            WHERE created_at >= NOW() - make_interval(hours => ${windowHours}::int)
              AND stage = 'queue'
              AND job_id IS NOT NULL
            GROUP BY job_id
          )
          SELECT
            max_attempt AS attempt,
            COUNT(*)::int AS count
          FROM queue_jobs
          GROUP BY max_attempt
          ORDER BY max_attempt ASC
          LIMIT 12
        `),
      ]);

      const summaryRow = summaryResult.rows[0];
      const totalEvents = toNumber(summaryRow?.total_events);
      const successEvents = toNumber(summaryRow?.success_events);
      const warnEvents = toNumber(summaryRow?.warn_events);
      const errorEvents = toNumber(summaryRow?.error_events);

      const summary: ProcessingSummaryMetrics = {
        totalEvents,
        startEvents: toNumber(summaryRow?.start_events),
        successEvents,
        warnEvents,
        errorEvents,
        distinctTraces: toNumber(summaryRow?.distinct_traces),
        distinctRuns: toNumber(summaryRow?.distinct_runs),
        distinctJobs: toNumber(summaryRow?.distinct_jobs),
        distinctArticles: toNumber(summaryRow?.distinct_articles),
        distinctSources: toNumber(summaryRow?.distinct_sources),
        avgDurationMs:
          summaryRow?.avg_duration_ms == null
            ? null
            : toNumber(summaryRow.avg_duration_ms),
        p95DurationMs:
          summaryRow?.p95_duration_ms == null
            ? null
            : toNumber(summaryRow.p95_duration_ms),
        eventsPerMinute: roundTo(
          totalEvents / Math.max(windowHours * 60, 1),
          2,
        ),
        eventsPerHour: roundTo(totalEvents / Math.max(windowHours, 1), 2),
        successRate: toRate(successEvents, totalEvents),
        warnRate: toRate(warnEvents, totalEvents),
        errorRate: toRate(errorEvents, totalEvents),
      };

      const stageMetrics: ProcessingStageAnalytics[] =
        stageMetricsResult.rows.map((row) => {
          const stageTotal = toNumber(row.total_events);
          const stageSuccess = toNumber(row.success_count);
          const stageWarn = toNumber(row.warn_count);
          const stageError = toNumber(row.error_count);

          return {
            stage: String(row.stage),
            totalEvents: stageTotal,
            startCount: toNumber(row.start_count),
            successCount: stageSuccess,
            warnCount: stageWarn,
            errorCount: stageError,
            successRate: toRate(stageSuccess, stageTotal),
            warnRate: toRate(stageWarn, stageTotal),
            errorRate: toRate(stageError, stageTotal),
            avgDurationMs:
              row.avg_duration_ms == null
                ? null
                : toNumber(row.avg_duration_ms),
            p50DurationMs:
              row.p50_duration_ms == null
                ? null
                : toNumber(row.p50_duration_ms),
            p95DurationMs:
              row.p95_duration_ms == null
                ? null
                : toNumber(row.p95_duration_ms),
          };
        });

      const activitySeries: ProcessingActivityBucket[] =
        activitySeriesResult.rows.map((row) => ({
          bucketStart: toIsoString(row.bucket_start),
          totalEvents: toNumber(row.total_events),
          startEvents: toNumber(row.start_events),
          successEvents: toNumber(row.success_events),
          warnEvents: toNumber(row.warn_events),
          errorEvents: toNumber(row.error_events),
          traceCount: toNumber(row.trace_count),
          avgDurationMs:
            row.avg_duration_ms == null ? null : toNumber(row.avg_duration_ms),
        }));

      const failureTaxonomy: FailureTaxonomyRow[] =
        failureTaxonomyResult.rows.map((row) => ({
          failureType: String(row.failure_type),
          count: toNumber(row.count),
        }));

      const sourceFailures: SourceFailureHotspot[] =
        sourceFailureResult.rows.map((row) => {
          const sourceTotal = toNumber(row.total_events);
          const sourceFailuresCount = toNumber(row.failure_events);

          return {
            source: String(row.source),
            totalEvents: sourceTotal,
            failureEvents: sourceFailuresCount,
            failureRate: toRate(sourceFailuresCount, sourceTotal),
          };
        });

      const aiUsageRow = aiUsageResult.rows[0];
      const aiProviders: AiProviderMetric[] = aiProviderResult.rows.map(
        (row) => ({
          provider: String(row.provider),
          count: toNumber(row.count),
        }),
      );

      const aiToolTotalsRow = aiToolTotalsResult.rows[0];
      const aiToolTotal = toNumber(aiToolTotalsRow?.total_calls);
      const aiToolSuccess = toNumber(aiToolTotalsRow?.success_calls);
      const aiToolWarn = toNumber(aiToolTotalsRow?.warn_calls);
      const aiToolError = toNumber(aiToolTotalsRow?.error_calls);

      const aiToolBreakdown: AiToolMetric[] = aiToolBreakdownResult.rows.map(
        (row) => {
          const callCount = toNumber(row.call_count);
          const successCount = toNumber(row.success_count);

          return {
            toolName: String(row.tool_name),
            callCount,
            successCount,
            failureCount: toNumber(row.failure_count),
            successRate: toRate(successCount, callCount),
          };
        },
      );

      const queueMetricsRow = queueMetricsResult.rows[0];
      const queueTotalJobs = toNumber(queueMetricsRow?.total_jobs);
      const queueRetriedJobs = toNumber(queueMetricsRow?.retried_jobs);
      const queueSuccessfulJobs = toNumber(queueMetricsRow?.successful_jobs);
      const queueFailedJobs = toNumber(queueMetricsRow?.failed_jobs);
      const queueAttemptHistogram: QueueAttemptHistogramBucket[] =
        queueAttemptHistogramResult.rows.map((row) => ({
          attempt: toNumber(row.attempt),
          count: toNumber(row.count),
        }));

      return {
        windowHours,
        windowStart,
        windowEnd,
        bucketUnit,
        summary,
        stageMetrics,
        activitySeries,
        failureTaxonomy,
        sourceFailures,
        aiUsage: {
          inputTokens: toNumber(aiUsageRow?.input_tokens),
          outputTokens: toNumber(aiUsageRow?.output_tokens),
          reasoningTokens: toNumber(aiUsageRow?.reasoning_tokens),
          totalTokens: toNumber(aiUsageRow?.total_tokens),
          estimatedCostUsd: toNumber(aiUsageRow?.estimated_cost_usd),
          avgLatencyMs:
            aiUsageRow?.avg_latency_ms == null
              ? null
              : toNumber(aiUsageRow.avg_latency_ms),
          p95LatencyMs:
            aiUsageRow?.p95_latency_ms == null
              ? null
              : toNumber(aiUsageRow.p95_latency_ms),
          avgThroughputTokensPerSecond:
            aiUsageRow?.avg_throughput_tps == null
              ? null
              : toNumber(aiUsageRow.avg_throughput_tps),
          providers: aiProviders,
          toolCalls: {
            total: aiToolTotal,
            success: aiToolSuccess,
            warn: aiToolWarn,
            error: aiToolError,
            successRate: toRate(aiToolSuccess, aiToolTotal),
          },
          toolBreakdown: aiToolBreakdown,
        },
        queueMetrics: {
          totalJobs: queueTotalJobs,
          retriedJobs: queueRetriedJobs,
          retryEvents: toNumber(queueMetricsRow?.retry_events),
          maxAttempt: toNumber(queueMetricsRow?.max_attempt),
          failedJobs: queueFailedJobs,
          successfulJobs: queueSuccessfulJobs,
          inFlightJobs: toNumber(queueMetricsRow?.in_flight_jobs),
          retryRate: toRate(queueRetriedJobs, queueTotalJobs),
          successRate: toRate(queueSuccessfulJobs, queueTotalJobs),
          failureRate: toRate(queueFailedJobs, queueTotalJobs),
          avgJobDurationMs:
            queueMetricsRow?.avg_job_duration_ms == null
              ? null
              : toNumber(queueMetricsRow.avg_job_duration_ms),
          p95JobDurationMs:
            queueMetricsRow?.p95_job_duration_ms == null
              ? null
              : toNumber(queueMetricsRow.p95_job_duration_ms),
          attemptHistogram: queueAttemptHistogram,
        },
      };
    } catch (error) {
      logger.warn(
        { error, windowHours },
        "Failed to compute processing analytics",
      );
      return {
        windowHours,
        windowStart,
        windowEnd,
        bucketUnit,
        summary: {
          totalEvents: 0,
          startEvents: 0,
          successEvents: 0,
          warnEvents: 0,
          errorEvents: 0,
          distinctTraces: 0,
          distinctRuns: 0,
          distinctJobs: 0,
          distinctArticles: 0,
          distinctSources: 0,
          avgDurationMs: null,
          p95DurationMs: null,
          eventsPerMinute: 0,
          eventsPerHour: 0,
          successRate: 0,
          warnRate: 0,
          errorRate: 0,
        },
        stageMetrics: [],
        activitySeries: [],
        failureTaxonomy: [],
        sourceFailures: [],
        aiUsage: {
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          totalTokens: 0,
          estimatedCostUsd: 0,
          avgLatencyMs: null,
          p95LatencyMs: null,
          avgThroughputTokensPerSecond: null,
          providers: [],
          toolCalls: {
            total: 0,
            success: 0,
            warn: 0,
            error: 0,
            successRate: 0,
          },
          toolBreakdown: [],
        },
        queueMetrics: {
          totalJobs: 0,
          retriedJobs: 0,
          retryEvents: 0,
          maxAttempt: 0,
          failedJobs: 0,
          successfulJobs: 0,
          inFlightJobs: 0,
          retryRate: 0,
          successRate: 0,
          failureRate: 0,
          avgJobDurationMs: null,
          p95JobDurationMs: null,
          attemptHistogram: [],
        },
      };
    }
  }
}

export const processingLogRepository = new ProcessingLogRepository();
