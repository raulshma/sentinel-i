import { randomUUID } from "node:crypto";

import Parser from "rss-parser";

import { agentService } from "../agent/agentService.js";
import { cacheService } from "./cache.service.js";
import { rssFeedSources } from "../config/rssFeeds.js";
import { logger } from "../config/logger.js";
import {
  newsRepository,
  type NewsRepository,
} from "../repositories/news.repository.js";
import { socketGateway } from "../socket/socketGateway.js";
import type { NewsCategory, CreateLocationInput } from "../types/news.js";
import {
  contentFetchService,
  type FetchArticleContentOutput,
} from "./contentFetch.service.js";
import { geocodeService } from "./geocode.service.js";
import { processingEventBus } from "./processingEventBus.js";
import type {
  ProcessingEventType,
  ProcessingTraceContext,
} from "../types/processing.js";

type RssItem = {
  title?: string;
  link?: string;
  guid?: string;
  pubDate?: string;
  isoDate?: string;
  content?: string;
  contentSnippet?: string;
};

type RssFeed = {
  items: RssItem[];
};

interface HeadlineFingerprint {
  normalized: string;
  tokens: Set<string>;
}

export interface RssIngestionSummary {
  feedCount: number;
  entriesSeen: number;
  inserted: number;
  duplicateCount: number;
  nationalCount: number;
  locationCount: number;
  errorCount: number;
  startedAt: string;
  finishedAt: string;
}

export interface IngestionExecutionContext {
  runId?: string;
  jobId?: string;
  attempt?: number;
  triggeredAt?: string;
}

const parser = new Parser<Record<string, never>, RssItem>();

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "on",
  "in",
  "for",
  "to",
  "from",
  "at",
  "with",
  "by",
  "after",
  "before",
  "and",
  "or",
  "vs",
  "is",
  "are",
  "was",
  "were",
  "be",
  "as",
  "that",
  "this",
  "it",
  "its",
  "over",
  "under",
  "new",
  "latest",
  "india",
]);

const CATEGORY_RULES: Array<{
  category: Exclude<NewsCategory, "Uncategorized / National">;
  keywords: string[];
}> = [
  {
    category: "Politics",
    keywords: [
      "election",
      "parliament",
      "chief minister",
      "mp",
      "mla",
      "bjp",
      "congress",
    ],
  },
  {
    category: "Business",
    keywords: [
      "market",
      "stock",
      "economy",
      "inflation",
      "trade",
      "startup",
      "funding",
    ],
  },
  {
    category: "Technology",
    keywords: [
      "ai",
      "software",
      "cyber",
      "digital",
      "startup tech",
      "internet",
      "app",
    ],
  },
  {
    category: "Sports",
    keywords: [
      "cricket",
      "football",
      "hockey",
      "ipl",
      "match",
      "tournament",
      "athlete",
    ],
  },
  {
    category: "Entertainment",
    keywords: [
      "film",
      "movie",
      "actor",
      "actress",
      "bollywood",
      "music",
      "series",
    ],
  },
  {
    category: "Crime",
    keywords: [
      "crime",
      "murder",
      "theft",
      "arrest",
      "police",
      "fraud",
      "assault",
    ],
  },
  {
    category: "Weather",
    keywords: [
      "rain",
      "cyclone",
      "flood",
      "heatwave",
      "weather",
      "temperature",
      "monsoon",
    ],
  },
];

const normalizeText = (value: string): string => {
  return value.replace(/\s+/g, " ").trim();
};

const normalizeHeadline = (value: string): string => {
  return normalizeText(value.toLowerCase().replace(/[^a-z0-9\s]/g, " "));
};

const tokenizeHeadline = (value: string): Set<string> => {
  const tokens = normalizeHeadline(value)
    .split(" ")
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));

  return new Set(tokens);
};

const createFingerprint = (headline: string): HeadlineFingerprint => {
  return {
    normalized: normalizeHeadline(headline),
    tokens: tokenizeHeadline(headline),
  };
};

const jaccardSimilarity = (left: Set<string>, right: Set<string>): number => {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let overlap = 0;

  for (const token of left) {
    if (right.has(token)) {
      overlap += 1;
    }
  }

  const union = left.size + right.size - overlap;
  return union === 0 ? 0 : overlap / union;
};

