import type { Request, Response } from 'express'

import { pingDatabase } from '../config/db.js'
import { env } from '../config/env.js'
import { pingValkey } from '../config/valkey.js'

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
