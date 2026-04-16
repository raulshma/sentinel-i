import { eq, sql, and, desc, gte, inArray } from "drizzle-orm";

import { createHash } from "node:crypto";

import { getDb } from "../config/db.js";
import { logger } from "../config/logger.js";
import { newsItems, newsItemLocations, ingestionRuns } from "../db/schema.js";
import { canonicalizeArticleUrl } from "../utils/articleUrl.js";
import {
  type ClusteredViewportQuery,
  type CreateNewsItemInput,
  type CreateNewsItemResult,
  type DuplicateCheckResult,
  type IngestionRunInput,
  isNewsCategory,
  type MapCluster,
  type MapFeature,
  type MapMarker,
  type NationalItem,
  type NewsCategory,
  type NewsItemLocation,
  type ViewportQuery,
} from "../types/news.js";

const normalizeCategory = (
  category: string,
  isNational: boolean,
): NewsCategory => {
  if (isNational) {
    return "Uncategorized / National";
  }

  if (isNewsCategory(category)) {
    return category;
  }

  return "General";
};

export class NewsRepository {
  static computeContentHash(headline: string, sourceUrl: string): string {
    const canonicalSourceUrl =
      canonicalizeArticleUrl(sourceUrl) ?? sourceUrl.trim();
    const normalized = `${headline.toLowerCase().trim()}|${canonicalSourceUrl}`;
    return createHash("sha256").update(normalized).digest("hex");
  }

  async existsByContentHash(
    contentHash: string,
  ): Promise<DuplicateCheckResult> {
    try {
      const result = await getDb()
        .select({ id: newsItems.id })
        .from(newsItems)
        .where(eq(newsItems.contentHash, contentHash))
        .limit(1);

      return result.length > 0 ? "duplicate" : "not_duplicate";
    } catch (error) {
      logger.warn(
        { error, contentHash },
        "Content hash lookup failed; duplicate check unavailable",
      );
      return "check_failed";
    }
  }

  async findByViewport(viewport: ViewportQuery): Promise<MapMarker[]> {
    try {
      const result = await getDb().execute(sql`
        SELECT
          n.id,
          n.id AS news_item_id,
          n.headline,
          n.summary,
          n.source_url,
          l_primary.location_name,
          l_primary.city,
          l_primary.state,
          n.category,
          ST_Y(l_primary.geom::geometry)::double precision AS latitude,
          ST_X(l_primary.geom::geometry)::double precision AS longitude,
          n.is_national,
          n.published_at,
          (SELECT json_agg(DISTINCT l2.city) FROM ${newsItemLocations} l2 WHERE l2.news_item_id = n.id AND l2.city IS NOT NULL) AS cities_json
        FROM ${newsItems} n
        JOIN LATERAL (
          SELECT l.location_name, l.city, l.state, l.geom
          FROM ${newsItemLocations} l
          WHERE l.news_item_id = n.id
            AND l.geom IS NOT NULL
            AND l.geom && ST_MakeEnvelope(${viewport.minLng}, ${viewport.minLat}, ${viewport.maxLng}, ${viewport.maxLat}, 4326)
          ORDER BY l.is_primary DESC
          LIMIT 1
        ) l_primary ON TRUE
        WHERE n.published_at >= NOW() - make_interval(hours => ${viewport.hours}::int)
          AND n.is_national = FALSE
          AND EXISTS (
            SELECT 1 FROM ${newsItemLocations} l3
            WHERE l3.news_item_id = n.id
              AND l3.geom IS NOT NULL
              AND l3.geom && ST_MakeEnvelope(${viewport.minLng}, ${viewport.minLat}, ${viewport.maxLng}, ${viewport.maxLat}, 4326)
          )
        ORDER BY n.published_at DESC
        LIMIT 300
      `);

      let mapped = result.rows.map(
        (row): MapMarker => ({
          id: row.news_item_id as string,
          newsItemId: row.news_item_id as string,
          cities:
            (row.cities_json as string[] | null)?.filter(
              (c): c is string => c !== null,
            ) ?? [],
          headline: row.headline as string,
          summary: row.summary as string,
          sourceUrl: row.source_url as string,
          city: row.city as string | null,
          state: row.state as string | null,
          category: normalizeCategory(
            row.category as string,
            row.is_national as boolean,
          ),
          latitude: Number(row.latitude),
          longitude: Number(row.longitude),
          publishedAt: new Date(row.published_at as string).toISOString(),
          isCluster: false,
        }),
      );

      if (viewport.categories && viewport.categories.length > 0) {
        mapped = mapped.filter((item) =>
          viewport.categories?.includes(item.category),
        );
      }

      return mapped;
    } catch (error) {
      logger.warn(
        { error },
        "Viewport news query failed; returning empty response",
      );
      return [];
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
        .limit(limit);

      return result.map((row) => row.headline);
    } catch (error) {
      logger.warn(
        { error },
        "Failed to fetch recent headlines for dedupe cache",
      );
      return [];
    }
  }

