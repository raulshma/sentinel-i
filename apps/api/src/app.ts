import cors from 'cors'
import express, { type ErrorRequestHandler } from 'express'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'

import { env } from './config/env.js'
import { logger } from './config/logger.js'
import { newsRouter } from './routes/news.routes.js'
import { systemRouter } from './routes/system.routes.js'

export const createApp = () => {
  const app = express()

  app.use(helmet())
  app.use(
    cors({
      origin: env.CLIENT_ORIGIN,
      credentials: true,
    }),
  )

  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 600,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  )

  app.use(express.json({ limit: '1mb' }))

  app.use('/api/v1', systemRouter)
  app.use('/api/v1/news', newsRouter)

  app.use((_req, res) => {
    res.status(404).json({ error: 'Route not found' })
  })

  const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) {
      next(error)
      return
    }

    logger.error({ error }, 'Unhandled API error')
    res.status(500).json({ error: 'Internal server error' })
  }

  app.use(errorHandler)

  return app
}
