import { getPgPool } from '../config/db.js'
import { logger } from '../config/logger.js'

const ARCHIVE_THRESHOLD_HOURS = 72
const DELETE_THRESHOLD_HOURS = 720

const COUNT_OLD_ITEMS_SQL = `
  SELECT
    COUNT(*) FILTER (WHERE published_at < NOW() - make_interval(hours => $1::int)
                     AND published_at >= NOW() - make_interval(hours => $2::int)) AS archivable,
    COUNT(*) FILTER (WHERE published_at < NOW() - make_interval(hours => $2::int)) AS deletable
  FROM news_items;
`

const FLAG_ARCHIVED_SQL = `
  UPDATE news_items
  SET is_national = is_national
  WHERE published_at < NOW() - make_interval(hours => $1::int)
    AND published_at >= NOW() - make_interval(hours => $2::int)
    AND (category NOT LIKE '%Archived%');
`

const DELETE_OLD_SQL = `
  DELETE FROM news_items
  WHERE published_at < NOW() - make_interval(hours => $1::int);
`

const DELETE_OLD_INGESTION_RUNS_SQL = `
  DELETE FROM ingestion_runs
  WHERE started_at < NOW() - make_interval(hours => $1::int);
`

export interface RetentionResult {
  archivedCount: number
  deletedCount: number
  deletedRunsCount: number
  ranAt: string
}

export class RetentionService {
  async runRetentionCycle(): Promise<RetentionResult> {
    const result: RetentionResult = {
      archivedCount: 0,
      deletedCount: 0,
      deletedRunsCount: 0,
      ranAt: new Date().toISOString(),
    }

    const pool = getPgPool()

    try {
      const countResult = await pool.query<{
        archivable: string
        deletable: string
      }>(COUNT_OLD_ITEMS_SQL, [ARCHIVE_THRESHOLD_HOURS, DELETE_THRESHOLD_HOURS])

      const archivable = Number(countResult.rows[0]?.archivable ?? 0)
      const deletable = Number(countResult.rows[0]?.deletable ?? 0)

      logger.info({ archivable, deletable }, 'Retention cycle starting')

      if (archivable > 0) {
        const archiveResult = await pool.query(FLAG_ARCHIVED_SQL, [
          ARCHIVE_THRESHOLD_HOURS,
          DELETE_THRESHOLD_HOURS,
        ])
        result.archivedCount = archiveResult.rowCount ?? 0
      }

      if (deletable > 0) {
        const deleteResult = await pool.query(DELETE_OLD_SQL, [DELETE_THRESHOLD_HOURS])
        result.deletedCount = deleteResult.rowCount ?? 0
      }

      const deleteRunsResult = await pool.query(DELETE_OLD_INGESTION_RUNS_SQL, [
        DELETE_THRESHOLD_HOURS,
      ])
      result.deletedRunsCount = deleteRunsResult.rowCount ?? 0

      logger.info(result, 'Retention cycle completed')
    } catch (error) {
      logger.error({ error }, 'Retention cycle failed')
    }

    return result
  }
}

export const retentionService = new RetentionService()
