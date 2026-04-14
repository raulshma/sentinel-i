import { Redis } from 'ioredis'

import { env } from './env.js'
import { logger } from './logger.js'

let valkey: Redis | null = null

export const getValkey = (): Redis => {
  if (valkey) {
    return valkey
  }

  const client = new Redis(env.VALKEY_URL, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
  })

  client.on('error', (error: Error) => {
    logger.error({ error }, 'Valkey connection error')
  })

  valkey = client

  return client
}

export const pingValkey = async (): Promise<boolean> => {
  try {
    return (await getValkey().ping()) === 'PONG'
  } catch (error) {
    logger.warn({ error }, 'Valkey health check failed')
    return false
  }
}

export const closeValkey = async (): Promise<void> => {
  if (valkey) {
    await valkey.quit()
    valkey = null
  }
}
