import type { NextFunction, Request, Response } from 'express'
import { z } from 'zod'

import { logger } from '../config/logger.js'
import { isNewsCategory, type ClusteredViewportQuery, type NewsCategory, type ViewportQuery } from '../types/news.js'
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

const clusteredViewportSchema = z
  .object({
    minLng: z.coerce.number().min(-180).max(180),
    minLat: z.coerce.number().min(-90).max(90),
    maxLng: z.coerce.number().min(-180).max(180),
    maxLat: z.coerce.number().min(-90).max(90),
    zoom: z.coerce.number().min(0).max(22).default(5),
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

const parseCategories = (raw: string | undefined): NewsCategory[] | undefined => {
  const categories = raw
    ?.split(',')
    .map((value) => value.trim())
    .filter(isNewsCategory)
  return categories && categories.length > 0 ? categories : undefined
}

const clusterArticlesSchema = z.object({
  longitude: z.coerce.number().min(-180).max(180),
  latitude: z.coerce.number().min(-90).max(90),
  radius: z.coerce.number().min(100).max(500000).default(5000),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  hours: z.coerce.number().int().min(1).max(72).default(24),
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

    const categories = parseCategories(parsed.data.categories)

    const viewport: ViewportQuery = {
      minLng: parsed.data.minLng,
      minLat: parsed.data.minLat,
      maxLng: parsed.data.maxLng,
      maxLat: parsed.data.maxLat,
      hours: parsed.data.hours,
      categories,
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

  getClusteredViewport = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const parsed = clusteredViewportSchema.safeParse(req.query)

    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid clustered viewport query',
        details: parsed.error.flatten(),
      })
      return
    }

    const categories = parseCategories(parsed.data.categories)

    const query: ClusteredViewportQuery = {
      minLng: parsed.data.minLng,
      minLat: parsed.data.minLat,
      maxLng: parsed.data.maxLng,
      maxLat: parsed.data.maxLat,
      zoom: parsed.data.zoom,
      hours: parsed.data.hours,
      categories,
    }

    try {
      const data = await this.service.getClusteredViewport(query)
      res.json(data)
    } catch (error) {
      logger.error({ error }, 'Failed to fetch clustered viewport')
      next(error)
    }
  }

  getRealtimeStats = (_req: Request, res: Response): void => {
    res.json({
      data: this.service.getRealtimeStats(),
    })
  }

  getClusterArticles = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const parsed = clusterArticlesSchema.safeParse(req.query)

    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid cluster articles query',
        details: parsed.error.flatten(),
      })
      return
    }

    try {
      const articles = await this.service.getClusterArticles(
        parsed.data.longitude,
        parsed.data.latitude,
        parsed.data.radius,
        parsed.data.limit,
        parsed.data.hours,
      )

      res.json({ data: articles })
    } catch (error) {
      logger.error({ error }, 'Failed to fetch cluster articles')
      next(error)
    }
  }
}
