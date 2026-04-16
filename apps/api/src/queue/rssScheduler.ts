import cron, { type ScheduledTask } from "node-cron";

import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { enqueueRssSyncJob } from "./rssQueue.js";

let schedulerTask: ScheduledTask | null = null;

export const startRssScheduler = (): void => {
  if (schedulerTask) {
    return;
  }

  if (!cron.validate(env.RSS_SYNC_CRON)) {
    logger.error(
      { schedule: env.RSS_SYNC_CRON },
      "RSS scheduler received an invalid cron expression",
    );
    throw new Error(`Invalid RSS_SYNC_CRON expression: ${env.RSS_SYNC_CRON}`);
  }

  schedulerTask = cron.schedule(env.RSS_SYNC_CRON, async () => {
    try {
      const result = await enqueueRssSyncJob(new Date().toISOString());

      if (!result.enqueued) {
        logger.info(
          {
            schedule: env.RSS_SYNC_CRON,
            jobId: result.jobId,
            state: result.state,
          },
          "Skipped scheduled RSS sync enqueue because a sync job is already in-flight",
        );
        return;
      }

      logger.info(
        { schedule: env.RSS_SYNC_CRON, jobId: result.jobId },
        "Queued scheduled RSS sync job",
      );
    } catch (error) {
      logger.error(
        { error, schedule: env.RSS_SYNC_CRON },
        "Failed to enqueue scheduled RSS sync job",
      );
    }
  });

  logger.info({ schedule: env.RSS_SYNC_CRON }, "RSS scheduler initialized");
};

export const stopRssScheduler = async (): Promise<void> => {
  if (schedulerTask) {
    await schedulerTask.stop();
    schedulerTask = null;
  }
};

export const getNextRunDate = (): Date | null => {
  if (!schedulerTask) {
    return null;
  }

  const nextRun = schedulerTask.getNextRun();
  return nextRun ? new Date(nextRun.getTime()) : null;
};
