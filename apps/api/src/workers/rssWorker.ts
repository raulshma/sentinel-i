import { randomUUID } from "node:crypto";

import { Worker, type Job } from "bullmq";

import { env } from "../config/env.js";
import { getValkey } from "../config/valkey.js";
import { logger } from "../config/logger.js";
import type { RssSyncJobData } from "../queue/rssQueue.js";
import { processingEventBus } from "../services/processingEventBus.js";
import { rssIngestionService } from "../services/rssIngestion.service.js";

let worker: Worker<RssSyncJobData> | null = null;

const processRssSyncJob = async (job: Job<RssSyncJobData>): Promise<void> => {
  const runId = randomUUID();
  const jobId = job.id != null ? String(job.id) : undefined;
  const attempt = job.attemptsMade + 1;
  const startedAtMs = Date.now();

  processingEventBus.emitLog({
    runId,
    jobId,
    attempt,
    sourceUrl: "queue://rss-sync",
    headline: null,
    stage: "queue",
    eventType: "start",
    message: "RSS sync job started",
    status: "start",
    metadata: {
      triggeredAt: job.data.triggeredAt,
    },
  });

  logger.info(
    { jobId: job.id, triggeredAt: job.data.triggeredAt },
    "RSS sync job started",
  );

  try {
    const summary = await rssIngestionService.runIngestionCycle({
      runId,
      jobId,
      attempt,
      triggeredAt: job.data.triggeredAt,
    });

    processingEventBus.emitLog({
      runId,
      jobId,
      attempt,
      sourceUrl: "queue://rss-sync",
      headline: null,
      stage: "queue",
      eventType: "end",
      durationMs: Date.now() - startedAtMs,
      message: "RSS sync job completed",
      status: "success",
      metadata: {
        triggeredAt: job.data.triggeredAt,
        summary,
      },
    });

    logger.info(
      {
        jobId: job.id,
        triggeredAt: job.data.triggeredAt,
        runId,
        attempt,
        summary,
      },
      "RSS sync job completed",
    );
  } catch (error) {
    processingEventBus.emitLog({
      runId,
      jobId,
      attempt,
      sourceUrl: "queue://rss-sync",
      headline: null,
      stage: "queue",
      eventType: "error",
      durationMs: Date.now() - startedAtMs,
      message: `RSS sync job failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      status: "error",
      metadata: {
        triggeredAt: job.data.triggeredAt,
        failureType: "queue_job_failed",
      },
    });

    throw error;
  }
};

export const startRssWorker = (): Worker<RssSyncJobData> => {
  if (worker) {
    return worker;
  }

  getValkey();

  worker = new Worker<RssSyncJobData>("rss-sync", processRssSyncJob, {
    connection: {
      url: env.VALKEY_URL,
    },
    concurrency: 1,
  });

  worker.on("failed", (job, error) => {
    logger.error({ jobId: job?.id, error }, "RSS sync worker job failed");
  });

  return worker;
};

export const stopRssWorker = async (): Promise<void> => {
  if (worker) {
    await worker.close();
    worker = null;
  }
};
