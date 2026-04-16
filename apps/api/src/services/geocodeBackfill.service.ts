import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import { getDb } from "../config/db.js";
import { logger } from "../config/logger.js";
import { processingEventBus } from "../services/processingEventBus.js";
import { geocodeService } from "./geocode.service.js";

const BACKFILL_DELAY_MS = 350;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface BackfillRow {
  id: string;
  location_name: string | null;
  city: string | null;
  state: string | null;
}

export interface BackfillProgress {
  runId: string;
  total: number;
  geocoded: number;
  failed: number;
  skipped: number;
  status: "running" | "completed" | "failed";
  startedAt: string;
  finishedAt: string | null;
}

const activeRuns = new Map<string, BackfillProgress>();

export function getActiveBackfillRuns(): BackfillProgress[] {
  return [...activeRuns.values()].filter((r) => r.status === "running");
}

export async function startGeocodeBackfill(): Promise<{
  runId: string;
  total: number;
}> {
  const runId = randomUUID();

  const db = getDb();
  const result = await db.execute(sql`
    SELECT id, location_name, city, state
    FROM news_item_locations
    WHERE geom IS NULL
      AND (city IS NOT NULL OR state IS NOT NULL)
  `);

  const rows = result.rows as unknown as BackfillRow[];

  if (rows.length === 0) {
    processingEventBus.emitLog({
      runId,
      sourceUrl: "backfill://geocode",
      headline: null,
      stage: "geocoding",
      eventType: "end",
      message: "Geocode backfill: no locations need geocoding",
      status: "info",
      metadata: { reason: "all_locations_geocoded" },
    });

    return { runId, total: 0 };
  }

  const progress: BackfillProgress = {
    runId,
    total: rows.length,
    geocoded: 0,
    failed: 0,
    skipped: 0,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };

  activeRuns.set(runId, progress);

  processingEventBus.emitLog({
    runId,
    sourceUrl: "backfill://geocode",
    headline: null,
    stage: "geocoding",
    eventType: "start",
    message: `Geocode backfill started: ${rows.length} locations to process`,
    status: "start",
    metadata: { totalLocations: rows.length },
  });

  void runBackfill(runId, rows, progress);

  return { runId, total: rows.length };
}

async function runBackfill(
  runId: string,
  rows: BackfillRow[],
  progress: BackfillProgress,
): Promise<void> {
  const db = getDb();

  try {
    for (let i = 0; i < rows.length; i++) {
      if (progress.status !== "running") break;

      const row = rows[i]!;
      const label = [row.city, row.state].filter(Boolean).join(", ");

      const coordinates = await geocodeService.forwardGeocode({
        locationName: row.location_name ?? row.city ?? row.state ?? "",
        city: row.city,
        state: row.state,
      });

      if (coordinates) {
        await db.execute(sql`
          UPDATE news_item_locations
          SET geom = ST_SetSRID(ST_MakePoint(${coordinates.longitude}, ${coordinates.latitude}), 4326)::geography
          WHERE id = ${row.id}
        `);

        progress.geocoded++;

        processingEventBus.emitLog({
          runId,
          sourceUrl: `backfill://geocode/${row.id}`,
          headline: label,
          stage: "geocoding",
          eventType: "checkpoint",
          message: `[${i + 1}/${rows.length}] Geocoded: ${label} -> ${coordinates.latitude.toFixed(4)}, ${coordinates.longitude.toFixed(4)}`,
          status: "success",
          metadata: {
            locationId: row.id,
            city: row.city,
            state: row.state,
            latitude: coordinates.latitude,
            longitude: coordinates.longitude,
            displayName: coordinates.displayName,
            progress: `${progress.geocoded}/${progress.total}`,
            geocoded: progress.geocoded,
            failed: progress.failed,
          },
        });
      } else {
        progress.failed++;

        processingEventBus.emitLog({
          runId,
          sourceUrl: `backfill://geocode/${row.id}`,
          headline: label,
          stage: "geocoding",
          eventType: "checkpoint",
          message: `[${i + 1}/${rows.length}] Failed: ${label} (no results)`,
          status: "warn",
          metadata: {
            locationId: row.id,
            city: row.city,
            state: row.state,
            progress: `${progress.geocoded + progress.failed}/${progress.total}`,
            geocoded: progress.geocoded,
            failed: progress.failed,
          },
        });
      }

      await sleep(BACKFILL_DELAY_MS);
    }

    progress.status = "completed";
    progress.finishedAt = new Date().toISOString();

    processingEventBus.emitLog({
      runId,
      sourceUrl: "backfill://geocode",
      headline: null,
      stage: "geocoding",
      eventType: "end",
      message: `Geocode backfill completed: ${progress.geocoded} geocoded, ${progress.failed} failed out of ${progress.total}`,
      status: progress.failed === 0 ? "success" : "warn",
      metadata: {
        geocoded: progress.geocoded,
        failed: progress.failed,
        total: progress.total,
        durationMs:
          new Date(progress.finishedAt).getTime() -
          new Date(progress.startedAt).getTime(),
      },
    });
  } catch (error) {
    progress.status = "failed";
    progress.finishedAt = new Date().toISOString();

    processingEventBus.emitLog({
      runId,
      sourceUrl: "backfill://geocode",
      headline: null,
      stage: "geocoding",
      eventType: "error",
      message: `Geocode backfill failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      status: "error",
      metadata: {
        geocoded: progress.geocoded,
        failed: progress.failed,
        total: progress.total,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  } finally {
    activeRuns.delete(runId);
  }

  logger.info(
    {
      runId,
      geocoded: progress.geocoded,
      failed: progress.failed,
      total: progress.total,
    },
    "Geocode backfill run finished",
  );
}