const categorizeArticle = (text: string): NewsCategory => {
  const normalized = text.toLowerCase();

  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((keyword) => normalized.includes(keyword))) {
      return rule.category;
    }
  }

  return "General";
};

const resolvePublishedAt = (item: RssItem): string => {
  const candidate = item.isoDate ?? item.pubDate;

  if (!candidate) {
    return new Date().toISOString();
  }

  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime())
    ? new Date().toISOString()
    : parsed.toISOString();
};

export class RssIngestionService {
  constructor(private readonly repository: NewsRepository = newsRepository) {}

  private log(
    sourceUrl: string,
    headline: string | null,
    stage: Parameters<typeof processingEventBus.emitLog>[0]["stage"],
    message: string,
    status: Parameters<typeof processingEventBus.emitLog>[0]["status"],
    metadata?: Record<string, unknown>,
    context?: ProcessingTraceContext & {
      eventType?: ProcessingEventType;
      durationMs?: number;
    },
  ): void {
    processingEventBus.emitLog({
      runId: context?.runId,
      jobId: context?.jobId,
      traceId: context?.traceId,
      articleId: context?.articleId,
      feedUrl: context?.feedUrl,
      attempt: context?.attempt,
      eventType: context?.eventType,
      durationMs: context?.durationMs,
      sourceUrl,
      headline,
      stage,
      message,
      status,
      metadata,
    });
  }

  async runIngestionCycle(
    executionContext: IngestionExecutionContext = {},
  ): Promise<RssIngestionSummary> {
    const cycleContext: IngestionExecutionContext = {
      runId: executionContext.runId ?? randomUUID(),
      jobId: executionContext.jobId,
      attempt: executionContext.attempt,
      triggeredAt: executionContext.triggeredAt,
    };

    const startedAt = new Date();

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
    };

    const recentHeadlines = await this.repository.findRecentHeadlines(24, 600);
    const dedupeFingerprints = recentHeadlines.map((headline) =>
      createFingerprint(headline),
    );

    for (const feedUrl of rssFeedSources) {
      const feedStartedAt = new Date();
      const feedStartedAtMs = Date.now();
      const feedContext: ProcessingTraceContext = {
        runId: cycleContext.runId,
        jobId: cycleContext.jobId,
        attempt: cycleContext.attempt,
        feedUrl,
      };

      this.log(
        feedUrl,
        null,
        "feed_fetch",
        `Fetching RSS feed: ${feedUrl}`,
        "start",
        { triggeredAt: cycleContext.triggeredAt },
        { ...feedContext, eventType: "start" },
      );

      try {
        const parsedFeed = (await parser.parseURL(feedUrl)) as RssFeed;

        const feedDurationMs = Date.now() - feedStartedAtMs;

        this.log(
          feedUrl,
          null,
          "feed_fetch",
          `Fetched RSS feed (${parsedFeed.items.length} entries)`,
          "success",
          { itemCount: parsedFeed.items.length },
          { ...feedContext, eventType: "end", durationMs: feedDurationMs },
        );

        this.log(
          feedUrl,
          null,
          "feed_parse",
          `Parsed ${parsedFeed.items.length} entries from feed`,
          "success",
          { itemCount: parsedFeed.items.length },
          {
            ...feedContext,
            eventType: "checkpoint",
            durationMs: feedDurationMs,
          },
        );

        for (const item of parsedFeed.items) {
          summary.entriesSeen += 1;

          await this.processFeedItem(
            item,
            feedUrl,
            new Date(),
            dedupeFingerprints,
            summary,
            cycleContext,
          );
        }
      } catch (error) {
        summary.errorCount += 1;

        const feedDurationMs = Date.now() - feedStartedAtMs;

        this.log(
          feedUrl,
          null,
          "feed_fetch",
          `Feed parse failed: ${error instanceof Error ? error.message : "Unknown error"}`,
          "error",
          { failureType: "feed_parse_failed" },
          { ...feedContext, eventType: "error", durationMs: feedDurationMs },
        );

        logger.error(
          { error, feedUrl },
          "RSS feed parsing failed for ingestion cycle",
        );

        await this.repository.recordIngestionRun({
          runId: cycleContext.runId,
          jobId: cycleContext.jobId,
          feedUrl,
          step: "feed_parse",
          decisionPath: "Feed_Parse_Failed",
          status: "FAILED",
          errorMessage:
            error instanceof Error ? error.message : "Unknown feed parse error",
          startedAt: feedStartedAt,
          finishedAt: new Date(),
        });
      }
    }

