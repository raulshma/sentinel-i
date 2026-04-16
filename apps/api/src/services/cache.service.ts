import { getValkey, withValkeyCommandTimeout } from "../config/valkey.js";
import { logger } from "../config/logger.js";
import type { DuplicateCheckResult } from "../types/news.js";
import { canonicalizeArticleUrl } from "../utils/articleUrl.js";

const CACHE_PREFIX = "sentinel:cache:";
const DEDUPE_PREFIX = "sentinel:dedupe:";
const VIEWPORT_TTL_SECONDS = 120;
const DEDUPE_TTL_SECONDS = 900;

export class CacheService {
  private get valkey() {
    return getValkey();
  }

  private normalizeSourceUrlForDedupe(sourceUrl: string): string {
    const canonical = canonicalizeArticleUrl(sourceUrl);

    if (canonical) {
      return canonical;
    }

    return sourceUrl.toLowerCase().trim();
  }

  private runValkeyCommand<T>(
    operation: string,
    execute: () => Promise<T>,
  ): Promise<T> {
    return withValkeyCommandTimeout(`cache_${operation}`, execute);
  }

  private viewportKey(query: Record<string, unknown>): string {
    const sorted = JSON.stringify(
      Object.entries(query).sort(([a], [b]) => a.localeCompare(b)),
    );
    return `${CACHE_PREFIX}viewport:${Buffer.from(sorted).toString("base64url")}`;
  }

  async getViewport<T>(query: Record<string, unknown>): Promise<T | null> {
    try {
      const key = this.viewportKey(query);
      const cached = await this.runValkeyCommand("get_viewport", () =>
        this.valkey.get(key),
      );

      if (cached) {
        return JSON.parse(cached) as T;
      }
    } catch (error) {
      logger.warn({ error }, "Cache read failed for viewport query");
    }

    return null;
  }

  async setViewport<T>(
    query: Record<string, unknown>,
    data: T,
    ttlSeconds = VIEWPORT_TTL_SECONDS,
  ): Promise<void> {
    try {
      const key = this.viewportKey(query);
      await this.runValkeyCommand("set_viewport", () =>
        this.valkey.setex(key, ttlSeconds, JSON.stringify(data)),
      );
    } catch (error) {
      logger.warn({ error }, "Cache write failed for viewport query");
    }
  }

  async invalidateViewport(): Promise<void> {
    try {
      let deletedKeysCount = 0;

      await this.runValkeyCommand("invalidate_viewport", async () => {
        const stream = this.valkey.scanStream({
          match: `${CACHE_PREFIX}viewport:*`,
          count: 100,
        }) as AsyncIterable<string[]>;

        for await (const scannedKeys of stream) {
          if (scannedKeys.length === 0) {
            continue;
          }

          deletedKeysCount += await this.runValkeyCommand(
            "unlink_viewport_batch",
            () => this.valkey.unlink(...scannedKeys),
          );
        }
      });

      logger.debug(
        { deletedKeysCount },
        "Viewport cache invalidation completed",
      );
    } catch (error) {
      logger.warn({ error }, "Cache invalidation failed for viewport keys");
    }
  }

  async isDuplicate(sourceUrl: string): Promise<DuplicateCheckResult> {
    try {
      const normalizedUrl = this.normalizeSourceUrlForDedupe(sourceUrl);
      const key = `${DEDUPE_PREFIX}${Buffer.from(normalizedUrl).toString("base64url")}`;
      const exists = await this.runValkeyCommand("exists_dedupe", () =>
        this.valkey.exists(key),
      );
      return exists === 1 ? "duplicate" : "not_duplicate";
    } catch (error) {
      logger.warn(
        { error, sourceUrl },
        "Dedupe cache read failed; duplicate check unavailable",
      );
      return "check_failed";
    }
  }

  async markProcessed(sourceUrl: string): Promise<void> {
    try {
      const normalizedUrl = this.normalizeSourceUrlForDedupe(sourceUrl);
      const key = `${DEDUPE_PREFIX}${Buffer.from(normalizedUrl).toString("base64url")}`;
      await this.runValkeyCommand("set_dedupe", () =>
        this.valkey.setex(key, DEDUPE_TTL_SECONDS, "1"),
      );
    } catch (error) {
      logger.warn({ error }, "Dedupe cache write failed");
    }
  }
}

export const cacheService = new CacheService();
