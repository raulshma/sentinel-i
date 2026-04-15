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

class ProcessingEventBus extends EventEmitter {
  private static readonly FLUSH_INTERVAL_MS = 120;
  private static readonly MAX_BATCH_SIZE = 300;
  private static readonly MAX_QUEUE_SIZE = 12_000;

  private queue: ProcessingLogEntry[] = [];
  private flushing = false;
  private flushTimer: NodeJS.Timeout | null = null;
  private droppedEvents = 0;

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

    for (let i = 0; i < overflow; i += 1) {
      this.queue.shift();
      this.droppedEvents += 1;
    }
  }

  private scheduleFlush(): void {
    if (this.flushing || this.queue.length === 0) {
      return;
    }

    if (this.queue.length >= ProcessingEventBus.MAX_BATCH_SIZE) {
      void this.flush();
      return;
    }

    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, ProcessingEventBus.FLUSH_INTERVAL_MS);
    this.flushTimer.unref?.();
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
    let inFlightBatchSize = 0;

    try {
      const db = getDb();

      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, ProcessingEventBus.MAX_BATCH_SIZE);
        inFlightBatchSize = batch.length;

        await db.insert(processingLogs).values(
          batch.map((e) => ({
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
          })),
        );

        inFlightBatchSize = 0;
      }
    } catch (error) {
      const dropped = this.queue.length + inFlightBatchSize;
      logger.warn({ error, dropped }, "Failed to flush processing logs batch");
      this.droppedEvents += dropped;
      this.queue.length = 0;
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
        this.scheduleFlush();
      }
    }
  }
}

export const processingEventBus = new ProcessingEventBus();
