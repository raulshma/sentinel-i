import cron, { type ScheduledTask } from 'node-cron'

import { logger } from '../config/logger.js'
import { retentionService } from '../services/retention.service.js'

let retentionTask: ScheduledTask | null = null

export const startRetentionScheduler = (): void => {
  if (retentionTask) {
    return
  }

  retentionTask = cron.schedule('0 4 * * *', async () => {
    logger.info('Scheduled retention cleanup started')

    const result = await retentionService.runRetentionCycle()

    logger.info(result, 'Scheduled retention cleanup completed')
  })

  logger.info('Retention cleanup scheduler initialized (daily at 04:00 UTC)')
}

export const stopRetentionScheduler = async (): Promise<void> => {
  if (retentionTask) {
    await retentionTask.stop()
    retentionTask = null
  }
}
