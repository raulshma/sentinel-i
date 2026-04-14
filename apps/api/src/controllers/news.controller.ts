import type { NextFunction, Request, Response } from 'express'
import { z } from 'zod'

import { logger } from '../config/logger.js'
import { isNewsCategory, type ViewportQuery } from '../types/news.js'
import type { NewsService } from '../services/news.service.js'

const viewportQuerySchema = z
  .object({
    minLng: z.coerce.number().min(-180).max(180),
    minLat: z.coerce.number().min(-90).max(90),
    maxLng: z.coerce.number().min(-180).max(180),
    maxLat: z.coerce.number().min(-90).max(90),
    hours: z.coerce.number().int().min(1).max(72).default(24),
    categories: z.string().optional(),
  })
  .refine((value) => value.minLng < value.maxLng, {
    message: 'minLng must be less than maxLng',
    path: ['minLng'],
  })
  .refine((value) => value.minLat < value.maxLat, {
    message: 'minLat must be less than maxLat',
    path: ['minLat'],
  })

export class NewsController {
  constructor(private readonly service: NewsService) {}

  getViewportNews = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const parsed = viewportQuerySchema.safeParse(req.query)

    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid viewport query',
        details: parsed.error.flatten(),
      })
      return
    }

    const categories = parsed.data.categories
      ?.split(',')
      .map((value) => value.trim())
      .filter(isNewsCategory)

    const viewport: ViewportQuery = {
      minLng: parsed.data.minLng,
      minLat: parsed.data.minLat,
      maxLng: parsed.data.maxLng,
      maxLat: parsed.data.maxLat,
      hours: parsed.data.hours,
      categories: categories && categories.length > 0 ? categories : undefined,
    }

    try {
      const data = await this.service.getViewportNews(viewport)

      res.json({
        data,
        meta: {
          count: data.length,
          query: viewport,
        },
      })
    } catch (error) {
      logger.error({ error }, 'Failed to fetch viewport news')
      next(error)
    }
  }

  getRealtimeStats = (_req: Request, res: Response): void => {
    res.json({
      data: this.service.getRealtimeStats(),
    })
  }
}
