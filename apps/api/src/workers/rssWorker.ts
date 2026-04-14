import { Worker, type Job } from 'bullmq'

import { env } from '../config/env.js'
import { getRedis } from '../config/redis.js'
import { logger } from '../config/logger.js'
import type { RssSyncJobData } from '../queue/rssQueue.js'
import { rssIngestionService } from '../services/rssIngestion.service.js'

let worker: Worker<RssSyncJobData> | null = null

const processRssSyncJob = async (job: Job<RssSyncJobData>): Promise<void> => {
  logger.info({ jobId: job.id, triggeredAt: job.data.triggeredAt }, 'RSS sync job started')

  const summary = await rssIngestionService.runIngestionCycle()

  logger.info(
    {
      jobId: job.id,
      triggeredAt: job.data.triggeredAt,
      summary,
    },
    'RSS sync job completed',
  )
}

export const startRssWorker = (): Worker<RssSyncJobData> => {
  if (worker) {
    return worker
  }

  getRedis()

  worker = new Worker<RssSyncJobData>('rss-sync', processRssSyncJob, {
    connection: {
      url: env.REDIS_URL,
    },
    concurrency: 1,
  })

  worker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, error }, 'RSS sync worker job failed')
  })

  return worker
}

export const stopRssWorker = async (): Promise<void> => {
  if (worker) {
    await worker.close()
    worker = null
  }
}
