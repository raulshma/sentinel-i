import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import { env } from './env.js'
import { logger } from './logger.js'
import * as schema from '../db/schema.js'

let pool: Pool | null = null
let db: ReturnType<typeof drizzle<typeof schema>> | null = null

const getPool = (): Pool => {
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

export const getDb = () => {
  if (!db) {
    db = drizzle(getPool(), { schema })
  }

  return db
}

export const pingDatabase = async (): Promise<boolean> => {
  try {
    await getDb().execute(sql`SELECT 1`)
    return true
  } catch (error) {
    logger.warn({ error }, 'PostgreSQL health check failed')
    return false
  }
}

export const closePgPool = async (): Promise<void> => {
  if (pool) {
    await pool.end()
    pool = null
    db = null
  }
}
