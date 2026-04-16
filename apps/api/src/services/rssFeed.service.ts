import { newsRepository, type NewsRepository } from "../repositories/news.repository.js";
import { logger } from "../config/logger.js";
import type { NewsCategory } from "../types/news.js";

const escapeXml = (text: string): string => {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
};

const formatRfc822 = (date: Date): string => {
  return date.toUTCString();
};

interface FeedItem {
  id: string;
  headline: string;
  summary: string;
  sourceUrl: string;
  category: string;
  isNational: boolean;
  publishedAt: Date;
  locations: Array<{ city: string | null; state: string | null }>;
}

export class RssFeedService {
  constructor(private readonly repository: NewsRepository = newsRepository) {}

  async generateFeed(
    baseUrl: string,
    hours = 24,
    limit = 100,
    categories?: NewsCategory[],
  ): Promise<string> {
    const items = await this.repository.findForFeed(hours, limit, categories);

    logger.info(
      { count: items.length, hours, categories },
      "Generating RSS feed",
    );

    const now = new Date();
    const itemsXml = items.map((item) => this.renderItem(item, baseUrl)).join("\n");

    return [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">`,
      `  <channel>`,
      `    <title>Sentinel-i — Geo-Spatial News Aggregator</title>`,
      `    <description>Real-time geo-tagged news from India, aggregated from leading sources and plotted on an interactive map.</description>`,
      `    <link>${escapeXml(baseUrl)}</link>`,
      `    <atom:link href="${escapeXml(`${baseUrl}/api/v1/news/feed`)}" rel="self" type="application/rss+xml" />`,
      `    <language>en-in</language>`,
      `    <lastBuildDate>${formatRfc822(now)}</lastBuildDate>`,
      `    <generator>Sentinel-i</generator>`,
      `    <ttl>15</ttl>`,
      itemsXml,
      `  </channel>`,
      `</rss>`,
    ].join("\n");
  }

  private renderItem(item: FeedItem, baseUrl: string): string {
    const locationParts = item.locations
      .filter((loc) => loc.city || loc.state)
      .map((loc) => [loc.city, loc.state].filter(Boolean).join(", "))
      .filter(Boolean);

    const categoryTag = item.isNational ? "National" : item.category;

    return [
      `    <item>`,
      `      <title>${escapeXml(item.headline)}</title>`,
      `      <link>${escapeXml(item.sourceUrl)}</link>`,
      `      <description>${escapeXml(item.summary)}</description>`,
      `      <category>${escapeXml(categoryTag)}</category>`,
      ...(locationParts.length > 0
        ? locationParts.map((loc) => `      <category domain="${escapeXml(baseUrl)}/locations">${escapeXml(loc)}</category>`)
        : []),
      `      <pubDate>${formatRfc822(item.publishedAt)}</pubDate>`,
      `      <guid isPermaLink="true">${escapeXml(item.sourceUrl)}</guid>`,
      `    </item>`,
    ].join("\n");
  }
}

export const rssFeedService = new RssFeedService();
