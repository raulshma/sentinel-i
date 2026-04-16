import { EventEmitter } from "node:events";

import { getDb } from "../config/db.js";
import { logger } from "../config/logger.js";
import { processingLogs } from "../db/schema.js";
import type { ProcessingEventType } from "../types/processing.js";

export type ProcessingStage =
  | "queue"
  | "feed_fetch"
  | "feed_parse"
  | "deduplication"
  | "content_fetch"
  | "content_parse"
  | "ai_processing"
  | "ai_tool_call"
  | "ai_reasoning"
  | "geocoding"
  | "fact_check"
  | "storage"
  | "complete"
  | "error";

export type ProcessingStatus = "info" | "success" | "warn" | "error" | "start";

export interface ProcessingLogEntry {
  id?: string;
  runId?: string;
  jobId?: string;
  traceId?: string;
  articleId?: string;
  sourceUrl: string;
  feedUrl?: string;
  eventType?: ProcessingEventType;
  durationMs?: number;
  attempt?: number;
  headline: string | null;
  stage: ProcessingStage;
  message: string;
  status: ProcessingStatus;
  metadata?: Record<string, unknown>;
  streamId?: string;
  isStreaming?: boolean;
  createdAt: string;
}

export interface ProcessingEventBusShutdownOptions {
  drainTimeoutMs?: number;
}

class ProcessingEventBus extends EventEmitter {
  private static readonly FLUSH_INTERVAL_MS = 120;
  private static readonly MAX_BATCH_SIZE = 300;
  private static readonly MAX_QUEUE_SIZE = 12_000;
  private static readonly MAX_FLUSH_RETRIES = 3;
  private static readonly FLUSH_RETRY_BASE_DELAY_MS = 300;
  private static readonly FLUSH_RETRY_MAX_DELAY_MS = 5_000;
  private static readonly SHUTDOWN_POLL_INTERVAL_MS = 25;

  private queue: ProcessingLogEntry[] = [];
  private flushing = false;
  private flushTimer: NodeJS.Timeout | null = null;
  private droppedEvents = 0;
  private flushFailureCount = 0;
  private shuttingDown = false;
  private shutdownPromise: Promise<void> | null = null;

  constructor() {
    super();
    this.setMaxListeners(50);
  }

  emitLog(entry: Omit<ProcessingLogEntry, "createdAt">): void {
    const fullEntry: ProcessingLogEntry = {
      ...entry,
      eventType: entry.eventType ?? "checkpoint",
      createdAt: new Date().toISOString(),
    };

    const shouldPersist = this.shouldPersist(fullEntry);
    const shouldPublishRealtime = this.listenerCount("log") > 0;

    if (!shouldPersist && !shouldPublishRealtime) {
      return;
    }

    if (shouldPersist) {
      this.queue.push(fullEntry);
      this.ensureQueueCapacity();
      this.scheduleFlush();
    }

    if (shouldPublishRealtime) {
      this.emit("log", fullEntry);
    }
  }

  private shouldPersist(entry: ProcessingLogEntry): boolean {
    return !(entry.stage === "ai_reasoning" && entry.isStreaming === true);
  }

  private ensureQueueCapacity(): void {
    if (this.queue.length <= ProcessingEventBus.MAX_QUEUE_SIZE) {
      return;
    }

    const overflow = this.queue.length - ProcessingEventBus.MAX_QUEUE_SIZE;
    this.queue.splice(0, overflow);
    this.droppedEvents += overflow;
  }

