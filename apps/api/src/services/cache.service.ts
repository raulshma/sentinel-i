import { getRedis } from '../config/redis.js'
import { logger } from '../config/logger.js'

const CACHE_PREFIX = 'sentinel:cache:'
const DEDUPE_PREFIX = 'sentinel:dedupe:'
const VIEWPORT_TTL_SECONDS = 120
const DEDUPE_TTL_SECONDS = 900

export class CacheService {
  private get redis() {
    return getRedis()
  }

  private viewportKey(query: Record<string, unknown>): string {
    const sorted = JSON.stringify(
      Object.entries(query).sort(([a], [b]) => a.localeCompare(b)),
    )
    return `${CACHE_PREFIX}viewport:${Buffer.from(sorted).toString('base64url')}`
  }

  async getViewport<T>(query: Record<string, unknown>): Promise<T | null> {
    try {
      const key = this.viewportKey(query)
      const cached = await this.redis.get(key)

      if (cached) {
        return JSON.parse(cached) as T
      }
    } catch (error) {
      logger.warn({ error }, 'Cache read failed for viewport query')
    }

    return null
  }

  async setViewport<T>(
    query: Record<string, unknown>,
    data: T,
    ttlSeconds = VIEWPORT_TTL_SECONDS,
  ): Promise<void> {
    try {
      const key = this.viewportKey(query)
      await this.redis.setex(key, ttlSeconds, JSON.stringify(data))
    } catch (error) {
      logger.warn({ error }, 'Cache write failed for viewport query')
    }
  }

  async invalidateViewport(): Promise<void> {
    try {
      const stream = this.redis.scanStream({
        match: `${CACHE_PREFIX}viewport:*`,
        count: 100,
      })

      const keys: string[] = []

      stream.on('data', (resultKeys: string[]) => {
        keys.push(...resultKeys)
      })

      await new Promise<void>((resolve, reject) => {
        stream.on('end', () => {
          if (keys.length > 0) {
            void this.redis.del(...keys)
          }
          resolve()
        })
        stream.on('error', reject)
      })
    } catch (error) {
      logger.warn({ error }, 'Cache invalidation failed for viewport keys')
    }
  }

  async isDuplicate(sourceUrl: string): Promise<boolean> {
    try {
      const normalizedUrl = sourceUrl.toLowerCase().trim()
      const key = `${DEDUPE_PREFIX}${Buffer.from(normalizedUrl).toString('base64url')}`
      const exists = await this.redis.exists(key)
      return exists === 1
    } catch (error) {
      logger.warn({ error }, 'Dedupe cache read failed')
      return false
    }
  }

  async markProcessed(sourceUrl: string): Promise<void> {
    try {
      const normalizedUrl = sourceUrl.toLowerCase().trim()
      const key = `${DEDUPE_PREFIX}${Buffer.from(normalizedUrl).toString('base64url')}`
      await this.redis.setex(key, DEDUPE_TTL_SECONDS, '1')
    } catch (error) {
      logger.warn({ error }, 'Dedupe cache write failed')
    }
  }
}

export const cacheService = new CacheService()
