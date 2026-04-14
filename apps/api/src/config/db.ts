import { Pool } from 'pg'

import { env } from './env.js'
import { logger } from './logger.js'

let pool: Pool | null = null

export const getPgPool = (): Pool => {
  if (!pool) {
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })

    pool.on('error', (error) => {
      logger.error({ error }, 'Unexpected PostgreSQL pool error')
    })
  }

  return pool
}

export const pingDatabase = async (): Promise<boolean> => {
  const client = await getPgPool().connect()

  try {
    await client.query('SELECT 1')
    return true
  } catch (error) {
    logger.warn({ error }, 'PostgreSQL health check failed')
    return false
  } finally {
    client.release()
  }
}

export const closePgPool = async (): Promise<void> => {
  if (pool) {
    await pool.end()
    pool = null
  }
}
