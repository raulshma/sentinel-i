import { Queue } from 'bullmq'

import { getValkey } from '../config/valkey.js'

export type RssSyncJobData = {
  triggeredAt: string
}

export const rssSyncQueue = new Queue<RssSyncJobData>('rss-sync', {
  connection: getValkey(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5_000,
    },
    removeOnComplete: 50,
    removeOnFail: 100,
  },
})

export const closeRssQueue = async (): Promise<void> => {
  await rssSyncQueue.close()
}