  private scheduleFlush(): void {
    if (this.flushing || this.queue.length === 0) {
      return;
    }

    const delayMs = this.shuttingDown
      ? 0
      : ProcessingEventBus.FLUSH_INTERVAL_MS;

    if (
      this.queue.length >= ProcessingEventBus.MAX_BATCH_SIZE ||
      delayMs <= 0
    ) {
      void this.flush();
      return;
    }

    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, delayMs);
    this.flushTimer.unref?.();
  }

  private getRetryDelayMs(attempt: number): number {
    const exponential =
      ProcessingEventBus.FLUSH_RETRY_BASE_DELAY_MS *
      2 ** Math.max(attempt - 1, 0);

    return Math.min(exponential, ProcessingEventBus.FLUSH_RETRY_MAX_DELAY_MS);
  }

  private scheduleRetryFlush(attempt: number): void {
    if (this.flushing || this.queue.length === 0 || this.flushTimer) {
      return;
    }

    const retryDelayMs = this.shuttingDown ? 0 : this.getRetryDelayMs(attempt);

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, retryDelayMs);
    this.flushTimer.unref?.();
  }

  private mapToDbRows(batch: ProcessingLogEntry[]) {
    return batch.map((e) => ({
      runId: e.runId,
      jobId: e.jobId,
      traceId: e.traceId,
      articleId: e.articleId,
      sourceUrl: e.sourceUrl,
      feedUrl: e.feedUrl,
      eventType: e.eventType ?? "checkpoint",
      durationMs: e.durationMs,
      attempt: e.attempt,
      headline: e.headline,
      stage: e.stage,
      message: e.message,
      status: e.status,
      streamId: e.streamId,
      isStreaming: e.isStreaming ?? false,
      metadata: e.metadata ?? {},
    }));
  }

  private async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) {
      return;
    }

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    this.flushing = true;
    let retryAttempt: number | null = null;

    try {
      const db = getDb();

      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, ProcessingEventBus.MAX_BATCH_SIZE);

        try {
          await db.insert(processingLogs).values(this.mapToDbRows(batch));
          this.flushFailureCount = 0;
        } catch (error) {
          this.flushFailureCount += 1;

          if (this.flushFailureCount <= ProcessingEventBus.MAX_FLUSH_RETRIES) {
            retryAttempt = this.flushFailureCount;
            this.queue.unshift(...batch);

            logger.warn(
              {
                error,
                attempt: this.flushFailureCount,
                maxAttempts: ProcessingEventBus.MAX_FLUSH_RETRIES,
                retryDelayMs: this.getRetryDelayMs(this.flushFailureCount),
                batchSize: batch.length,
                queuedEvents: this.queue.length,
              },
              "Failed to flush processing logs batch; scheduling retry",
            );
          } else {
            const dropped = batch.length;
            this.droppedEvents += dropped;

            logger.warn(
              {
                error,
                dropped,
                maxAttempts: ProcessingEventBus.MAX_FLUSH_RETRIES,
              },
              "Failed to flush processing logs batch after retries; dropping batch",
            );

            this.flushFailureCount = 0;
          }

          break;
        }
      }
    } finally {
      this.flushing = false;

      if (this.droppedEvents > 0) {
        logger.warn(
          { dropped: this.droppedEvents },
          "Dropped processing events due to telemetry backpressure",
        );
        this.droppedEvents = 0;
      }

      if (this.queue.length > 0) {
        if (retryAttempt != null) {
          this.scheduleRetryFlush(retryAttempt);
          return;
        }

        this.scheduleFlush();
      }
    }
  }

  async shutdown(
    options: ProcessingEventBusShutdownOptions = {},
  ): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    const drainTimeoutMs = Math.max(options.drainTimeoutMs ?? 5_000, 1_000);
    this.shuttingDown = true;

    this.shutdownPromise = (async () => {
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }

      if (!this.flushing && this.queue.length > 0) {
        await this.flush();
      }

      const deadline = Date.now() + drainTimeoutMs;
      let drainTimedOut = false;

      while (this.flushing || this.queue.length > 0) {
        if (Date.now() >= deadline) {
          drainTimedOut = true;
          const pending = this.queue.length;

          if (pending > 0) {
            this.droppedEvents += pending;
            this.queue.length = 0;
          }

          logger.warn(
            {
              pending,
              flushing: this.flushing,
              drainTimeoutMs,
            },
            "Processing event bus shutdown drain timed out",
          );
          break;
        }

        if (!this.flushing && this.queue.length > 0) {
          await this.flush();
          continue;
        }

        await new Promise<void>((resolve) => {
          const timer = setTimeout(
            resolve,
            ProcessingEventBus.SHUTDOWN_POLL_INTERVAL_MS,
          );
          timer.unref?.();
        });
      }

      if (!drainTimedOut && !this.flushing && this.queue.length === 0) {
        logger.info(
          { drainTimeoutMs },
          "Processing event bus drained during shutdown",
        );
      }
    })();

    return this.shutdownPromise;
  }
}

export const processingEventBus = new ProcessingEventBus();
