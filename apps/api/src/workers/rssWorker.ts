import { Worker, type Job } from 'bullmq'

import { env } from '../config/env.js'
import { getRedis } from '../config/redis.js'
import { logger } from '../config/logger.js'
import type { RssSyncJobData } from '../queue/rssQueue.js'

let worker: Worker<RssSyncJobData> | null = null

const processRssSyncJob = async (job: Job<RssSyncJobData>): Promise<void> => {
  logger.info(
    { jobId: job.id, triggeredAt: job.data.triggeredAt },
    'RSS sync worker placeholder executed',
  )

  // Phase 2 implementation target:
  // 1) Fetch RSS feed batch
  // 2) Deduplicate
  // 3) Agentic scrape + extraction
  // 4) Geocode + persist

  await Promise.resolve()
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
