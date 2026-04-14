import { getPgPool } from '../config/db.js'
import { logger } from '../config/logger.js'
import type { ProcessingLogEntry } from '../services/processingEventBus.js'

type ProcessingLogRow = {
  id: string
  source_url: string
  headline: string | null
  stage: string
  message: string
  status: string
  metadata: Record<string, unknown>
  created_at: Date
}

const RECENT_LOGS_SQL = `
  SELECT
    id,
    source_url,
    headline,
    stage,
    message,
    status,
    metadata,
    created_at
  FROM processing_logs
  ORDER BY created_at DESC
  LIMIT $1::int
`

const mapRowToLogEntry = (row: ProcessingLogRow): ProcessingLogEntry => ({
  id: String(row.id),
  sourceUrl: row.source_url,
  headline: row.headline,
  stage: row.stage as ProcessingLogEntry['stage'],
  message: row.message,
  status: row.status as ProcessingLogEntry['status'],
  metadata: row.metadata,
  createdAt: row.created_at.toISOString(),
})

export class ProcessingLogRepository {
  async findRecent(limit = 200): Promise<ProcessingLogEntry[]> {
    try {
      const result = await getPgPool().query<ProcessingLogRow>(RECENT_LOGS_SQL, [limit])
      return result.rows.map(mapRowToLogEntry).reverse()
    } catch (error) {
      logger.warn({ error }, 'Failed to fetch recent processing logs')
      return []
    }
  }
}

export const processingLogRepository = new ProcessingLogRepository()
