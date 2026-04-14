import { tool } from 'ai'
import { z } from 'zod'

import { env } from '../config/env.js'
import { logger } from '../config/logger.js'

const MAX_TOOL_CONTENT_LENGTH = 8_000
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (compatible; Sentinel-I/1.0; +https://example.local/sentinel-i)'

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
  return decoded.replace(/\s+/g, ' ').trim()
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

export const fetchCrawl4aiTool = tool({
  description:
    'Fetch full article content from a URL using the crawl4ai API. Use this for JavaScript-heavy pages or when the initial summary lacks geographic context. Returns the extracted text content of the article.',
  inputSchema: z.object({
    url: z.string().url().describe('The full URL of the news article to fetch.'),
  }),
  execute: async ({ url }) => {
    if (!env.CRAWL4AI_API_URL) {
      return { success: false, content: null, error: 'crawl4ai API URL not configured' }
    }

    const startedAt = Date.now()

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
        throw new Error(`crawl4ai returned status ${response.status}`)
      }

      type CrawlPayload = {
        content?: unknown
        text?: unknown
        markdown?: unknown
        data?: { content?: unknown; text?: unknown; markdown?: unknown }
      }

      const payload = (await response.json()) as CrawlPayload

      const candidates: unknown[] = [
        payload.content,
        payload.text,
        payload.markdown,
        payload.data?.content,
        payload.data?.text,
        payload.data?.markdown,
      ]

      for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim().length > 0) {
          const cleaned = stripHtml(candidate).slice(0, MAX_TOOL_CONTENT_LENGTH)
          logger.debug(
            { url, latencyMs: Date.now() - startedAt, contentLength: cleaned.length },
            'crawl4ai tool succeeded',
          )
          return { success: true, content: cleaned, error: null }
        }
      }

      return { success: false, content: null, error: 'crawl4ai returned empty content' }
    } catch (error) {
      logger.warn(
        { error, url, latencyMs: Date.now() - startedAt },
        'crawl4ai tool execution failed',
      )
      return {
        success: false,
        content: null,
        error: error instanceof Error ? error.message : 'crawl4ai fetch failed',
      }
    }
  },
})

export const fetchStandardHtmlTool = tool({
  description:
    'Fetch article content using a standard HTTP request with basic HTML-to-text extraction. Use this as a fallback when crawl4ai fails or is not needed. Returns the raw text content of the page.',
  inputSchema: z.object({
    url: z.string().url().describe('The full URL of the news article to fetch.'),
  }),
  execute: async ({ url }) => {
    const startedAt = Date.now()

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
        throw new Error(`HTML fetch returned status ${response.status}`)
      }

      const html = await response.text()
      const extracted = stripHtml(html)

      if (extracted.length === 0) {
        return { success: false, content: null, error: 'No text content extracted from HTML' }
      }

      const content = extracted.slice(0, MAX_TOOL_CONTENT_LENGTH)

      logger.debug(
        { url, latencyMs: Date.now() - startedAt, contentLength: content.length },
        'standard HTML tool succeeded',
      )

      return { success: true, content, error: null }
    } catch (error) {
      logger.warn(
        { error, url, latencyMs: Date.now() - startedAt },
        'standard HTML tool execution failed',
      )
      return {
        success: false,
        content: null,
        error: error instanceof Error ? error.message : 'HTML fetch failed',
      }
    }
  },
})
