import { Queue } from "bullmq";

import { logger } from "../config/logger.js";
import { getValkey, withValkeyCommandTimeout } from "../config/valkey.js";

const RSS_SYNC_QUEUE_NAME = "rss-sync";
const RSS_SYNC_JOB_NAME = "sync-feeds";
const RSS_SYNC_SINGLETON_JOB_ID = "rss-sync-singleton";
const IN_FLIGHT_JOB_STATES = new Set([
  "waiting",
  "active",
  "delayed",
  "prioritized",
  "waiting-children",
]);

export type RssSyncJobData = {
  triggeredAt: string;
};

export interface EnqueueRssSyncJobResult {
  enqueued: boolean;
  jobId: string | null;
  state: string | null;
}

export const rssSyncQueue = new Queue<RssSyncJobData>(RSS_SYNC_QUEUE_NAME, {
  connection: getValkey(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5_000,
    },
    removeOnComplete: 50,
    removeOnFail: 100,
  },
});

export const enqueueRssSyncJob = async (
  triggeredAt = new Date().toISOString(),
): Promise<EnqueueRssSyncJobResult> => {
  const existingSingletonJob = await withValkeyCommandTimeout(
    "rss_queue_get_singleton_job",
    () => rssSyncQueue.getJob(RSS_SYNC_SINGLETON_JOB_ID),
  );

  if (existingSingletonJob) {
    const state = await withValkeyCommandTimeout(
      "rss_queue_get_singleton_state",
      () => existingSingletonJob.getState(),
    );

    if (IN_FLIGHT_JOB_STATES.has(state)) {
      return {
        enqueued: false,
        jobId:
          existingSingletonJob.id != null
            ? String(existingSingletonJob.id)
            : null,
        state,
      };
    }

    if (state === "completed" || state === "failed") {
      try {
        await withValkeyCommandTimeout("rss_queue_remove_singleton", () =>
          existingSingletonJob.remove(),
        );
      } catch (error) {
        logger.warn(
          {
            error,
            jobId: existingSingletonJob.id,
            state,
          },
          "Failed to remove terminal singleton RSS sync job before enqueue",
        );
      }
    }
  }

  const job = await withValkeyCommandTimeout("rss_queue_add_singleton", () =>
    rssSyncQueue.add(
      RSS_SYNC_JOB_NAME,
      {
        triggeredAt,
      },
      {
        jobId: RSS_SYNC_SINGLETON_JOB_ID,
        removeOnComplete: true,
        removeOnFail: true,
      },
    ),
  );

  const state = await withValkeyCommandTimeout(
    "rss_queue_get_new_job_state",
    () => job.getState(),
  );
  const wasPreexisting = job.data.triggeredAt !== triggeredAt;

  return {
    enqueued: !(wasPreexisting && IN_FLIGHT_JOB_STATES.has(state)),
    jobId: job.id != null ? String(job.id) : null,
    state,
  };
};

export const closeRssQueue = async (): Promise<void> => {
  await withValkeyCommandTimeout("rss_queue_close", () => rssSyncQueue.close());
};
