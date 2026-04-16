import { Router } from "express";

import {
  getGeocodeBackfillStatus,
  triggerGeocodeBackfill,
} from "../controllers/geocode.controller.js";

const geocodeRouter = Router();

geocodeRouter.post("/backfill", triggerGeocodeBackfill);
geocodeRouter.get("/backfill", getGeocodeBackfillStatus);

export { geocodeRouter };
