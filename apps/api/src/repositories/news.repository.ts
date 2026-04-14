import { getPgPool } from '../config/db.js'
import { logger } from '../config/logger.js'
import {
  type ClusteredViewportQuery,
  type CreateNewsItemInput,
  type IngestionRunInput,
  isNewsCategory,
  type MapCluster,
  type MapFeature,
  type MapMarker,
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

const CLUSTER_GRID_SQL = `
  SELECT
    ST_Y(ST_Centroid(ST_Collect(geom::geometry)))::double precision AS latitude,
    ST_X(ST_Centroid(ST_Collect(geom::geometry)))::double precision AS longitude,
    COUNT(*)::int AS count,
    json_agg(DISTINCT category) AS categories_json
  FROM news_items
  WHERE published_at >= NOW() - make_interval(hours => $5::int)
    AND is_national = FALSE
    AND geom IS NOT NULL
    AND geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
  GROUP BY ST_SnapToGrid(geom::geometry, $6::double precision)
  ORDER BY count DESC
  LIMIT 500;
`

const CLUSTER_INDIVIDUAL_SQL = `
  SELECT
    id,
    headline,
    summary,
    source_url,
    location_name,
    city,
    state,
    category,
    ST_Y(geom::geometry)::double precision AS latitude,
    ST_X(geom::geometry)::double precision AS longitude,
    is_national,
    published_at
  FROM news_items
  WHERE published_at >= NOW() - make_interval(hours => $5::int)
    AND is_national = FALSE
    AND geom IS NOT NULL
    AND geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
  ORDER BY published_at DESC
  LIMIT 500;
`

const NATIONAL_ITEMS_SQL = `
  SELECT
    id,
    headline,
    summary,
    source_url,
    location_name,
    city,
    state,
    category,
    NULL::double precision AS latitude,
    NULL::double precision AS longitude,
    is_national,
    published_at
  FROM news_items
  WHERE published_at >= NOW() - make_interval(hours => $1::int)
    AND is_national = TRUE
  ORDER BY published_at DESC
  LIMIT 100;
`

const CLUSTER_ARTICLES_SQL = `
  SELECT
    id,
    headline,
    summary,
    source_url,
    location_name,
    city,
    state,
    category,
    ST_Y(geom::geometry)::double precision AS latitude,
    ST_X(geom::geometry)::double precision AS longitude,
    is_national,
    published_at
  FROM news_items
  WHERE published_at >= NOW() - make_interval(hours => $5::int)
    AND is_national = FALSE
    AND geom IS NOT NULL
    AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3::double precision)
  ORDER BY published_at DESC
  LIMIT $4::int;
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

  private getGridSize(zoom: number): number {
    if (zoom <= 4) return 3.0
    if (zoom <= 6) return 1.5
    if (zoom <= 8) return 0.8
    if (zoom <= 10) return 0.3
    return 0.1
  }

  async findClusteredViewport(query: ClusteredViewportQuery): Promise<{
    features: MapFeature[]
    nationalItems: NewsItem[]
  }> {
    const { zoom, ...viewport } = query
    const gridSize = this.getGridSize(zoom)
    const shouldCluster = zoom < 10

    const features: MapFeature[] = []

    try {
      if (shouldCluster) {
        const result = await getPgPool().query<{
          latitude: number
          longitude: number
          count: number
          categories_json: string[]
        }>(CLUSTER_GRID_SQL, [
          viewport.minLng,
          viewport.minLat,
          viewport.maxLng,
          viewport.maxLat,
          viewport.hours,
          gridSize,
        ])

        for (const row of result.rows) {
          const validCategories = (row.categories_json ?? []).filter(isNewsCategory)

          if (row.count === 1 && validCategories.length === 1) {
            features.push({
              id: `marker-${row.latitude.toFixed(4)}-${row.longitude.toFixed(4)}`,
              latitude: row.latitude,
              longitude: row.longitude,
              category: validCategories[0] ?? 'General',
              headline: '',
              summary: '',
              sourceUrl: '',
              city: null,
              state: null,
              publishedAt: new Date().toISOString(),
              isCluster: false,
            } satisfies MapMarker)
          } else {
            features.push({
              id: `cluster-${row.latitude.toFixed(4)}-${row.longitude.toFixed(4)}`,
              latitude: row.latitude,
              longitude: row.longitude,
              count: row.count,
              topCategories: validCategories.slice(0, 3),
              isCluster: true,
            } satisfies MapCluster)
          }
        }
      } else {
        const result = await getPgPool().query<NewsRow>(CLUSTER_INDIVIDUAL_SQL, [
          viewport.minLng,
          viewport.minLat,
          viewport.maxLng,
          viewport.maxLat,
          viewport.hours,
        ])

        for (const row of result.rows) {
          features.push({
            id: row.id,
            latitude: Number(row.latitude),
            longitude: Number(row.longitude),
            category: normalizeCategory(row.category, row.is_national),
            headline: row.headline,
            summary: row.summary,
            sourceUrl: row.source_url,
            city: row.city,
            state: row.state,
            publishedAt: row.published_at.toISOString(),
            isCluster: false,
          } satisfies MapMarker)
        }
      }
    } catch (error) {
      logger.warn({ error }, 'Clustered viewport query failed; returning empty features')
    }

    if (viewport.categories && viewport.categories.length > 0) {
      const categorySet = new Set(viewport.categories)
      const filtered = features.filter((f) => {
        if (f.isCluster) {
          return f.topCategories.some((c) => categorySet.has(c))
        }
        return categorySet.has(f.category)
      })
      features.length = 0
      features.push(...filtered)
    }

    let nationalItems: NewsItem[] = []

    try {
      const nationalResult = await getPgPool().query<NewsRow>(NATIONAL_ITEMS_SQL, [
        viewport.hours,
      ])

      nationalItems = nationalResult.rows.map(mapRowToNewsItem)

      if (viewport.categories && viewport.categories.length > 0) {
        nationalItems = nationalItems.filter((item) =>
          viewport.categories?.includes(item.category),
        )
      }
    } catch (error) {
      logger.warn({ error }, 'National items query failed')
    }

    return { features, nationalItems }
  }

  async findClusterArticles(
    longitude: number,
    latitude: number,
    radiusMeters: number,
    limit: number,
    hours: number,
  ): Promise<NewsItem[]> {
    try {
      const result = await getPgPool().query<NewsRow>(CLUSTER_ARTICLES_SQL, [
        longitude,
        latitude,
        radiusMeters,
        limit,
        hours,
      ])

      return result.rows.map(mapRowToNewsItem)
    } catch (error) {
      logger.warn({ error }, 'Cluster articles query failed')
      return []
    }
  }
}

export const newsRepository = new NewsRepository()
