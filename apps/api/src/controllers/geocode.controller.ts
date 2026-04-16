import type { Request, Response } from "express";

import { isDevToolsEnabled } from "../config/env.js";
import {
  getActiveBackfillRuns,
  startGeocodeBackfill,
} from "../services/geocodeBackfill.service.js";

export const triggerGeocodeBackfill = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  if (!isDevToolsEnabled) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const active = getActiveBackfillRuns();
  if (active.length > 0) {
    res.status(409).json({
      error: "A backfill run is already in progress",
      activeRuns: active,
    });
    return;
  }

  const { runId, total } = await startGeocodeBackfill();

  res.status(202).json({
    status: "started",
    runId,
    totalLocations: total,
    message:
      total === 0
        ? "No locations need geocoding"
        : `Backfill started for ${total} locations. Watch the devtools terminal for live progress.`,
  });
};

export const getGeocodeBackfillStatus = (
  _req: Request,
  res: Response,
): void => {
  if (!isDevToolsEnabled) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const active = getActiveBackfillRuns();
  res.json({ activeRuns: active });
};
