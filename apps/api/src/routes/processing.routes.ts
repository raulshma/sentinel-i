import { Router } from "express";

import {
  getProcessingAnalytics,
  getProcessingLogs,
  getProcessingTimeline,
} from "../controllers/processing.controller.js";

const processingRouter = Router();

processingRouter.get("/logs", getProcessingLogs);
processingRouter.get("/timeline", getProcessingTimeline);
processingRouter.get("/analytics", getProcessingAnalytics);

export { processingRouter };
