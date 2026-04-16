import { sql } from "drizzle-orm";

import { getDb } from "../config/db.js";
import { logger } from "../config/logger.js";
import { newsItems, ingestionRuns, processingLogs } from "../db/schema.js";

const ARCHIVE_THRESHOLD_HOURS = 72;
const DELETE_THRESHOLD_HOURS = 720;
const ARCHIVED_CATEGORY_PREFIX = "[Archived] ";

export interface RetentionResult {
  archivedCount: number;
  deletedCount: number;
  deletedRunsCount: number;
  deletedProcessingLogsCount: number;
  ranAt: string;
}

export class RetentionService {
  async runRetentionCycle(): Promise<RetentionResult> {
    const result: RetentionResult = {
      archivedCount: 0,
      deletedCount: 0,
      deletedRunsCount: 0,
      deletedProcessingLogsCount: 0,
      ranAt: new Date().toISOString(),
    };

    const db = getDb();

    try {
      const countResult = await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE published_at < NOW() - make_interval(hours => ${ARCHIVE_THRESHOLD_HOURS}::int)
                           AND published_at >= NOW() - make_interval(hours => ${DELETE_THRESHOLD_HOURS}::int)) AS archivable,
          COUNT(*) FILTER (WHERE published_at < NOW() - make_interval(hours => ${DELETE_THRESHOLD_HOURS}::int)) AS deletable
        FROM ${newsItems}
      `);

      const row = countResult.rows[0]!;
      const archivable = Number(row.archivable ?? 0);
      const deletable = Number(row.deletable ?? 0);
      const archivePrefixPattern = `${ARCHIVED_CATEGORY_PREFIX}%`;

      const processingLogsCountResult = await db.execute(sql`
        SELECT COUNT(*) AS deletable
        FROM ${processingLogs}
        WHERE created_at < NOW() - make_interval(hours => ${DELETE_THRESHOLD_HOURS}::int)
      `);

      const processingLogsDeletable = Number(
        processingLogsCountResult.rows[0]?.deletable ?? 0,
      );

      logger.info(
        { archivable, deletable, processingLogsDeletable },
        "Retention cycle starting",
      );

      if (archivable > 0) {
        const archiveResult = await db.execute(sql`
          UPDATE ${newsItems}
          SET category = CASE
            WHEN category LIKE ${archivePrefixPattern} THEN category
            ELSE ${ARCHIVED_CATEGORY_PREFIX} || category
          END
          WHERE published_at < NOW() - make_interval(hours => ${ARCHIVE_THRESHOLD_HOURS}::int)
            AND published_at >= NOW() - make_interval(hours => ${DELETE_THRESHOLD_HOURS}::int)
            AND category NOT LIKE ${archivePrefixPattern}
        `);
        result.archivedCount = archiveResult.rowCount ?? 0;
      }

      if (deletable > 0) {
        const deleteResult = await db.execute(sql`
          DELETE FROM ${newsItems}
          WHERE published_at < NOW() - make_interval(hours => ${DELETE_THRESHOLD_HOURS}::int)
        `);
        result.deletedCount = deleteResult.rowCount ?? 0;
      }

      const deleteRunsResult = await db.execute(sql`
        DELETE FROM ${ingestionRuns}
        WHERE started_at < NOW() - make_interval(hours => ${DELETE_THRESHOLD_HOURS}::int)
      `);
      result.deletedRunsCount = deleteRunsResult.rowCount ?? 0;

      if (processingLogsDeletable > 0) {
        const deleteProcessingLogsResult = await db.execute(sql`
          DELETE FROM ${processingLogs}
          WHERE created_at < NOW() - make_interval(hours => ${DELETE_THRESHOLD_HOURS}::int)
        `);
        result.deletedProcessingLogsCount =
          deleteProcessingLogsResult.rowCount ?? 0;
      }

      logger.info(result, "Retention cycle completed");
    } catch (error) {
      logger.error({ error }, "Retention cycle failed");
    }

    return result;
  }
}

export const retentionService = new RetentionService();
