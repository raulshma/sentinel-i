import { createServer } from 'node:http'

import { createApp } from './app.js'
import { closePgPool } from './config/db.js'
import { env } from './config/env.js'
import { logger } from './config/logger.js'
import { closeRedis } from './config/redis.js'
import { closeRssQueue } from './queue/rssQueue.js'
import { startRssScheduler, stopRssScheduler } from './queue/rssScheduler.js'
import { socketGateway } from './socket/socketGateway.js'
import { startRssWorker, stopRssWorker } from './workers/rssWorker.js'

const app = createApp()
const server = createServer(app)

socketGateway.attach(server)
startRssScheduler()
startRssWorker()

server.listen(env.PORT, () => {
  logger.info(
    {
      port: env.PORT,
      environment: env.NODE_ENV,
      clientOrigin: env.CLIENT_ORIGIN,
    },
    'API server listening',
  )
})

let shuttingDown = false

const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) {
    return
  }

  shuttingDown = true

  logger.info({ signal }, 'Graceful shutdown started')

  socketGateway.shutdown()

  await Promise.allSettled([
    stopRssScheduler(),
    stopRssWorker(),
    closeRssQueue(),
    closePgPool(),
    closeRedis(),
  ])

  server.close((error) => {
    if (error) {
      logger.error({ error }, 'Error while closing HTTP server')
      process.exit(1)
    }

    process.exit(0)
  })

  setTimeout(() => {
    logger.error('Shutdown timed out; forcing process exit')
    process.exit(1)
  }, 10_000).unref()
}

process.on('SIGINT', () => {
  void shutdown('SIGINT')
})

process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})
