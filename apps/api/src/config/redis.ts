import { Redis } from 'ioredis'

import { env } from './env.js'
import { logger } from './logger.js'

let redis: Redis | null = null

export const getRedis = (): Redis => {
  if (redis) {
    return redis
  }

  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
  })

  client.on('error', (error: Error) => {
    logger.error({ error }, 'Redis connection error')
  })

  redis = client

  return client
}

export const pingRedis = async (): Promise<boolean> => {
  try {
    return (await getRedis().ping()) === 'PONG'
  } catch (error) {
    logger.warn({ error }, 'Redis health check failed')
    return false
  }
}

export const closeRedis = async (): Promise<void> => {
  if (redis) {
    await redis.quit()
    redis = null
  }
}
