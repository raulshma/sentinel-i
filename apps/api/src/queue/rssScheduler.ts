import cron, { type ScheduledTask } from 'node-cron'

import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import { rssSyncQueue } from './rssQueue.js'

let schedulerTask: ScheduledTask | null = null

export const startRssScheduler = (): void => {
  if (schedulerTask) {
    return
  }

  schedulerTask = cron.schedule(env.RSS_SYNC_CRON, async () => {
    await rssSyncQueue.add('sync-feeds', {
      triggeredAt: new Date().toISOString(),
    })

    logger.info(
      { schedule: env.RSS_SYNC_CRON },
      'Queued scheduled RSS sync job',
    )
  })

  logger.info({ schedule: env.RSS_SYNC_CRON }, 'RSS scheduler initialized')
}

export const stopRssScheduler = async (): Promise<void> => {
  if (schedulerTask) {
    await schedulerTask.stop()
    schedulerTask = null
  }
}
