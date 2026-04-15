import { eq, sql, and, desc, gte } from 'drizzle-orm'

import { getDb } from '../config/db.js'
import { logger } from '../config/logger.js'
import {
  newsItems,
  newsItemLocations,
  ingestionRuns,
} from '../db/schema.js'
import {
  type ClusteredViewportQuery,
  type CreateNewsItemInput,
  type CreateNewsItemResult,
  type IngestionRunInput,
  isNewsCategory,
  type MapCluster,
  type MapFeature,
  type MapMarker,
  type NationalItem,
  type NewsCategory,
  type NewsItemLocation,
  type ViewportQuery,
} from '../types/news.js'

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

export class NewsRepository {
  async findByViewport(viewport: ViewportQuery): Promise<MapMarker[]> {
    try {
      const result = await getDb().execute(sql`
        SELECT
          l.id,
          n.id AS news_item_id,
          n.headline,
          n.summary,
          n.source_url,
          l.location_name,
          l.city,
          l.state,
          n.category,
          CASE WHEN l.geom IS NULL THEN NULL ELSE ST_Y(l.geom::geometry)::text END AS latitude,
          CASE WHEN l.geom IS NULL THEN NULL ELSE ST_X(l.geom::geometry)::text END AS longitude,
          n.is_national,
          n.published_at,
          (SELECT json_agg(DISTINCT l2.city) FROM ${newsItemLocations} l2 WHERE l2.news_item_id = n.id AND l2.city IS NOT NULL) AS cities_json
        FROM ${newsItemLocations} l
        JOIN ${newsItems} n ON n.id = l.news_item_id
        WHERE n.published_at >= NOW() - make_interval(hours => ${viewport.hours}::int)
          AND l.geom IS NOT NULL
          AND l.geom && ST_MakeEnvelope(${viewport.minLng}, ${viewport.minLat}, ${viewport.maxLng}, ${viewport.maxLat}, 4326)
        ORDER BY n.published_at DESC
        LIMIT 300
      `)

      let mapped = result.rows.map((row): MapMarker => ({
        id: row.id as string,
        newsItemId: row.news_item_id as string,
        cities: (row.cities_json as string[] | null)?.filter((c): c is string => c !== null) ?? [],
        headline: row.headline as string,
        summary: row.summary as string,
        sourceUrl: row.source_url as string,
        city: row.city as string | null,
        state: row.state as string | null,
        category: normalizeCategory(row.category as string, row.is_national as boolean),
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        publishedAt: new Date(row.published_at as string).toISOString(),
        isCluster: false,
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

  async findRecentHeadlines(hours = 24, limit = 500): Promise<string[]> {
    try {
      const result = await getDb()
        .select({ headline: newsItems.headline })
        .from(newsItems)
        .where(
          gte(
            newsItems.publishedAt,
            sql`NOW() - make_interval(hours => ${hours}::int)`,
          ),
        )
        .orderBy(desc(newsItems.publishedAt))
        .limit(limit)

      return result.map((row) => row.headline)
    } catch (error) {
      logger.warn({ error }, 'Failed to fetch recent headlines for dedupe cache')
      return []
    }
  }

  async createNewsItem(input: CreateNewsItemInput): Promise<CreateNewsItemResult | null> {
    try {
      return await getDb().transaction(async (tx) => {
        const [itemRow] = await tx
          .insert(newsItems)
          .values({
            sourceUrl: input.sourceUrl,
            headline: input.headline,
            summary: input.summary,
            category: input.category,
            isNational: input.isNational,
            publishedAt: new Date(input.publishedAt),
          })
          .onConflictDoNothing()
          .returning()

        if (!itemRow) {
          return null
        }

        const locations: NewsItemLocation[] = []

        for (const loc of input.locations) {
          const geomSql =
            loc.latitude != null && loc.longitude != null
              ? sql`ST_SetSRID(ST_MakePoint(${loc.longitude}::double precision, ${loc.latitude}::double precision), 4326)::geography`
              : sql`NULL`

          const locRows = await tx.execute(sql`
            INSERT INTO ${newsItemLocations} (news_item_id, location_name, city, state, is_primary, geom)
            VALUES (${itemRow.id}, ${loc.locationName ?? null}, ${loc.city ?? null}, ${loc.state ?? null}, ${loc.isPrimary}, ${geomSql})
            RETURNING
              id,
              news_item_id AS "newsItemId",
              location_name AS "locationName",
              city,
              state,
              is_primary AS "isPrimary",
              CASE WHEN geom IS NULL THEN NULL ELSE ST_Y(geom::geometry)::text END AS latitude,
              CASE WHEN geom IS NULL THEN NULL ELSE ST_X(geom::geometry)::text END AS longitude
          `)

          const row = locRows.rows[0]
          if (row) {
            locations.push({
              id: row.id as string,
              newsItemId: row.newsItemId as string,
              locationName: row.locationName as string | null,
              city: row.city as string | null,
              state: row.state as string | null,
              isPrimary: row.isPrimary as boolean,
              latitude: row.latitude != null ? Number(row.latitude) : null,
              longitude: row.longitude != null ? Number(row.longitude) : null,
            })
          }
        }

        return {
          item: {
            id: itemRow.id,
            headline: itemRow.headline,
            summary: itemRow.summary,
            sourceUrl: itemRow.sourceUrl,
            category: normalizeCategory(itemRow.category, itemRow.isNational),
            isNational: itemRow.isNational,
            publishedAt: itemRow.publishedAt.toISOString(),
          },
          locations,
        }
      })
    } catch (error) {
      logger.error(
        { error, sourceUrl: input.sourceUrl },
        'Failed to insert news item with locations',
      )
      return null
    }
  }

  async recordIngestionRun(input: IngestionRunInput): Promise<void> {
    try {
      await getDb().insert(ingestionRuns).values({
        feedUrl: input.feedUrl,
        decisionPath: input.decisionPath,
        status: input.status,
        errorMessage: input.errorMessage ?? null,
        startedAt: input.startedAt ?? new Date(),
        finishedAt: input.finishedAt ?? new Date(),
      })
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
    nationalItems: NationalItem[]
  }> {
    const { zoom, ...viewport } = query
    const gridSize = this.getGridSize(zoom)
    const shouldCluster = zoom < 10

    const features: MapFeature[] = []

    try {
      if (shouldCluster) {
        const result = await getDb().execute(sql`
          SELECT
            ST_Y(ST_Centroid(ST_Collect(l.geom::geometry)))::double precision AS latitude,
            ST_X(ST_Centroid(ST_Collect(l.geom::geometry)))::double precision AS longitude,
            COUNT(*)::int AS count,
            json_agg(DISTINCT n.category) AS categories_json
          FROM ${newsItemLocations} l
          JOIN ${newsItems} n ON n.id = l.news_item_id
          WHERE n.published_at >= NOW() - make_interval(hours => ${viewport.hours}::int)
            AND n.is_national = FALSE
            AND l.geom IS NOT NULL
            AND l.geom && ST_MakeEnvelope(${viewport.minLng}, ${viewport.minLat}, ${viewport.maxLng}, ${viewport.maxLat}, 4326)
          GROUP BY ST_SnapToGrid(l.geom::geometry, ${gridSize}::double precision)
          ORDER BY count DESC
          LIMIT 500
        `)

        for (const row of result.rows) {
          const rawCategories = row.categories_json as string[] | null
          const validCategories = (rawCategories ?? []).filter(isNewsCategory)

          if ((row.count as number) === 1 && validCategories.length === 1) {
            features.push({
              id: `marker-${Number(row.latitude).toFixed(4)}-${Number(row.longitude).toFixed(4)}`,
              newsItemId: '',
              cities: [],
              latitude: row.latitude as number,
              longitude: row.longitude as number,
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
              id: `cluster-${Number(row.latitude).toFixed(4)}-${Number(row.longitude).toFixed(4)}`,
              latitude: row.latitude as number,
              longitude: row.longitude as number,
              count: row.count as number,
              topCategories: validCategories.slice(0, 3),
              isCluster: true,
            } satisfies MapCluster)
          }
        }
      } else {
        const result = await getDb().execute(sql`
          SELECT
            l.id,
            n.id AS news_item_id,
            n.headline,
            n.summary,
            n.source_url,
            l.location_name,
            l.city,
            l.state,
            n.category,
            ST_Y(l.geom::geometry)::double precision AS latitude,
            ST_X(l.geom::geometry)::double precision AS longitude,
            n.is_national,
            n.published_at,
            (SELECT json_agg(DISTINCT l2.city) FROM ${newsItemLocations} l2 WHERE l2.news_item_id = n.id AND l2.city IS NOT NULL) AS cities_json
          FROM ${newsItemLocations} l
          JOIN ${newsItems} n ON n.id = l.news_item_id
          WHERE n.published_at >= NOW() - make_interval(hours => ${viewport.hours}::int)
            AND n.is_national = FALSE
            AND l.geom IS NOT NULL
            AND l.geom && ST_MakeEnvelope(${viewport.minLng}, ${viewport.minLat}, ${viewport.maxLng}, ${viewport.maxLat}, 4326)
          ORDER BY n.published_at DESC
          LIMIT 500
        `)

        for (const row of result.rows) {
          features.push({
            id: row.id as string,
            newsItemId: row.news_item_id as string,
            cities: (row.cities_json as string[] | null)?.filter((c): c is string => c !== null) ?? [],
            headline: row.headline as string,
            summary: row.summary as string,
            sourceUrl: row.source_url as string,
            city: row.city as string | null,
            state: row.state as string | null,
            category: normalizeCategory(row.category as string, row.is_national as boolean),
            latitude: row.latitude as number,
            longitude: row.longitude as number,
            publishedAt: new Date(row.published_at as string).toISOString(),
            isCluster: false,
          })
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

    let nationalItems: NationalItem[] = []

    try {
      const nationalResult = await getDb()
        .select()
        .from(newsItems)
        .where(
          and(
            eq(newsItems.isNational, true),
            gte(
              newsItems.publishedAt,
              sql`NOW() - make_interval(hours => ${viewport.hours}::int)`,
            ),
          ),
        )
        .orderBy(desc(newsItems.publishedAt))
        .limit(100)

      nationalItems = nationalResult.map((row) => ({
        id: row.id,
        headline: row.headline,
        summary: row.summary,
        sourceUrl: row.sourceUrl,
        category: normalizeCategory(row.category, row.isNational),
        publishedAt: row.publishedAt.toISOString(),
      }))

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
  ): Promise<MapMarker[]> {
    try {
      const result = await getDb().execute(sql`
        SELECT
          l.id,
          n.id AS news_item_id,
          n.headline,
          n.summary,
          n.source_url,
          l.location_name,
          l.city,
          l.state,
          n.category,
          ST_Y(l.geom::geometry)::double precision AS latitude,
          ST_X(l.geom::geometry)::double precision AS longitude,
          n.is_national,
          n.published_at,
          (SELECT json_agg(DISTINCT l2.city) FROM ${newsItemLocations} l2 WHERE l2.news_item_id = n.id AND l2.city IS NOT NULL) AS cities_json
        FROM ${newsItemLocations} l
        JOIN ${newsItems} n ON n.id = l.news_item_id
        WHERE n.published_at >= NOW() - make_interval(hours => ${hours}::int)
          AND n.is_national = FALSE
          AND l.geom IS NOT NULL
          AND ST_DWithin(l.geom, ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography, ${radiusMeters}::double precision)
        ORDER BY n.published_at DESC
        LIMIT ${limit}::int
      `)

      return result.rows.map((row): MapMarker => ({
        id: row.id as string,
        newsItemId: row.news_item_id as string,
        cities: (row.cities_json as string[] | null)?.filter((c): c is string => c !== null) ?? [],
        headline: row.headline as string,
        summary: row.summary as string,
        sourceUrl: row.source_url as string,
        city: row.city as string | null,
        state: row.state as string | null,
        category: normalizeCategory(row.category as string, row.is_national as boolean),
        latitude: row.latitude as number,
        longitude: row.longitude as number,
        publishedAt: new Date(row.published_at as string).toISOString(),
        isCluster: false,
      }))
    } catch (error) {
      logger.warn({ error }, 'Cluster articles query failed')
      return []
    }
  }
}

export const newsRepository = new NewsRepository()