    summary.finishedAt = new Date().toISOString();

    return summary;
  }

  private async processFeedItem(
    item: RssItem,
    feedUrl: string,
    itemStartedAt: Date,
    dedupeFingerprints: HeadlineFingerprint[],
    summary: RssIngestionSummary,
    executionContext: IngestionExecutionContext,
  ): Promise<void> {
    const sourceUrl = normalizeText(item.link ?? item.guid ?? "");
    const headline = normalizeText(item.title ?? "");

    if (sourceUrl.length === 0 || headline.length === 0) {
      return;
    }

    const traceId = randomUUID();
    const traceContext: ProcessingTraceContext = {
      runId: executionContext.runId,
      jobId: executionContext.jobId,
      traceId,
      feedUrl,
      attempt: executionContext.attempt,
    };

    const itemStartedAtMs = Date.now();
    const dedupeStartedAtMs = Date.now();

    this.log(
      sourceUrl,
      headline,
      "deduplication",
      "Checking duplicate state",
      "start",
      undefined,
      { ...traceContext, eventType: "start" },
    );

    if (await cacheService.isDuplicate(sourceUrl)) {
      summary.duplicateCount += 1;

      const dedupeDurationMs = Date.now() - dedupeStartedAtMs;

      this.log(
        sourceUrl,
        headline,
        "deduplication",
        "Skipped: URL already in cache",
        "warn",
        {
          reason: "url_cache",
          failureType: "dedupe_valkey_cache",
        },
        { ...traceContext, eventType: "end", durationMs: dedupeDurationMs },
      );

      await this.repository.recordIngestionRun({
        runId: executionContext.runId,
        jobId: executionContext.jobId,
        traceId,
        feedUrl,
        sourceUrl,
        headline,
        step: "deduplication",
        decisionPath: "Dedupe_Valkey_Cache",
        status: "SKIPPED_DUPLICATE",
        startedAt: itemStartedAt,
        finishedAt: new Date(),
      });

      return;
    }

    const fingerprint = createFingerprint(headline);

    if (this.isLikelyDuplicate(fingerprint, dedupeFingerprints)) {
      summary.duplicateCount += 1;

      const dedupeDurationMs = Date.now() - dedupeStartedAtMs;

      this.log(
        sourceUrl,
        headline,
        "deduplication",
        "Skipped: similar headline exists",
        "warn",
        {
          reason: "headline_similarity",
          failureType: "dedupe_headline_similarity",
        },
        { ...traceContext, eventType: "end", durationMs: dedupeDurationMs },
      );

      await this.repository.recordIngestionRun({
        runId: executionContext.runId,
        jobId: executionContext.jobId,
        traceId,
        feedUrl,
        sourceUrl,
        headline,
        step: "deduplication",
        decisionPath: "Dedupe_Title_Match",
        status: "SKIPPED_DUPLICATE",
        startedAt: itemStartedAt,
        finishedAt: new Date(),
      });

      return;
    }

    const rawSummary = normalizeText(
      item.contentSnippet ?? item.content ?? headline,
    );

    const rssFullContent = item.content
      ? normalizeText(
          item.content
            .replace(/<[^>]*>/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
        )
      : rawSummary;

    try {
      const dedupeDurationMs = Date.now() - dedupeStartedAtMs;

      this.log(
        sourceUrl,
        headline,
        "deduplication",
        "Deduplication passed",
        "success",
        { reason: "accepted" },
        { ...traceContext, eventType: "end", durationMs: dedupeDurationMs },
      );

      const pipelineStartedAtMs = Date.now();

      this.log(
        sourceUrl,
        headline,
        "ai_processing",
        "Starting article processing pipeline",
        "start",
        undefined,
        { ...traceContext, eventType: "start" },
      );

      const agentResult = await agentService.processArticle(
        headline,
        rawSummary,
        sourceUrl,
        rssFullContent,
        traceContext,
      );

      if (agentResult) {
        this.log(
          sourceUrl,
          headline,
          "ai_processing",
          `AI agent extracted: category=${agentResult.extraction.category}, locations=${agentResult.extraction.locations.length}`,
          "success",
          {
            decisionPath: agentResult.audit.decisionPath,
            latencyMs: agentResult.audit.totalLatencyMs,
            locationCount: agentResult.extraction.locations.length,
          },
          {
            ...traceContext,
            eventType: "end",
            durationMs: Date.now() - pipelineStartedAtMs,
          },
        );

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
          traceContext,
        );
        return;
      }

      this.log(
        sourceUrl,
        headline,
        "ai_processing",
        "AI agent not available, falling back to rule-based extraction",
        "info",
        { reason: "ai_unavailable_or_failed" },
        {
          ...traceContext,
          eventType: "end",
          durationMs: Date.now() - pipelineStartedAtMs,
        },
      );

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
        traceContext,
      );
    } catch (error) {
      summary.errorCount += 1;

      this.log(
        sourceUrl,
        headline,
        "error",
        `Processing failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        "error",
        { failureType: "item_processing_failed" },
        {
          ...traceContext,
          eventType: "error",
          durationMs: Date.now() - itemStartedAtMs,
        },
      );

      logger.error({ error, feedUrl, sourceUrl }, "RSS item ingestion failed");

      await this.repository.recordIngestionRun({
        runId: executionContext.runId,
        jobId: executionContext.jobId,
        traceId,
        feedUrl,
        sourceUrl,
        headline,
        step: "item_processing",
        decisionPath: "Item_Processing_Failed",
        status: "FAILED",
        errorMessage:
          error instanceof Error ? error.message : "Unknown processing error",
        startedAt: itemStartedAt,
        finishedAt: new Date(),
      });
    }
  }

  private async processWithAgentExtraction(
    extraction: import("../types/ai.js").NewsExtraction,
    agentDecisionPath: string,
    sourceUrl: string,
    rawSummary: string,
    feedUrl: string,
    itemStartedAt: Date,
    summary: RssIngestionSummary,
    dedupeFingerprints: HeadlineFingerprint[],
    fingerprint: HeadlineFingerprint,
    item: RssItem,
    traceContext: ProcessingTraceContext,
  ): Promise<void> {
    const locations: CreateLocationInput[] = [];
    let anyGeocoded = false;

    let isFirst = true;

    for (const loc of extraction.locations) {
      let latitude: number | null = null;
      let longitude: number | null = null;

      if (loc.location_name || loc.city || loc.state) {
        const geocodeStartedAtMs = Date.now();

        this.log(
          sourceUrl,
          extraction.headline,
          "geocoding",
          `Geocoding location: ${loc.location_name ?? loc.city ?? loc.state}`,
          "start",
          undefined,
          { ...traceContext, eventType: "start" },
        );

        const coordinates = await geocodeService.forwardGeocode({
          locationName: loc.location_name ?? loc.city ?? loc.state ?? "",
          city: loc.city,
          state: loc.state,
        });

        const geocodeDurationMs = Date.now() - geocodeStartedAtMs;

        if (coordinates) {
          latitude = coordinates.latitude;
          longitude = coordinates.longitude;
          anyGeocoded = true;
          this.log(
            sourceUrl,
            extraction.headline,
            "geocoding",
            `Geocoded to ${latitude}, ${longitude}`,
            "success",
            undefined,
            {
              ...traceContext,
              eventType: "end",
              durationMs: geocodeDurationMs,
            },
          );
        } else {
          this.log(
            sourceUrl,
            extraction.headline,
            "geocoding",
            `Geocoding returned no coordinates for: ${loc.location_name ?? loc.city ?? loc.state}`,
            "warn",
            { failureType: "geocode_not_found" },
            {
              ...traceContext,
              eventType: "end",
              durationMs: geocodeDurationMs,
            },
          );
        }
      }

      locations.push({
        locationName: loc.location_name,
        city: loc.city,
        state: loc.state,
        isPrimary: isFirst,
        latitude,
        longitude,
      });
      isFirst = false;
    }

    const hasLocations = extraction.locations.length > 0;
    const isNational = !hasLocations || !anyGeocoded;

    const category: NewsCategory = isNational
      ? "Uncategorized / National"
      : extraction.category === "Uncategorized / National"
        ? "General"
        : extraction.category;

    const storageStartedAtMs = Date.now();

    this.log(
      sourceUrl,
      extraction.headline,
      "storage",
      `Storing news item with ${locations.length} location(s) in database`,
      "start",
      undefined,
      { ...traceContext, eventType: "start" },
    );

    const result = await this.repository.createNewsItem({
      sourceUrl,
      headline: extraction.headline,
      summary: extraction.summary.length > 0 ? extraction.summary : rawSummary,
      category,
      isNational,
      publishedAt: resolvePublishedAt(item),
      locations,
    });

    if (!result) {
      summary.duplicateCount += 1;

      const storageDurationMs = Date.now() - storageStartedAtMs;

      this.log(
        sourceUrl,
        extraction.headline,
        "storage",
        "Skipped: insert conflict",
        "warn",
        { failureType: "db_insert_conflict_or_error" },
        { ...traceContext, eventType: "end", durationMs: storageDurationMs },
      );

      await this.repository.recordIngestionRun({
        runId: traceContext.runId,
        jobId: traceContext.jobId,
        traceId: traceContext.traceId,
        feedUrl,
        sourceUrl,
        headline: extraction.headline,
        step: "storage",
        decisionPath: `${agentDecisionPath} -> Insert_Conflict_or_Error`,
        status: "SKIPPED_CONFLICT",
        startedAt: itemStartedAt,
        finishedAt: new Date(),
      });

      return;
    }

    const locationSummary =
      result.locations.length > 0
        ? ` - ${result.locations.map((l) => l.city ?? l.state ?? l.locationName ?? "unknown").join(", ")}`
        : "";

    const articleTraceContext: ProcessingTraceContext = {
      ...traceContext,
      articleId: result.item.id,
    };

    this.log(
      sourceUrl,
      extraction.headline,
      "storage",
      `Stored news item ${result.item.id} with ${result.locations.length} location(s)`,
      "success",
      { locationCount: result.locations.length },
      {
        ...articleTraceContext,
        eventType: "end",
        durationMs: Date.now() - storageStartedAtMs,
      },
    );

    this.log(
      sourceUrl,
      extraction.headline,
      "complete",
      `Article processed successfully [${category}]${isNational ? " (national)" : locationSummary} (${result.locations.length} location(s))`,
      "success",
      {
        category,
        isNational,
        locationCount: result.locations.length,
      },
      { ...articleTraceContext, eventType: "end" },
    );

    summary.inserted += 1;
    summary.locationCount += result.locations.length;

    if (result.item.isNational) {
      summary.nationalCount += 1;
    }

    dedupeFingerprints.push(fingerprint);
    await cacheService.markProcessed(sourceUrl);
    socketGateway.publishNewsCreated(result.item, result.locations);

    await this.repository.recordIngestionRun({
      runId: traceContext.runId,
      jobId: traceContext.jobId,
      traceId: traceContext.traceId,
      feedUrl,
      sourceUrl,
      headline: extraction.headline,
      newsItemId: result.item.id,
      step: "complete",
      decisionPath: agentDecisionPath,
      status: "SUCCESS",
      startedAt: itemStartedAt,
      finishedAt: new Date(),
    });
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
    traceContext: ProcessingTraceContext,
  ): Promise<void> {
    let fetchResult: FetchArticleContentOutput = {
      content: rawSummary,
      decisionPath: "RSS_Sufficient",
      strategyUsed: "rss",
    };

    const contentFetchStartedAtMs = Date.now();

    this.log(
      sourceUrl,
      headline,
      "content_fetch",
      `Fetching article content (RSS summary: ${rawSummary.length} chars)`,
      "start",
      undefined,
      { ...traceContext, eventType: "start" },
    );

    fetchResult = await contentFetchService.fetchBestContent(
      sourceUrl,
      rawSummary,
    );

    const contentFetchDurationMs = Date.now() - contentFetchStartedAtMs;

    this.log(
      sourceUrl,
      headline,
      "content_parse",
      `Content fetched via ${fetchResult.strategyUsed} (${fetchResult.content.length} chars)`,
      "success",
      { strategy: fetchResult.strategyUsed },
      { ...traceContext, eventType: "end", durationMs: contentFetchDurationMs },
    );

    const fullText = normalizeText(`${headline} ${fetchResult.content}`);
    const baseCategory = categorizeArticle(fullText);

    const storageStartedAtMs = Date.now();

    this.log(
      sourceUrl,
      headline,
      "storage",
      "Storing news item as national (rule-based fallback, no AI location extraction)",
      "start",
      undefined,
      { ...traceContext, eventType: "start" },
    );

    const result = await this.repository.createNewsItem({
      sourceUrl,
      headline,
      summary:
        fetchResult.content.length > 0 ? fetchResult.content : rawSummary,
      category:
        baseCategory === "General" ? "Uncategorized / National" : baseCategory,
      isNational: true,
      publishedAt: resolvePublishedAt(item),
      locations: [],
    });

    if (!result) {
      summary.duplicateCount += 1;

      const storageDurationMs = Date.now() - storageStartedAtMs;

      this.log(
        sourceUrl,
        headline,
        "storage",
        "Skipped: insert conflict",
        "warn",
        { failureType: "db_insert_conflict_or_error" },
        { ...traceContext, eventType: "end", durationMs: storageDurationMs },
      );

      await this.repository.recordIngestionRun({
        runId: traceContext.runId,
        jobId: traceContext.jobId,
        traceId: traceContext.traceId,
        feedUrl,
        sourceUrl,
        headline,
        step: "storage",
        decisionPath: `${fetchResult.decisionPath} -> Insert_Conflict_or_Error`,
        status: "SKIPPED_CONFLICT",
        startedAt: itemStartedAt,
        finishedAt: new Date(),
      });

      return;
    }

    summary.inserted += 1;
    summary.locationCount += result.locations.length;
    summary.nationalCount += 1;

    const articleTraceContext: ProcessingTraceContext = {
      ...traceContext,
      articleId: result.item.id,
    };

    this.log(
      sourceUrl,
      headline,
      "storage",
      `Stored national news item ${result.item.id}`,
      "success",
      { locationCount: 0 },
      {
        ...articleTraceContext,
        eventType: "end",
        durationMs: Date.now() - storageStartedAtMs,
      },
    );

    this.log(
      sourceUrl,
      headline,
      "complete",
      "Article processed successfully [national] (rule-based fallback)",
      "success",
      {
        category: result.item.category,
        isNational: true,
        locationCount: 0,
      },
      { ...articleTraceContext, eventType: "end" },
    );

    dedupeFingerprints.push(fingerprint);
    await cacheService.markProcessed(sourceUrl);
    socketGateway.publishNewsCreated(result.item, result.locations);

    await this.repository.recordIngestionRun({
      runId: traceContext.runId,
      jobId: traceContext.jobId,
      traceId: traceContext.traceId,
      feedUrl,
      sourceUrl,
      headline,
      newsItemId: result.item.id,
      step: "complete",
      decisionPath: `RuleBased_Fallback -> ${fetchResult.decisionPath}`,
      status: "SUCCESS",
      startedAt: itemStartedAt,
      finishedAt: new Date(),
    });
  }

  private isLikelyDuplicate(
    incoming: HeadlineFingerprint,
    existing: HeadlineFingerprint[],
  ): boolean {
    if (incoming.normalized.length === 0) {
      return false;
    }

    for (const candidate of existing) {
      if (incoming.normalized === candidate.normalized) {
        return true;
      }

      const similarity = jaccardSimilarity(incoming.tokens, candidate.tokens);

      if (similarity >= 0.78) {
        return true;
      }
    }

    return false;
  }
}

export const rssIngestionService = new RssIngestionService();
