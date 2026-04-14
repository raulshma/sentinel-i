import { env } from '../config/env.js'
import { logger } from '../config/logger.js'

type FetchStrategyName = 'fetch_crawl4ai' | 'fetch_standard_html'

interface ContentFetchStrategy {
  readonly name: FetchStrategyName
  fetch(url: string): Promise<string | null>
}

export interface FetchArticleContentOutput {
  content: string
  decisionPath: string
  strategyUsed: FetchStrategyName | 'rss' | 'none'
}

interface Crawl4AiResponse {
  content?: unknown
  text?: unknown
  markdown?: unknown
  data?: {
    content?: unknown
    text?: unknown
    markdown?: unknown
  }
}

const MIN_SUMMARY_LENGTH = 220
const MAX_CONTENT_LENGTH = 8_000
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (compatible; Sentinel-I/1.0; +https://example.local/sentinel-i)'

const normalizeWhitespace = (value: string): string => {
  return value.replace(/\s+/g, ' ').trim()
}

const stripHtml = (html: string): string => {
  const withoutScripts = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')

  const withoutTags = withoutScripts.replace(/<[^>]+>/g, ' ')

  const decoded = withoutTags
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')

  return normalizeWhitespace(decoded)
}

const extractBestText = (payload: Crawl4AiResponse): string | null => {
  const candidates: unknown[] = [
    payload.content,
    payload.text,
    payload.markdown,
    payload.data?.content,
    payload.data?.text,
    payload.data?.markdown,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const cleaned = normalizeWhitespace(stripHtml(candidate))

      if (cleaned.length > 0) {
        return cleaned.slice(0, MAX_CONTENT_LENGTH)
      }
    }
  }

  return null
}

const withTimeout = async <T>(
  timeoutMs: number,
  execute: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
  const controller = new AbortController()
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await execute(controller.signal)
  } finally {
    clearTimeout(timeoutHandle)
  }
}

class Crawl4AiFetchStrategy implements ContentFetchStrategy {
  readonly name = 'fetch_crawl4ai' as const

  async fetch(url: string): Promise<string | null> {
    if (!env.CRAWL4AI_API_URL) {
      return null
    }

    try {
      const response = await withTimeout(env.CRAWL4AI_TIMEOUT_MS, async (signal) => {
        return fetch(env.CRAWL4AI_API_URL as string, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(env.CRAWL4AI_API_KEY
              ? { Authorization: `Bearer ${env.CRAWL4AI_API_KEY}` }
              : {}),
          },
          body: JSON.stringify({ url }),
          signal,
        })
      })

      if (!response.ok) {
        throw new Error(`crawl4ai request failed with status ${response.status}`)
      }

      const payload = (await response.json()) as Crawl4AiResponse
      return extractBestText(payload)
    } catch (error) {
      logger.warn(
        { error, url, strategy: this.name },
        'crawl4ai strategy failed for article content fetch',
      )

      return null
    }
  }
}

class StandardHtmlFetchStrategy implements ContentFetchStrategy {
  readonly name = 'fetch_standard_html' as const

  async fetch(url: string): Promise<string | null> {
    try {
      const response = await withTimeout(env.HTTP_FETCH_TIMEOUT_MS, async (signal) => {
        return fetch(url, {
          headers: {
            'User-Agent': DEFAULT_USER_AGENT,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          signal,
        })
      })

      if (!response.ok) {
        throw new Error(`HTML fetch failed with status ${response.status}`)
      }

      const html = await response.text()
      const extracted = stripHtml(html)

      if (extracted.length === 0) {
        return null
      }

      return extracted.slice(0, MAX_CONTENT_LENGTH)
    } catch (error) {
      logger.warn(
        { error, url, strategy: this.name },
        'standard HTML strategy failed for article content fetch',
      )

      return null
    }
  }
}

export class ContentFetchService {
  private readonly crawl4ai = new Crawl4AiFetchStrategy()
  private readonly standardHtml = new StandardHtmlFetchStrategy()

  async fetchBestContent(
    url: string,
    rssSummary: string,
  ): Promise<FetchArticleContentOutput> {
    const normalizedSummary = normalizeWhitespace(stripHtml(rssSummary))

    if (normalizedSummary.length >= MIN_SUMMARY_LENGTH) {
      return {
        content: normalizedSummary,
        decisionPath: 'RSS_Sufficient',
        strategyUsed: 'rss',
      }
    }

    const crawl4aiContent = await this.crawl4ai.fetch(url)

    if (crawl4aiContent) {
      return {
        content: crawl4aiContent,
        decisionPath: 'Invoked_crawl4ai -> Success',
        strategyUsed: this.crawl4ai.name,
      }
    }

    const fallbackContent = await this.standardHtml.fetch(url)

    if (fallbackContent) {
      return {
        content: fallbackContent,
        decisionPath: 'Invoked_crawl4ai -> Failed -> Invoked_Fallback -> Success',
        strategyUsed: this.standardHtml.name,
      }
    }

    return {
      content: normalizedSummary,
      decisionPath: 'Invoked_crawl4ai -> Failed -> Invoked_Fallback -> Failed',
      strategyUsed: 'none',
    }
  }
}

export const contentFetchService = new ContentFetchService()