  async createNewsItem(
    input: CreateNewsItemInput,
  ): Promise<CreateNewsItemResult> {
    try {
      return await getDb().transaction(async (tx) => {
        const persistedCategory = normalizeCategory(
          input.category,
          input.isNational,
        );
        const canonicalSourceUrl =
          canonicalizeArticleUrl(input.sourceUrl) ?? input.sourceUrl.trim();

        const [itemRow] = await tx
          .insert(newsItems)
          .values({
            sourceUrl: canonicalSourceUrl,
            headline: input.headline,
            summary: input.summary,
            category: persistedCategory,
            isNational: input.isNational,
            publishedAt: new Date(input.publishedAt),
            contentHash: input.contentHash,
          })
          .onConflictDoNothing()
          .returning();

        if (!itemRow) {
          return { status: "conflict" };
        }

        const locations: NewsItemLocation[] = [];

        if (input.locations.length > 0) {
          const locationValues = sql.join(
            input.locations.map((loc) => {
              const geomSql =
                loc.latitude != null && loc.longitude != null
                  ? sql`ST_SetSRID(ST_MakePoint(${loc.longitude}::double precision, ${loc.latitude}::double precision), 4326)::geography`
                  : sql`NULL`;

              return sql`(${itemRow.id}, ${loc.locationName ?? null}, ${loc.city ?? null}, ${loc.state ?? null}, ${loc.isPrimary}, ${geomSql})`;
            }),
            sql`, `,
          );

          const locRows = await tx.execute(sql`
            INSERT INTO ${newsItemLocations} (news_item_id, location_name, city, state, is_primary, geom)
            VALUES ${locationValues}
            RETURNING
              id,
              news_item_id AS "newsItemId",
              location_name AS "locationName",
              city,
              state,
              is_primary AS "isPrimary",
              CASE WHEN geom IS NULL THEN NULL ELSE ST_Y(geom::geometry)::text END AS latitude,
              CASE WHEN geom IS NULL THEN NULL ELSE ST_X(geom::geometry)::text END AS longitude
          `);

          for (const row of locRows.rows) {
            locations.push({
              id: row.id as string,
              newsItemId: row.newsItemId as string,
              locationName: row.locationName as string | null,
              city: row.city as string | null,
              state: row.state as string | null,
              isPrimary: row.isPrimary as boolean,
              latitude: row.latitude != null ? Number(row.latitude) : null,
              longitude: row.longitude != null ? Number(row.longitude) : null,
            });
          }
        }

        return {
          status: "inserted",
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
        };
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown storage error";

      logger.error(
        { error, sourceUrl: input.sourceUrl },
        "Failed to insert news item with locations",
      );
      return {
        status: "failed",
        errorMessage,
      };
    }
  }

  async recordIngestionRun(input: IngestionRunInput): Promise<void> {
    try {
      await getDb()
        .insert(ingestionRuns)
        .values({
          runId: input.runId,
          jobId: input.jobId,
          traceId: input.traceId,
          feedUrl: input.feedUrl,
          sourceUrl: input.sourceUrl ?? null,
          headline: input.headline ?? null,
          newsItemId: input.newsItemId ?? null,
          step: input.step ?? null,
          decisionPath: input.decisionPath,
          status: input.status,
          errorMessage: input.errorMessage ?? null,
          startedAt: input.startedAt ?? new Date(),
          finishedAt: input.finishedAt ?? new Date(),
        });
    } catch (error) {
      logger.warn(
        { error, feedUrl: input.feedUrl },
        "Failed to record ingestion run metadata",
      );
    }
  }

  private getGridSize(zoom: number): number {
    if (zoom <= 4) return 3.0;
    if (zoom <= 6) return 1.5;
    if (zoom <= 8) return 0.8;
    if (zoom <= 10) return 0.3;
    return 0.1;
  }

  async findClusteredViewport(query: ClusteredViewportQuery): Promise<{
    features: MapFeature[];
    nationalItems: NationalItem[];
  }> {
    const { zoom, ...viewport } = query;
    const gridSize = this.getGridSize(zoom);
    const shouldCluster = zoom < 10;
    const categoryFilterSql =
      viewport.categories && viewport.categories.length > 0
        ? sql`AND n.category IN (${sql.join(
            viewport.categories.map((category) => sql`${category}`),
            sql`, `,
          )})`
        : sql``;

    const features: MapFeature[] = [];

    try {
      if (shouldCluster) {
        const result = await getDb().execute(sql`
          WITH article_points AS (
            SELECT
              n.id AS news_item_id,
              n.category,
              l_primary.geom,
              NULLIF(BTRIM(l_primary.state), '') AS state
            FROM ${newsItems} n
            JOIN LATERAL (
              SELECT l.geom, l.state
              FROM ${newsItemLocations} l
              WHERE l.news_item_id = n.id
                AND l.geom IS NOT NULL
                AND l.geom && ST_MakeEnvelope(${viewport.minLng}, ${viewport.minLat}, ${viewport.maxLng}, ${viewport.maxLat}, 4326)
              ORDER BY l.is_primary DESC, l.id
              LIMIT 1
            ) l_primary ON TRUE
            WHERE n.published_at >= NOW() - make_interval(hours => ${viewport.hours}::int)
              AND n.is_national = FALSE
              ${categoryFilterSql}
          )
          SELECT
            ST_Y(ST_Centroid(ST_Collect(ap.geom::geometry)))::double precision AS latitude,
            ST_X(ST_Centroid(ST_Collect(ap.geom::geometry)))::double precision AS longitude,
            COUNT(*)::int AS count,
            MIN(ap.state) AS state,
            json_agg(DISTINCT ap.category) AS categories_json
          FROM article_points ap
          GROUP BY
            COALESCE(LOWER(ap.state), '__unknown__'),
            ST_SnapToGrid(ap.geom::geometry, ${gridSize}::double precision)
          ORDER BY count DESC
          LIMIT 500
        `);

        for (const row of result.rows) {
          const rawCategories = row.categories_json as string[] | null;
          const validCategories = (rawCategories ?? []).filter(isNewsCategory);
          const clusterState =
            typeof row.state === "string" && row.state.trim().length > 0
              ? row.state.trim()
              : null;
          const stateKey = clusterState
            ? clusterState.toLowerCase().replace(/[^a-z0-9]+/g, "-")
            : "unknown";

          features.push({
            id: `cluster-${stateKey}-${Number(row.latitude).toFixed(4)}-${Number(row.longitude).toFixed(4)}`,
            latitude: row.latitude as number,
            longitude: row.longitude as number,
            count: row.count as number,
            topCategories: validCategories.slice(0, 3),
            state: clusterState,
            isCluster: true,
          } satisfies MapCluster);
        }
      } else {
        const result = await getDb().execute(sql`
          SELECT
            n.id,
            n.id AS news_item_id,
            n.headline,
            n.summary,
            n.source_url,
            l_primary.location_name,
            l_primary.city,
            l_primary.state,
            n.category,
            ST_Y(l_primary.geom::geometry)::double precision AS latitude,
            ST_X(l_primary.geom::geometry)::double precision AS longitude,
            n.is_national,
            n.published_at,
            (SELECT json_agg(DISTINCT l2.city) FROM ${newsItemLocations} l2 WHERE l2.news_item_id = n.id AND l2.city IS NOT NULL) AS cities_json
          FROM ${newsItems} n
          JOIN LATERAL (
            SELECT l.location_name, l.city, l.state, l.geom
            FROM ${newsItemLocations} l
            WHERE l.news_item_id = n.id
              AND l.geom IS NOT NULL
              AND l.geom && ST_MakeEnvelope(${viewport.minLng}, ${viewport.minLat}, ${viewport.maxLng}, ${viewport.maxLat}, 4326)
            ORDER BY l.is_primary DESC
            LIMIT 1
          ) l_primary ON TRUE
          WHERE n.published_at >= NOW() - make_interval(hours => ${viewport.hours}::int)
            AND n.is_national = FALSE
            ${categoryFilterSql}
            AND EXISTS (
              SELECT 1 FROM ${newsItemLocations} l3
              WHERE l3.news_item_id = n.id
                AND l3.geom IS NOT NULL
                AND l3.geom && ST_MakeEnvelope(${viewport.minLng}, ${viewport.minLat}, ${viewport.maxLng}, ${viewport.maxLat}, 4326)
            )
          ORDER BY n.published_at DESC
          LIMIT 500
        `);

        for (const row of result.rows) {
          features.push({
            id: row.news_item_id as string,
            newsItemId: row.news_item_id as string,
            cities:
              (row.cities_json as string[] | null)?.filter(
                (c): c is string => c !== null,
              ) ?? [],
            headline: row.headline as string,
            summary: row.summary as string,
            sourceUrl: row.source_url as string,
            city: row.city as string | null,
            state: row.state as string | null,
            category: normalizeCategory(
              row.category as string,
              row.is_national as boolean,
            ),
            latitude: row.latitude as number,
            longitude: row.longitude as number,
            publishedAt: new Date(row.published_at as string).toISOString(),
            isCluster: false,
          });
        }
      }
    } catch (error) {
      logger.warn(
        { error },
        "Clustered viewport query failed; returning empty features",
      );
    }

    let nationalItems: NationalItem[] = [];

    try {
      const publishedSince = sql`NOW() - make_interval(hours => ${viewport.hours}::int)`;
      const nationalWhere =
        viewport.categories && viewport.categories.length > 0
          ? and(
              eq(newsItems.isNational, true),
              gte(newsItems.publishedAt, publishedSince),
              inArray(newsItems.category, viewport.categories),
            )
          : and(
              eq(newsItems.isNational, true),
              gte(newsItems.publishedAt, publishedSince),
            );

      const nationalResult = await getDb()
        .select()
        .from(newsItems)
        .where(nationalWhere)
        .orderBy(desc(newsItems.publishedAt))
        .limit(100);

      nationalItems = nationalResult.map((row) => ({
        id: row.id,
        headline: row.headline,
        summary: row.summary,
        sourceUrl: row.sourceUrl,
        category: normalizeCategory(row.category, row.isNational),
        publishedAt: row.publishedAt.toISOString(),
      }));
    } catch (error) {
      logger.warn({ error }, "National items query failed");
    }

    return { features, nationalItems };
  }

  async findClusterArticles(
    longitude: number,
    latitude: number,
    radiusMeters: number,
    limit: number,
    hours: number,
    state?: string,
  ): Promise<MapMarker[]> {
    const normalizedState = state?.trim() || null;
    const stateFilterSql = normalizedState
      ? sql`AND LOWER(COALESCE(NULLIF(BTRIM(l.state), ''), '')) = LOWER(${normalizedState})`
      : sql``;
    const stateExistsFilterSql = normalizedState
      ? sql`AND LOWER(COALESCE(NULLIF(BTRIM(l3.state), ''), '')) = LOWER(${normalizedState})`
      : sql``;

    try {
      const result = await getDb().execute(sql`
        SELECT
          n.id,
          n.id AS news_item_id,
          n.headline,
          n.summary,
          n.source_url,
          l_primary.location_name,
          l_primary.city,
          l_primary.state,
          n.category,
          ST_Y(l_primary.geom::geometry)::double precision AS latitude,
          ST_X(l_primary.geom::geometry)::double precision AS longitude,
          n.is_national,
          n.published_at,
          (SELECT json_agg(DISTINCT l2.city) FROM ${newsItemLocations} l2 WHERE l2.news_item_id = n.id AND l2.city IS NOT NULL) AS cities_json
        FROM ${newsItems} n
        JOIN LATERAL (
          SELECT l.location_name, l.city, l.state, l.geom
          FROM ${newsItemLocations} l
          WHERE l.news_item_id = n.id
            AND l.geom IS NOT NULL
            AND ST_DWithin(l.geom, ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography, ${radiusMeters}::double precision)
            ${stateFilterSql}
          ORDER BY l.is_primary DESC
          LIMIT 1
        ) l_primary ON TRUE
        WHERE n.published_at >= NOW() - make_interval(hours => ${hours}::int)
          AND n.is_national = FALSE
          AND EXISTS (
            SELECT 1 FROM ${newsItemLocations} l3
            WHERE l3.news_item_id = n.id
              AND l3.geom IS NOT NULL
              AND ST_DWithin(l3.geom, ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography, ${radiusMeters}::double precision)
              ${stateExistsFilterSql}
          )
        ORDER BY n.published_at DESC
        LIMIT ${limit}::int
      `);

      return result.rows.map(
        (row): MapMarker => ({
          id: row.news_item_id as string,
          newsItemId: row.news_item_id as string,
          cities:
            (row.cities_json as string[] | null)?.filter(
              (c): c is string => c !== null,
            ) ?? [],
          headline: row.headline as string,
          summary: row.summary as string,
          sourceUrl: row.source_url as string,
          city: row.city as string | null,
          state: row.state as string | null,
          category: normalizeCategory(
            row.category as string,
            row.is_national as boolean,
          ),
          latitude: row.latitude as number,
          longitude: row.longitude as number,
          publishedAt: new Date(row.published_at as string).toISOString(),
          isCluster: false,
        }),
      );
    } catch (error) {
      logger.warn({ error }, "Cluster articles query failed");
      return [];
    }
  }

  async findForFeed(
    hours = 24,
    limit = 100,
    categories?: NewsCategory[],
  ): Promise<
    Array<{
      id: string;
      headline: string;
      summary: string;
      sourceUrl: string;
      category: string;
      isNational: boolean;
      publishedAt: Date;
      locations: Array<{ city: string | null; state: string | null }>;
    }>
  > {
    const publishedSince = sql`NOW() - make_interval(hours => ${hours}::int)`;

    const categoryFilterSql =
      categories && categories.length > 0
        ? sql`AND n.category IN (${sql.join(
            categories.map((c) => sql`${c}`),
            sql`, `,
          )})`
        : sql``;

    try {
      const result = await getDb().execute(sql`
        SELECT
          n.id,
          n.headline,
          n.summary,
          n.source_url,
          n.category,
          n.is_national,
          n.published_at,
          (
            SELECT json_build_array(
              json_agg(json_build_object('city', l2.city, 'state', l2.state))
            )
            FROM ${newsItemLocations} l2
            WHERE l2.news_item_id = n.id
          ) AS locations_json
        FROM ${newsItems} n
        WHERE n.published_at >= ${publishedSince}
          ${categoryFilterSql}
        ORDER BY n.published_at DESC
        LIMIT ${limit}::int
      `);

      return result.rows.map((row) => ({
        id: row.id as string,
        headline: row.headline as string,
        summary: row.summary as string,
        sourceUrl: row.source_url as string,
        category: normalizeCategory(
          row.category as string,
          row.is_national as boolean,
        ),
        isNational: row.is_national as boolean,
        publishedAt: new Date(row.published_at as string),
        locations: (
          (
            row.locations_json as Array<Array<{
              city: string | null;
              state: string | null;
            }> | null>
          )?.[0] ?? []
        ).filter(
          (loc): loc is { city: string | null; state: string | null } =>
            loc !== null,
        ),
      }));
    } catch (error) {
      logger.warn({ error }, "RSS feed query failed");
      return [];
    }
  }
}

export const newsRepository = new NewsRepository();
