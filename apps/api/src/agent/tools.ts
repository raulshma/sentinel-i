import { tool } from "ai";
import { z } from "zod";

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

const MAX_TOOL_CONTENT_LENGTH = 8_000;
const ARTICLE_FETCH_HOST_ALLOWLIST = parseArticleFetchHostAllowlist(
  env.ARTICLE_FETCH_HOST_ALLOWLIST,
);

export const fetchCrawl4aiTool = tool({
  description:
    "Fetch full article content from a URL using the crawl4ai API. Use this for JavaScript-heavy pages or when the initial summary lacks geographic context. Returns the extracted text content of the article.",
  inputSchema: z.object({
    url: z
      .string()
      .url()
      .describe("The full URL of the news article to fetch."),
  }),
  execute: async ({ url }) => {
    if (!env.CRAWL4AI_API_URL) {
      return {
        success: false,
        content: null,
        error: "crawl4ai API URL not configured",
      };
    }

    const startedAt = Date.now();
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
        "Blocked unsafe URL for crawl4ai tool",
      );

      return {
        success: false,
        content: null,
        error: `Unsafe article URL: ${urlSafety.reason ?? "invalid_url"}`,
      };
    }

    const safeUrl = urlSafety.canonicalUrl;

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
            body: JSON.stringify({ url: safeUrl }),
            signal,
          });
        },
      );

      if (!response.ok) {
        throw new Error(`crawl4ai returned status ${response.status}`);
      }

      const payload = (await response.json()) as CrawlLikePayload;
      const cleaned = extractBestArticleText(payload, MAX_TOOL_CONTENT_LENGTH);

      if (cleaned) {
        logger.debug(
          {
            url: safeUrl,
            latencyMs: Date.now() - startedAt,
            contentLength: cleaned.length,
          },
          "crawl4ai tool succeeded",
        );
        return { success: true, content: cleaned, error: null };
      }

      return {
        success: false,
        content: null,
        error: "crawl4ai returned empty content",
      };
    } catch (error) {
      logger.warn(
        { error, url, latencyMs: Date.now() - startedAt },
        "crawl4ai tool execution failed",
      );
      return {
        success: false,
        content: null,
        error: error instanceof Error ? error.message : "crawl4ai fetch failed",
      };
    }
  },
});

export const fetchStandardHtmlTool = tool({
  description:
    "Fetch article content using a standard HTTP request with basic HTML-to-text extraction. Use this as a fallback when crawl4ai fails or is not needed. Returns the raw text content of the page.",
  inputSchema: z.object({
    url: z
      .string()
      .url()
      .describe("The full URL of the news article to fetch."),
  }),
  execute: async ({ url }) => {
    const startedAt = Date.now();
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
        "Blocked unsafe URL for standard HTML tool",
      );

      return {
        success: false,
        content: null,
        error: `Unsafe article URL: ${urlSafety.reason ?? "invalid_url"}`,
      };
    }

    const safeUrl = urlSafety.canonicalUrl;

    try {
      const response = await withTimeout(
        env.HTTP_FETCH_TIMEOUT_MS,
        async (signal) => {
          return fetchWithSafeArticleRedirects(
            safeUrl,
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
        throw new Error(`HTML fetch returned status ${response.status}`);
      }

      const html = await response.text();
      const extracted = stripHtmlToText(html);

      if (extracted.length === 0) {
        return {
          success: false,
          content: null,
          error: "No text content extracted from HTML",
        };
      }

      const content = extracted.slice(0, MAX_TOOL_CONTENT_LENGTH);

      logger.debug(
        {
          url: safeUrl,
          latencyMs: Date.now() - startedAt,
          contentLength: content.length,
        },
        "standard HTML tool succeeded",
      );

      return { success: true, content, error: null };
    } catch (error) {
      if (isUnsafeArticleUrlError(error)) {
        logger.warn(
          {
            url,
            reason: error.reason,
            latencyMs: Date.now() - startedAt,
          },
          "Blocked unsafe redirect target in standard HTML tool",
        );

        return {
          success: false,
          content: null,
          error: `Unsafe article URL: ${error.reason}`,
        };
      }

      logger.warn(
        { error, url, latencyMs: Date.now() - startedAt },
        "standard HTML tool execution failed",
      );
      return {
        success: false,
        content: null,
        error: error instanceof Error ? error.message : "HTML fetch failed",
      };
    }
  },
});
