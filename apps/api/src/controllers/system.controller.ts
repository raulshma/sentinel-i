import type { Request, Response } from 'express'

import { pingDatabase } from '../config/db.js'
import { env } from '../config/env.js'
import { pingRedis } from '../config/redis.js'

export const getHealth = async (_req: Request, res: Response): Promise<void> => {
  const [databaseOk, redisOk] = await Promise.all([pingDatabase(), pingRedis()])

  const overallOk = databaseOk && redisOk

  res.status(overallOk ? 200 : 503).json({
    status: overallOk ? 'ok' : 'degraded',
    environment: env.NODE_ENV,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    services: {
      database: databaseOk ? 'up' : 'down',
      redis: redisOk ? 'up' : 'down',
      websocket: 'up',
    },
  })
}
