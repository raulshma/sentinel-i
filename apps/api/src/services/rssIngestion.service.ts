import Parser from 'rss-parser'

import { agentService } from '../agent/agentService.js'
import { isDevToolsEnabled } from '../config/env.js'
import { cacheService } from './cache.service.js'
import { rssFeedSources } from '../config/rssFeeds.js'
import { logger } from '../config/logger.js'
import {
  newsRepository,
  type NewsRepository,
} from '../repositories/news.repository.js'
import { socketGateway } from '../socket/socketGateway.js'
import type { NewsCategory, CreateLocationInput } from '../types/news.js'
import { contentFetchService, type FetchArticleContentOutput } from './contentFetch.service.js'
import { geocodeService } from './geocode.service.js'
import { processingEventBus } from './processingEventBus.js'

type RssItem = {
  title?: string
  link?: string
  guid?: string
  pubDate?: string
  isoDate?: string
  content?: string
  contentSnippet?: string
}

type RssFeed = {
  items: RssItem[]
}

interface HeadlineFingerprint {
  normalized: string
  tokens: Set<string>
}

export interface RssIngestionSummary {
  feedCount: number
  entriesSeen: number
  inserted: number
  duplicateCount: number
  nationalCount: number
  locationCount: number
  errorCount: number
  startedAt: string
  finishedAt: string
}

const parser = new Parser<Record<string, never>, RssItem>()



const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'of',
  'on',
  'in',
  'for',
  'to',
  'from',
  'at',
  'with',
  'by',
  'after',
  'before',
  'and',
  'or',
  'vs',
  'is',
  'are',
  'was',
  'were',
  'be',
  'as',
  'that',
  'this',
  'it',
  'its',
  'over',
  'under',
  'new',
  'latest',
  'india',
])

const CATEGORY_RULES: Array<{
  category: Exclude<NewsCategory, 'Uncategorized / National'>
  keywords: string[]
}> = [
  {
    category: 'Politics',
    keywords: ['election', 'parliament', 'chief minister', 'mp', 'mla', 'bjp', 'congress'],
  },
  {
    category: 'Business',
    keywords: ['market', 'stock', 'economy', 'inflation', 'trade', 'startup', 'funding'],
  },
  {
    category: 'Technology',
    keywords: ['ai', 'software', 'cyber', 'digital', 'startup tech', 'internet', 'app'],
  },
  {
    category: 'Sports',
    keywords: ['cricket', 'football', 'hockey', 'ipl', 'match', 'tournament', 'athlete'],
  },
  {
    category: 'Entertainment',
    keywords: ['film', 'movie', 'actor', 'actress', 'bollywood', 'music', 'series'],
  },
  {
    category: 'Crime',
    keywords: ['crime', 'murder', 'theft', 'arrest', 'police', 'fraud', 'assault'],
  },
  {
    category: 'Weather',
    keywords: ['rain', 'cyclone', 'flood', 'heatwave', 'weather', 'temperature', 'monsoon'],
  },
]

const normalizeText = (value: string): string => {
  return value.replace(/\s+/g, ' ').trim()
}

const normalizeHeadline = (value: string): string => {
  return normalizeText(value.toLowerCase().replace(/[^a-z0-9\s]/g, ' '))
}

const tokenizeHeadline = (value: string): Set<string> => {
  const tokens = normalizeHeadline(value)
    .split(' ')
    .filter((token) => token.length > 2 && !STOPWORDS.has(token))

  return new Set(tokens)
}

const createFingerprint = (headline: string): HeadlineFingerprint => {
  return {
    normalized: normalizeHeadline(headline),
    tokens: tokenizeHeadline(headline),
  }
}

const jaccardSimilarity = (left: Set<string>, right: Set<string>): number => {
  if (left.size === 0 || right.size === 0) {
    return 0
  }

  let overlap = 0

  for (const token of left) {
    if (right.has(token)) {
      overlap += 1
    }
  }

  const union = left.size + right.size - overlap
  return union === 0 ? 0 : overlap / union
}

const categorizeArticle = (text: string): NewsCategory => {
  const normalized = text.toLowerCase()

  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((keyword) => normalized.includes(keyword))) {
      return rule.category
    }
  }

  return 'General'
}

const resolvePublishedAt = (item: RssItem): string => {
  const candidate = item.isoDate ?? item.pubDate

  if (!candidate) {
    return new Date().toISOString()
  }

  const parsed = new Date(candidate)
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
}

