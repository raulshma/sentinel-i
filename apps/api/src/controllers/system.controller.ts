import type { Request, Response } from 'express'

import { pingDatabase } from '../config/db.js'
import { env } from '../config/env.js'
import { isDevToolsEnabled } from '../config/env.js'
import { pingValkey } from '../config/valkey.js'
import { rssSyncQueue } from '../queue/rssQueue.js'
import { getNextRunDate } from '../queue/rssScheduler.js'

export const getHealth = async (_req: Request, res: Response): Promise<void> => {
  const [databaseOk, valkeyOk] = await Promise.all([pingDatabase(), pingValkey()])

  const overallOk = databaseOk && valkeyOk

  res.status(overallOk ? 200 : 503).json({
    status: overallOk ? 'ok' : 'degraded',
    environment: env.NODE_ENV,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    services: {
      database: databaseOk ? 'up' : 'down',
      valkey: valkeyOk ? 'up' : 'down',
      websocket: 'up',
    },
  })
}

export const triggerSync = async (_req: Request, res: Response): Promise<void> => {
  if (!isDevToolsEnabled) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  const job = await rssSyncQueue.add('sync-feeds', {
    triggeredAt: new Date().toISOString(),
  })

  res.status(202).json({
    status: 'queued',
    jobId: job.id,
    timestamp: new Date().toISOString(),
  })
}

export const getDevToolsStatus = (_req: Request, res: Response): void => {
  if (!isDevToolsEnabled) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  const nextRun = getNextRunDate()

  res.json({
    devToolsEnabled: true,
    cronSchedule: env.RSS_SYNC_CRON,
    nextSyncAt: nextRun?.toISOString() ?? null,
  })
}
