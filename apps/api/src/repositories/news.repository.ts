import { getPgPool } from '../config/db.js'
import { logger } from '../config/logger.js'
import {
  type CreateNewsItemInput,
  type IngestionRunInput,
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

type HeadlineRow = {
  headline: string
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

const INSERT_NEWS_ITEM_SQL = `
  INSERT INTO news_items (
    source_url,
    headline,
    summary,
    category,
    location_name,
    city,
    state,
    is_national,
    geom,
    published_at
  )
  VALUES (
    $1,
    $2,
    $3,
    $4,
    $5,
    $6,
    $7,
    $8,
    CASE
      WHEN $9::double precision IS NULL OR $10::double precision IS NULL THEN NULL
      ELSE ST_SetSRID(ST_MakePoint($10::double precision, $9::double precision), 4326)::geography
    END,
    $11::timestamptz
  )
  ON CONFLICT (source_url) DO NOTHING
  RETURNING
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
    published_at;
`

const RECENT_HEADLINES_SQL = `
  SELECT headline
  FROM news_items
  WHERE published_at >= NOW() - make_interval(hours => $1::int)
  ORDER BY published_at DESC
  LIMIT $2::int;
`

const INSERT_INGESTION_RUN_SQL = `
  INSERT INTO ingestion_runs (
    feed_url,
    decision_path,
    status,
    error_message,
    started_at,
    finished_at
  )
  VALUES ($1, $2, $3, $4, $5, $6);
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

const mapRowToNewsItem = (row: NewsRow): NewsItem => {
  return {
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
  }
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

      let mapped = result.rows.map<NewsItem>(mapRowToNewsItem)

      if (viewport.categories && viewport.categories.length > 0) {
        mapped = mapped.filter((item) => viewport.categories?.includes(item.category))
      }

      return mapped
    } catch (error) {
      logger.warn({ error }, 'Viewport news query failed; returning empty response')
      return []
    }
  }

  async findRecentHeadlines(hours = 24, limit = 500): Promise<string[]> {
    try {
      const result = await getPgPool().query<HeadlineRow>(RECENT_HEADLINES_SQL, [
        hours,
        limit,
      ])

      return result.rows.map((row) => row.headline)
    } catch (error) {
      logger.warn({ error }, 'Failed to fetch recent headlines for dedupe cache')
      return []
    }
  }

  async createNewsItem(input: CreateNewsItemInput): Promise<NewsItem | null> {
    try {
      const result = await getPgPool().query<NewsRow>(INSERT_NEWS_ITEM_SQL, [
        input.sourceUrl,
        input.headline,
        input.summary,
        input.category,
        input.locationName,
        input.city,
        input.state,
        input.isNational,
        input.latitude,
        input.longitude,
        input.publishedAt,
      ])

      const row = result.rows[0]
      return row ? mapRowToNewsItem(row) : null
    } catch (error) {
      logger.error(
        { error, sourceUrl: input.sourceUrl },
        'Failed to insert news item',
      )

      return null
    }
  }

  async recordIngestionRun(input: IngestionRunInput): Promise<void> {
    const startedAt = input.startedAt ?? new Date()
    const finishedAt = input.finishedAt ?? new Date()

    try {
      await getPgPool().query(INSERT_INGESTION_RUN_SQL, [
        input.feedUrl,
        input.decisionPath,
        input.status,
        input.errorMessage ?? null,
        startedAt,
        finishedAt,
      ])
    } catch (error) {
      logger.warn(
        { error, feedUrl: input.feedUrl },
        'Failed to record ingestion run metadata',
      )
    }
  }
}

export const newsRepository = new NewsRepository()
