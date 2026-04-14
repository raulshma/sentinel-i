import { getPgPool } from '../config/db.js'
import { logger } from '../config/logger.js'
import {
  isNewsCategory,
  type NewsCategory,
  type NewsItem,
  type ViewportQuery,
} from '../types/news.js'

type NewsRow = {
  id: string
  headline: string
  summary: string
  source_url: string
  location_name: string | null
  city: string | null
  state: string | null
  category: string
  latitude: string | null
  longitude: string | null
  is_national: boolean
  published_at: Date
}

const VIEWPORT_SQL = `
  SELECT
    id,
    headline,
    summary,
    source_url,
    location_name,
    city,
    state,
    category,
    CASE WHEN geom IS NULL THEN NULL ELSE ST_Y(geom::geometry)::text END AS latitude,
    CASE WHEN geom IS NULL THEN NULL ELSE ST_X(geom::geometry)::text END AS longitude,
    is_national,
    published_at
  FROM news_items
  WHERE published_at >= NOW() - make_interval(hours => $5::int)
    AND (
      is_national = TRUE
      OR geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
    )
  ORDER BY published_at DESC
  LIMIT 300;
`

const normalizeCategory = (
  category: string,
  isNational: boolean,
): NewsCategory => {
  if (isNational) {
    return 'Uncategorized / National'
  }

  if (isNewsCategory(category)) {
    return category
  }

  return 'General'
}

const parseCoordinate = (value: string | null): number | null => {
  if (value === null) {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export class NewsRepository {
  async findByViewport(viewport: ViewportQuery): Promise<NewsItem[]> {
    try {
      const result = await getPgPool().query<NewsRow>(VIEWPORT_SQL, [
        viewport.minLng,
        viewport.minLat,
        viewport.maxLng,
        viewport.maxLat,
        viewport.hours,
      ])

      let mapped = result.rows.map<NewsItem>((row) => ({
        id: row.id,
        headline: row.headline,
        summary: row.summary,
        sourceUrl: row.source_url,
        locationName: row.location_name,
        city: row.city,
        state: row.state,
        category: normalizeCategory(row.category, row.is_national),
        latitude: parseCoordinate(row.latitude),
        longitude: parseCoordinate(row.longitude),
        isNational: row.is_national,
        publishedAt: row.published_at.toISOString(),
      }))

      if (viewport.categories && viewport.categories.length > 0) {
        mapped = mapped.filter((item) => viewport.categories?.includes(item.category))
      }

      return mapped
    } catch (error) {
      logger.warn({ error }, 'Viewport news query failed; returning empty response')
      return []
    }
  }
}

export const newsRepository = new NewsRepository()
