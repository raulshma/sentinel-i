import { desc } from 'drizzle-orm'

import { getDb } from '../config/db.js'
import { logger } from '../config/logger.js'
import { processingLogs } from '../db/schema.js'
import type { ProcessingLogEntry } from '../services/processingEventBus.js'

export class ProcessingLogRepository {
  async findRecent(limit = 200): Promise<ProcessingLogEntry[]> {
    try {
      const result = await getDb()
        .select()
        .from(processingLogs)
        .orderBy(desc(processingLogs.createdAt))
        .limit(limit)

      return result
        .map((row): ProcessingLogEntry => ({
          id: String(row.id),
          sourceUrl: row.sourceUrl,
          headline: row.headline,
          stage: row.stage as ProcessingLogEntry['stage'],
          message: row.message,
          status: row.status as ProcessingLogEntry['status'],
          metadata: (row.metadata as Record<string, unknown>) ?? {},
          createdAt: row.createdAt.toISOString(),
        }))
        .reverse()
    } catch (error) {
      logger.warn({ error }, 'Failed to fetch recent processing logs')
      return []
    }
  }
}

export const processingLogRepository = new ProcessingLogRepository()
