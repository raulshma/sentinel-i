import type { Request, Response } from 'express'

import { pingDatabase } from '../config/db.js'
import { env } from '../config/env.js'
import { isDevToolsEnabled } from '../config/env.js'
import { logger } from '../config/logger.js'
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

export const getUsageLimits = async (_req: Request, res: Response): Promise<void> => {
  if (!isDevToolsEnabled) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  if (!env.OPENROUTER_API_KEY) {
    res.status(200).json({ configured: false })
    return
  }

  try {
    const response = await fetch(`${env.OPENROUTER_BASE_URL}/key`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      },
    })

    if (!response.ok) {
      logger.error({ status: response.status }, 'Failed to fetch OpenRouter key info')
      res.status(502).json({ error: 'Failed to fetch usage info from OpenRouter' })
      return
    }

    const data = (await response.json()) as {
      data: {
        label: string
        limit: number | null
        limit_reset: string | null
        limit_remaining: number | null
        include_byok_in_limit: boolean
        usage: number
        usage_daily: number
        usage_weekly: number
        usage_monthly: number
        byok_usage: number
        byok_usage_daily: number
        byok_usage_weekly: number
        byok_usage_monthly: number
        is_free_tier: boolean
      }
    }

    res.json({ configured: true, ...data })
  } catch (err) {
    logger.error({ err }, 'Error fetching OpenRouter usage limits')
    res.status(500).json({ error: 'Internal error fetching usage info' })
  }
}
