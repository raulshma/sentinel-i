import type { Request, Response } from "express";
import { z } from "zod";

import { isDevToolsEnabled } from "../config/env.js";
import { processingLogRepository } from "../repositories/processingLog.repository.js";
import { socketGateway } from "../socket/socketGateway.js";

const timelineQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(2000).optional(),
  hours: z.coerce.number().int().min(1).max(168).optional(),
  traceId: z.string().trim().min(1).optional(),
  sourceUrl: z.string().trim().min(1).optional(),
  articleId: z.string().uuid().optional(),
  runId: z.string().trim().min(1).optional(),
  jobId: z.string().trim().min(1).optional(),
});

const analyticsQuerySchema = z.object({
  hours: z.coerce.number().int().min(1).max(168).default(24),
});

export const getProcessingLogs = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  if (!isDevToolsEnabled) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const logs = await processingLogRepository.findRecent(200);

  res.json({
    data: logs,
    devToolsEnabled: socketGateway.isDevToolsEnabled(),
  });
};

export const getProcessingTimeline = async (
  req: Request,
  res: Response,
): Promise<void> => {
  if (!isDevToolsEnabled) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const parsed = timelineQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid timeline query",
      details: parsed.error.flatten(),
    });
    return;
  }

  const timeline = await processingLogRepository.findTimeline(parsed.data);

  res.json({
    data: timeline.events,
    groups: timeline.groups,
    meta: {
      count: timeline.events.length,
      groupCount: timeline.groups.length,
      query: parsed.data,
      devToolsEnabled: socketGateway.isDevToolsEnabled(),
    },
  });
};

export const getProcessingAnalytics = async (
  req: Request,
  res: Response,
): Promise<void> => {
  if (!isDevToolsEnabled) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const parsed = analyticsQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid analytics query",
      details: parsed.error.flatten(),
    });
    return;
  }

  const analytics = await processingLogRepository.getAnalytics(
    parsed.data.hours,
  );

  res.json({
    data: analytics,
    devToolsEnabled: socketGateway.isDevToolsEnabled(),
  });
};
