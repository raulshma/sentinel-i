import cron, { type ScheduledTask } from "node-cron";

import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { rssSyncQueue } from "./rssQueue.js";

let schedulerTask: ScheduledTask | null = null;

export const startRssScheduler = (): void => {
  if (schedulerTask) {
    return;
  }

  schedulerTask = cron.schedule(env.RSS_SYNC_CRON, async () => {
    const job = await rssSyncQueue.add("sync-feeds", {
      triggeredAt: new Date().toISOString(),
    });

    logger.info(
      { schedule: env.RSS_SYNC_CRON, jobId: job.id },
      "Queued scheduled RSS sync job",
    );
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
  if (!schedulerTask) return null;
  const now = new Date();
  const parts = env.RSS_SYNC_CRON.split(" ");
  if (parts.length !== 5) return null;

  const minutePart = parts[1];
  const hourPart = parts[2];
  if (!minutePart || !hourPart) return null;

  const next = new Date(now);
  next.setSeconds(0, 0);

  const minutes = parseCronField(minutePart, 0, 59);
  const hours = parseCronField(hourPart, 0, 23);

  for (let attempt = 0; attempt < 525600; attempt++) {
    next.setMinutes(next.getMinutes() + 1);
    if (minutes.has(next.getMinutes()) && hours.has(next.getHours())) {
      return next;
    }
  }

  return null;
};

function parseCronField(field: string, min: number, max: number): Set<number> {
  const result = new Set<number>();
  for (const part of field.split(",")) {
    if (part === "*") {
      for (let i = min; i <= max; i++) result.add(i);
    } else if (part.includes("/")) {
      const segments = part.split("/");
      const base = segments[0] ?? "*";
      const stepStr = segments[1] ?? "1";
      const step = parseInt(stepStr, 10);
      const start = base === "*" ? min : parseInt(base, 10);
      for (let i = start; i <= max; i += step) result.add(i);
    } else {
      result.add(parseInt(part, 10));
    }
  }
  return result;
}
