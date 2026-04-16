import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import {
  DEFAULT_SENTINEL_USER_AGENT,
  extractBestArticleText,
  stripHtmlToText,
  type CrawlLikePayload,
} from "../utils/articleContent.js";
import {
  fetchWithSafeArticleRedirects,
  isUnsafeArticleUrlError,
  parseArticleFetchHostAllowlist,
  validateArticleUrlSafety,
} from "../utils/articleUrl.js";
import { withTimeout } from "../utils/withTimeout.js";

type FetchStrategyName = "fetch_crawl4ai" | "fetch_standard_html";

interface ContentFetchStrategy {
  readonly name: FetchStrategyName;
  fetch(url: string): Promise<string | null>;
}

export interface FetchArticleContentOutput {
  content: string;
  decisionPath: string;
  strategyUsed: FetchStrategyName | "rss" | "none";
}

const MIN_SUMMARY_LENGTH = 220;
const MAX_CONTENT_LENGTH = 8_000;
const ARTICLE_FETCH_HOST_ALLOWLIST = parseArticleFetchHostAllowlist(
  env.ARTICLE_FETCH_HOST_ALLOWLIST,
);
const extractBestText = (payload: CrawlLikePayload): string | null => {
  return extractBestArticleText(payload, MAX_CONTENT_LENGTH);
};

class Crawl4AiFetchStrategy implements ContentFetchStrategy {
  readonly name = "fetch_crawl4ai" as const;

  async fetch(url: string): Promise<string | null> {
    if (!env.CRAWL4AI_API_URL) {
      return null;
    }

    try {
      const response = await withTimeout(
        env.CRAWL4AI_TIMEOUT_MS,
        async (signal) => {
          return fetch(env.CRAWL4AI_API_URL as string, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(env.CRAWL4AI_API_KEY
                ? { Authorization: `Bearer ${env.CRAWL4AI_API_KEY}` }
                : {}),
            },
            body: JSON.stringify({ url }),
            signal,
          });
        },
      );

      if (!response.ok) {
        throw new Error(
          `crawl4ai request failed with status ${response.status}`,
        );
      }

      const payload = (await response.json()) as CrawlLikePayload;
      return extractBestText(payload);
    } catch (error) {
      logger.warn(
        { error, url, strategy: this.name },
        "crawl4ai strategy failed for article content fetch",
      );

      return null;
    }
  }
}

class StandardHtmlFetchStrategy implements ContentFetchStrategy {
  readonly name = "fetch_standard_html" as const;

  async fetch(url: string): Promise<string | null> {
    try {
      const response = await withTimeout(
        env.HTTP_FETCH_TIMEOUT_MS,
        async (signal) => {
          return fetchWithSafeArticleRedirects(
            url,
            {
              headers: {
                "User-Agent": DEFAULT_SENTINEL_USER_AGENT,
                Accept:
                  "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              },
              signal,
            },
            {
              allowlistHosts: ARTICLE_FETCH_HOST_ALLOWLIST,
            },
          );
        },
      );

      if (!response.ok) {
        throw new Error(`HTML fetch failed with status ${response.status}`);
      }

      const html = await response.text();
      const extracted = stripHtmlToText(html);

      if (extracted.length === 0) {
        return null;
      }

      return extracted.slice(0, MAX_CONTENT_LENGTH);
    } catch (error) {
      if (isUnsafeArticleUrlError(error)) {
        logger.warn(
          {
            url,
            strategy: this.name,
            reason: error.reason,
          },
          "Blocked unsafe article URL in standard HTML fetch strategy",
        );

        return null;
      }

      logger.warn(
        { error, url, strategy: this.name },
        "standard HTML strategy failed for article content fetch",
      );

      return null;
    }
  }
}

export class ContentFetchService {
  private readonly crawl4ai = new Crawl4AiFetchStrategy();
  private readonly standardHtml = new StandardHtmlFetchStrategy();

  async fetchBestContent(
    url: string,
    rssSummary: string,
  ): Promise<FetchArticleContentOutput> {
    const normalizedSummary = stripHtmlToText(rssSummary);

    if (normalizedSummary.length >= MIN_SUMMARY_LENGTH) {
      return {
        content: normalizedSummary,
        decisionPath: "RSS_Sufficient",
        strategyUsed: "rss",
      };
    }

    const urlSafety = await validateArticleUrlSafety(url, {
      allowlistHosts: ARTICLE_FETCH_HOST_ALLOWLIST,
      checkDns: true,
    });

    if (!urlSafety.ok || !urlSafety.canonicalUrl) {
      logger.warn(
        {
          url,
          reason: urlSafety.reason,
          message: urlSafety.message,
        },
        "Blocked unsafe article URL before content fetch",
      );

      return {
        content: normalizedSummary,
        decisionPath: "URL_Safety_Rejected -> RSS_Summary_Fallback",
        strategyUsed: "none",
      };
    }

    const safeUrl = urlSafety.canonicalUrl;

    const crawl4aiContent = await this.crawl4ai.fetch(safeUrl);

    if (crawl4aiContent) {
      return {
        content: crawl4aiContent,
        decisionPath: "Invoked_crawl4ai -> Success",
        strategyUsed: this.crawl4ai.name,
      };
    }

    const fallbackContent = await this.standardHtml.fetch(safeUrl);

    if (fallbackContent) {
      return {
        content: fallbackContent,
        decisionPath:
          "Invoked_crawl4ai -> Failed -> Invoked_Fallback -> Success",
        strategyUsed: this.standardHtml.name,
      };
    }

    return {
      content: normalizedSummary,
      decisionPath: "Invoked_crawl4ai -> Failed -> Invoked_Fallback -> Failed",
      strategyUsed: "none",
    };
  }
}

export const contentFetchService = new ContentFetchService();