export class RssIngestionService {
  constructor(private readonly repository: NewsRepository = newsRepository) {}

  private log(
    sourceUrl: string,
    headline: string | null,
    stage: Parameters<typeof processingEventBus.emitLog>[0]['stage'],
    message: string,
    status: Parameters<typeof processingEventBus.emitLog>[0]['status'],
    metadata?: Record<string, unknown>,
  ): void {
    if (!isDevToolsEnabled) return
    processingEventBus.emitLog({ sourceUrl, headline, stage, message, status, metadata })
  }

  async runIngestionCycle(): Promise<RssIngestionSummary> {
    const startedAt = new Date()

    const summary: RssIngestionSummary = {
      feedCount: rssFeedSources.length,
      entriesSeen: 0,
      inserted: 0,
      duplicateCount: 0,
      nationalCount: 0,
      locationCount: 0,
      errorCount: 0,
      startedAt: startedAt.toISOString(),
      finishedAt: startedAt.toISOString(),
    }

    const recentHeadlines = await this.repository.findRecentHeadlines(24, 600)
    const dedupeFingerprints = recentHeadlines.map((headline) =>
      createFingerprint(headline),
    )

    for (const feedUrl of rssFeedSources) {
      const feedStartedAt = new Date()

      this.log(feedUrl, null, 'feed_fetch', `Fetching RSS feed: ${feedUrl}`, 'start')

      try {
        const parsedFeed = (await parser.parseURL(feedUrl)) as RssFeed

        this.log(feedUrl, null, 'feed_parse', `Parsed ${parsedFeed.items.length} entries from feed`, 'success', { itemCount: parsedFeed.items.length })

        for (const item of parsedFeed.items) {
          summary.entriesSeen += 1

          await this.processFeedItem(
            item,
            feedUrl,
            feedStartedAt,
            dedupeFingerprints,
            summary,
          )
        }
      } catch (error) {
        summary.errorCount += 1

        this.log(feedUrl, null, 'feed_fetch', `Feed parse failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error')

        logger.error(
          { error, feedUrl },
          'RSS feed parsing failed for ingestion cycle',
        )

        await this.repository.recordIngestionRun({
          feedUrl,
          decisionPath: 'Feed_Parse_Failed',
          status: 'FAILED',
          errorMessage: error instanceof Error ? error.message : 'Unknown feed parse error',
          startedAt: feedStartedAt,
          finishedAt: new Date(),
        })
      }
    }

    summary.finishedAt = new Date().toISOString()

    return summary
  }

  private async processFeedItem(
    item: RssItem,
    feedUrl: string,
    itemStartedAt: Date,
    dedupeFingerprints: HeadlineFingerprint[],
    summary: RssIngestionSummary,
  ): Promise<void> {
    const sourceUrl = normalizeText(item.link ?? item.guid ?? '')
    const headline = normalizeText(item.title ?? '')

    if (sourceUrl.length === 0 || headline.length === 0) {
      return
    }

    if (await cacheService.isDuplicate(sourceUrl)) {
      summary.duplicateCount += 1

      this.log(sourceUrl, headline, 'deduplication', 'Skipped: URL already in cache', 'warn')

      await this.repository.recordIngestionRun({
        feedUrl,
        decisionPath: 'Dedupe_Valkey_Cache',
        status: 'SKIPPED_DUPLICATE',
        startedAt: itemStartedAt,
        finishedAt: new Date(),
      })

      return
    }

    const fingerprint = createFingerprint(headline)

    if (this.isLikelyDuplicate(fingerprint, dedupeFingerprints)) {
      summary.duplicateCount += 1

      this.log(sourceUrl, headline, 'deduplication', 'Skipped: similar headline exists', 'warn')

      await this.repository.recordIngestionRun({
        feedUrl,
        decisionPath: 'Dedupe_Title_Match',
        status: 'SKIPPED_DUPLICATE',
        startedAt: itemStartedAt,
        finishedAt: new Date(),
      })

      return
    }

    const rawSummary = normalizeText(item.contentSnippet ?? item.content ?? headline)

    const rssFullContent = item.content
      ? normalizeText(item.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim())
      : rawSummary

    try {
      this.log(sourceUrl, headline, 'ai_processing', 'Starting article processing pipeline', 'start')

      const agentResult = await agentService.processArticle(headline, rawSummary, sourceUrl, rssFullContent)

      if (agentResult) {
        this.log(sourceUrl, headline, 'ai_processing', `AI agent extracted: category=${agentResult.extraction.category}, locations=${agentResult.extraction.locations.length}`, 'success', {
          decisionPath: agentResult.audit.decisionPath,
          latencyMs: agentResult.audit.totalLatencyMs,
          locationCount: agentResult.extraction.locations.length,
        })
        await this.processWithAgentExtraction(
          agentResult.extraction,
          agentResult.audit.decisionPath,
          sourceUrl,
          rawSummary,
          feedUrl,
          itemStartedAt,
          summary,
          dedupeFingerprints,
          fingerprint,
          item,
        )
        return
      }

      this.log(sourceUrl, headline, 'ai_processing', 'AI agent not available, falling back to rule-based extraction', 'info')

      await this.processWithRuleBasedExtraction(
        headline,
        rawSummary,
        sourceUrl,
        feedUrl,
        itemStartedAt,
        summary,
        dedupeFingerprints,
        fingerprint,
        item,
      )
    } catch (error) {
      summary.errorCount += 1

      this.log(sourceUrl, headline, 'error', `Processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error')

      logger.error(
        { error, feedUrl, sourceUrl },
        'RSS item ingestion failed',
      )

      await this.repository.recordIngestionRun({
        feedUrl,
        decisionPath: 'Item_Processing_Failed',
        status: 'FAILED',
        errorMessage: error instanceof Error ? error.message : 'Unknown processing error',
        startedAt: itemStartedAt,
        finishedAt: new Date(),
      })
    }
  }

  private async processWithAgentExtraction(
    extraction: import('../types/ai.js').NewsExtraction,
    agentDecisionPath: string,
    sourceUrl: string,
    rawSummary: string,
    feedUrl: string,
    itemStartedAt: Date,
    summary: RssIngestionSummary,
    dedupeFingerprints: HeadlineFingerprint[],
    fingerprint: HeadlineFingerprint,
    item: RssItem,
  ): Promise<void> {
    const locations: CreateLocationInput[] = []
    let anyGeocoded = false

    let isFirst = true

    for (const loc of extraction.locations) {
      let latitude: number | null = null
      let longitude: number | null = null

      if (loc.location_name || loc.city || loc.state) {
        this.log(sourceUrl, extraction.headline, 'geocoding', `Geocoding location: ${loc.location_name ?? loc.city ?? loc.state}`, 'start')
        const coordinates = await geocodeService.forwardGeocode({
          locationName: loc.location_name ?? loc.city ?? loc.state ?? '',
          city: loc.city,
          state: loc.state,
        })

        if (coordinates) {
          latitude = coordinates.latitude
          longitude = coordinates.longitude
          anyGeocoded = true
          this.log(sourceUrl, extraction.headline, 'geocoding', `Geocoded to ${latitude}, ${longitude}`, 'success')
        } else {
          this.log(sourceUrl, extraction.headline, 'geocoding', `Geocoding returned no coordinates for: ${loc.location_name ?? loc.city ?? loc.state}`, 'warn')
        }
      }

      locations.push({
        locationName: loc.location_name,
        city: loc.city,
        state: loc.state,
        isPrimary: isFirst,
        latitude,
        longitude,
      })
      isFirst = false
    }

    const hasLocations = extraction.locations.length > 0
    const isNational = !hasLocations || !anyGeocoded

    const category: NewsCategory = isNational
      ? 'Uncategorized / National'
      : extraction.category === 'Uncategorized / National'
        ? 'General'
        : extraction.category

    this.log(sourceUrl, extraction.headline, 'storage', `Storing news item with ${locations.length} location(s) in database`, 'start')

    const result = await this.repository.createNewsItem({
      sourceUrl,
      headline: extraction.headline,
      summary: extraction.summary.length > 0 ? extraction.summary : rawSummary,
      category,
      isNational,
      publishedAt: resolvePublishedAt(item),
      locations,
    })

    if (!result) {
      summary.duplicateCount += 1

      this.log(sourceUrl, extraction.headline, 'storage', 'Skipped: insert conflict', 'warn')

      await this.repository.recordIngestionRun({
        feedUrl,
        decisionPath: `${agentDecisionPath} -> Insert_Conflict_or_Error`,
        status: 'SKIPPED_CONFLICT',
        startedAt: itemStartedAt,
        finishedAt: new Date(),
      })

      return
    }

    const locationSummary = result.locations.length > 0
      ? ` - ${result.locations.map((l) => l.city ?? l.state ?? l.locationName ?? 'unknown').join(', ')}`
      : ''

    this.log(sourceUrl, extraction.headline, 'complete', `Article processed successfully [${category}]${isNational ? ' (national)' : locationSummary} (${result.locations.length} location(s))`, 'success')

    summary.inserted += 1
    summary.locationCount += result.locations.length

    if (result.item.isNational) {
      summary.nationalCount += 1
    }

    dedupeFingerprints.push(fingerprint)
    await cacheService.markProcessed(sourceUrl)
    socketGateway.publishNewsCreated(result.item, result.locations)

    await this.repository.recordIngestionRun({
      feedUrl,
      decisionPath: agentDecisionPath,
      status: 'SUCCESS',
      startedAt: itemStartedAt,
      finishedAt: new Date(),
    })
  }

  private async processWithRuleBasedExtraction(
    headline: string,
    rawSummary: string,
    sourceUrl: string,
    feedUrl: string,
    itemStartedAt: Date,
    summary: RssIngestionSummary,
    dedupeFingerprints: HeadlineFingerprint[],
    fingerprint: HeadlineFingerprint,
    item: RssItem,
  ): Promise<void> {
    let fetchResult: FetchArticleContentOutput = {
      content: rawSummary,
      decisionPath: 'RSS_Sufficient',
      strategyUsed: 'rss',
    }

    this.log(sourceUrl, headline, 'content_fetch', `Fetching article content (RSS summary: ${rawSummary.length} chars)`, 'start')

    fetchResult = await contentFetchService.fetchBestContent(sourceUrl, rawSummary)

    this.log(sourceUrl, headline, 'content_parse', `Content fetched via ${fetchResult.strategyUsed} (${fetchResult.content.length} chars)`, 'success', { strategy: fetchResult.strategyUsed })

    const fullText = normalizeText(`${headline} ${fetchResult.content}`)
    const baseCategory = categorizeArticle(fullText)

    this.log(sourceUrl, headline, 'storage', `Storing news item as national (rule-based fallback, no AI location extraction)`, 'start')

    const result = await this.repository.createNewsItem({
      sourceUrl,
      headline,
      summary: fetchResult.content.length > 0 ? fetchResult.content : rawSummary,
      category: baseCategory === 'General' ? 'Uncategorized / National' : baseCategory,
      isNational: true,
      publishedAt: resolvePublishedAt(item),
      locations: [],
    })

    if (!result) {
      summary.duplicateCount += 1

      this.log(sourceUrl, headline, 'storage', 'Skipped: insert conflict', 'warn')

      await this.repository.recordIngestionRun({
        feedUrl,
        decisionPath: `${fetchResult.decisionPath} -> Insert_Conflict_or_Error`,
        status: 'SKIPPED_CONFLICT',
        startedAt: itemStartedAt,
        finishedAt: new Date(),
      })

      return
    }

    summary.inserted += 1
    summary.locationCount += result.locations.length
    summary.nationalCount += 1

    this.log(sourceUrl, headline, 'complete', `Article processed successfully [national] (rule-based fallback)`, 'success')

    dedupeFingerprints.push(fingerprint)
    await cacheService.markProcessed(sourceUrl)
    socketGateway.publishNewsCreated(result.item, result.locations)

    await this.repository.recordIngestionRun({
      feedUrl,
      decisionPath: `RuleBased_Fallback -> ${fetchResult.decisionPath}`,
      status: 'SUCCESS',
      startedAt: itemStartedAt,
      finishedAt: new Date(),
    })
  }

  private isLikelyDuplicate(
    incoming: HeadlineFingerprint,
    existing: HeadlineFingerprint[],
  ): boolean {
    if (incoming.normalized.length === 0) {
      return false
    }

    for (const candidate of existing) {
      if (incoming.normalized === candidate.normalized) {
        return true
      }

      const similarity = jaccardSimilarity(incoming.tokens, candidate.tokens)

      if (similarity >= 0.78) {
        return true
      }
    }

    return false
  }
}

export const rssIngestionService = new RssIngestionService()
