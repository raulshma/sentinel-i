import { randomUUID } from "node:crypto";

import { streamText, Output, stepCountIs } from "ai";

import { aiModel, isAiEnabled } from "../config/ai.js";
import { logger } from "../config/logger.js";
import { fetchCrawl4aiTool, fetchStandardHtmlTool } from "./tools.js";
import {
  newsExtractionSchema,
  type AgentDecisionAudit,
  type AgentProcessResult,
} from "../types/ai.js";
import { processingEventBus } from "../services/processingEventBus.js";
import type { ProcessingTraceContext } from "../types/processing.js";

const SYSTEM_PROMPT = `You are a geo-spatial news extraction agent for Indian news articles.

Your task is to analyze news article content and extract structured data with a focus on geographic accuracy for India.

## Rules:
1. **Multi-Location Detection**: Identify ALL distinct Indian geographic locations mentioned ANYWHERE in the text — the headline, summary, or body. Each location is a separate entry in the "locations" array.
    - **CRITICAL: Scan the HEADLINE first and separately.** Headlines very often contain city names, state names, or region names (e.g., "Fire in Mumbai's Andheri", "Delhi records highest temperature", "Bengaluru tech firm lays off 200").
    - An article may reference multiple cities, states, districts, landmarks, or neighborhoods. Extract every single one.
    - For each location, provide the most granular detail available: location_name (landmark/neighborhood/district), city, and state.
    - If a city is mentioned, always include the corresponding state.
    - If only a state is mentioned, use the state as location_name with city null.
    - If no specific Indian location can be determined, return an empty locations array.
    - Recognize alternate/colonial names (Bombay=Mumbai, Calcutta=Kolkata, Madras=Chennai, Bangalore=Bengaluru, Baroda=Vadodara, etc.) and normalize them to their modern official names.

2. **Categorization**: Classify the article into one of these categories:
    - Politics: Elections, government, policy, political parties, parliament
    - Business: Markets, economy, companies, finance, trade, startups
    - Technology: AI, software, digital, cyber, internet, tech companies
    - Sports: Cricket, football, IPL, tournaments, athletes, matches
    - Entertainment: Bollywood, films, music, actors, series, streaming
    - Crime: Arrests, fraud, theft, murder, police actions, investigations
    - Weather: Rain, cyclone, flood, heatwave, monsoon, temperature
    - General: Anything that doesn't fit the above categories
    - Uncategorized / National: National-level news with no specific city/state (e.g., union budget, national policy announcements)

3. **Headline**: Write a concise, factual headline (under 100 characters). Do NOT use clickbait.

4. **Summary**: Write a 2-3 sentence summary including the key facts, who/what/where/when, and relevant context.

5. **Tool Usage**: If the provided content is insufficient to determine geographic locations within India, use the available tools to fetch more content from the article URL. Try fetch_crawl4ai first, then fetch_standard_html as fallback.

6. **Geographic Precision**: Always prefer the most granular location. "Koramangala, Bengaluru" is better than just "Bengaluru". "Bengaluru" is better than "Karnataka".

## Examples:
- "Fire in Mumbai, floods in Chennai" → locations: [{location_name: "Mumbai", city: "Mumbai", state: "Maharashtra"}, {location_name: "Chennai", city: "Chennai", state: "Tamil Nadu"}]
- "PM inaugurates highway in Rajasthan" → locations: [{location_name: null, city: null, state: "Rajasthan"}]
- "India's GDP grows 7%" → locations: [] (national-level, no specific location)
- "Delhi records highest temperature this summer" → locations: [{location_name: "Delhi", city: "Delhi", state: "Delhi"}]
- "Bengaluru tech startup raises $50M in Series B funding" → locations: [{location_name: null, city: "Bengaluru", state: "Karnataka"}]
- "Heavy rains lash Kerala, red alert in Wayanad and Idukki" → locations: [{location_name: "Wayanad", city: null, state: "Kerala"}, {location_name: "Idukki", city: null, state: "Kerala"}]
- "Metro expansion approved in Pune and Nagpur" → locations: [{location_name: null, city: "Pune", state: "Maharashtra"}, {location_name: null, city: "Nagpur", state: "Maharashtra"}]
- "Earthquake tremors felt in Guwahati, Assam" → locations: [{location_name: "Guwahati", city: "Guwahati", state: "Assam"}]
- "Srinagar-Leh highway closed due to snowfall" → locations: [{location_name: "Srinagar", city: "Srinagar", state: "Jammu and Kashmir"}, {location_name: "Leh", city: "Leh", state: "Ladakh"}]
- "Crackdown on drug syndicate operating from Punjab" → locations: [{location_name: null, city: null, state: "Punjab"}]
- "Woman murdered in Noida sector 62" → locations: [{location_name: "Sector 62, Noida", city: "Noida", state: "Uttar Pradesh"}]

## Important:
- Only identify locations in India.
- Extract ALL distinct locations mentioned, not just the primary one.
- ALWAYS check the headline for location names — they are often embedded there and easy to miss.
- If the article is about national-level news with no specific city/state, return an empty locations array and use category "Uncategorized / National".
- Never fabricate or guess locations. If uncertain, omit that location.`;

const REASONING_FLUSH_INTERVAL_MS = 300;

function formatTokenSummary(usage: {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
}): string {
  return [
    usage.inputTokens != null ? `in=${usage.inputTokens}` : null,
    usage.outputTokens != null ? `out=${usage.outputTokens}` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

function extractEstimatedCostUsd(
  providerMetadata: unknown,
): number | undefined {
  if (!providerMetadata || typeof providerMetadata !== "object") {
    return undefined;
  }

  const candidates = new Set([
    "cost",
    "costUsd",
    "estimatedCostUsd",
    "totalCost",
    "total_cost",
  ]);

  const inspectRecord = (
    value: Record<string, unknown>,
  ): number | undefined => {
    for (const [key, nestedValue] of Object.entries(value)) {
      if (candidates.has(key)) {
        if (typeof nestedValue === "number" && Number.isFinite(nestedValue)) {
          return nestedValue;
        }

        if (typeof nestedValue === "string") {
          const parsed = Number(nestedValue);
          if (Number.isFinite(parsed)) {
            return parsed;
          }
        }
      }

      if (nestedValue && typeof nestedValue === "object") {
        const nestedCost = inspectRecord(
          nestedValue as Record<string, unknown>,
        );
        if (nestedCost != null) {
          return nestedCost;
        }
      }
    }

    return undefined;
  };

  return inspectRecord(providerMetadata as Record<string, unknown>);
}

export class AgentService {
  private isEnabled(): boolean {
    return isAiEnabled();
  }

  async processArticle(
    headline: string,
    content: string,
    sourceUrl: string,
    fullRssContent?: string,
    traceContext: ProcessingTraceContext = {},
  ): Promise<AgentProcessResult | null> {
    if (!this.isEnabled()) {
      logger.debug(
        "OpenRouter API key not configured; skipping AI agent processing",
      );
      return null;
    }

    const startedAt = Date.now();
    const articleStreamId = randomUUID();

    const emitProcessingEvent = (
      entry: Omit<
        Parameters<typeof processingEventBus.emitLog>[0],
        "sourceUrl" | "headline"
      >,
    ): void => {
      processingEventBus.emitLog({
        runId: traceContext.runId,
        jobId: traceContext.jobId,
        traceId: traceContext.traceId,
        articleId: traceContext.articleId,
        feedUrl: traceContext.feedUrl,
        attempt: traceContext.attempt,
        sourceUrl,
        headline,
        ...entry,
      });
    };

    emitProcessingEvent({
      stage: "ai_processing",
      message: "Streaming article to AI model...",
      status: "start",
      eventType: "start",
      streamId: articleStreamId,
    });

    const audit: AgentDecisionAudit = {
      decisionPath: "Agent_Invoked",
      toolsInvoked: [],
      toolResults: [],
      extractionAttempts: 1,
      totalLatencyMs: 0,
    };

    const contentSection =
      fullRssContent && fullRssContent.length > content.length
        ? `## RSS Summary:\n${content}\n\n## Full Article Content:\n${fullRssContent}`
        : `## Content:\n${content}`;

    const userContent = [
      `## Article URL: ${sourceUrl}`,
      `## Headline: ${headline}`,
      contentSection,
      "",
      "Extract the structured data from this Indian news article.",
      "**IMPORTANT**: First carefully scan the HEADLINE above for any Indian city, state, district, or region names. Then scan the content. Extract ALL locations found in either.",
      "If the content above lacks sufficient geographic detail, use the available tools to fetch the full article from the URL before producing your final extraction.",
    ].join("\n");

    try {
      const result = streamText({
        model: aiModel,
        output: Output.object({ schema: newsExtractionSchema }),
        system: SYSTEM_PROMPT,
        prompt: userContent,
        tools: {
          fetch_crawl4ai: fetchCrawl4aiTool,
          fetch_standard_html: fetchStandardHtmlTool,
        },
        stopWhen: stepCountIs(4),
      });

      let reasoningBuffer = "";
      let lastReasoningFlush = 0;
      let reasoningStreamId: string | undefined;
      let stepNumber = 0;

      for await (const chunk of result.fullStream) {
        switch (chunk.type) {
          case "start-step": {
            stepNumber += 1;
            if (reasoningBuffer.length > 0) {
              emitProcessingEvent({
                stage: "ai_reasoning",
                message: reasoningBuffer,
                status: "info",
                eventType: "end",
                streamId: reasoningStreamId,
                isStreaming: false,
                metadata: { reasoningLength: reasoningBuffer.length },
              });
              reasoningBuffer = "";
              reasoningStreamId = undefined;
            }
            emitProcessingEvent({
              stage: "ai_processing",
              message: `LLM step ${stepNumber} started...`,
              status: "start",
              eventType: "start",
              streamId: articleStreamId,
              metadata: { stepNumber },
            });
            break;
          }

          case "reasoning-delta": {
            reasoningBuffer += chunk.text;
            if (!reasoningStreamId) {
              reasoningStreamId = randomUUID();
            }
            const now = Date.now();
            if (now - lastReasoningFlush >= REASONING_FLUSH_INTERVAL_MS) {
              const delta = reasoningBuffer;
              reasoningBuffer = "";
              lastReasoningFlush = now;
              emitProcessingEvent({
                stage: "ai_reasoning",
                message: delta,
                status: "info",
                eventType: "checkpoint",
                streamId: reasoningStreamId,
                isStreaming: true,
                metadata: { reasoningChunkLength: delta.length },
              });
            }
            break;
          }

          case "reasoning-end": {
            if (reasoningBuffer.length > 0) {
              emitProcessingEvent({
                stage: "ai_reasoning",
                message: reasoningBuffer,
                status: "info",
                eventType: "end",
                streamId: reasoningStreamId,
                isStreaming: false,
                metadata: { reasoningLength: reasoningBuffer.length },
              });
              reasoningBuffer = "";
              reasoningStreamId = undefined;
            }
            break;
          }

          case "tool-call": {
            audit.toolsInvoked.push(chunk.toolName);
            emitProcessingEvent({
              stage: "ai_tool_call",
              message: `Invoking tool: ${chunk.toolName}`,
              status: "info",
              eventType: "start",
              streamId: articleStreamId,
              metadata: { toolName: chunk.toolName },
            });
            break;
          }

          case "tool-result": {
            const resultData = chunk.output as
              | { success: boolean; error?: string | null }
              | undefined;
            const success = resultData?.success ?? false;

            audit.toolResults.push({
              tool: chunk.toolName,
              success,
              latencyMs: 0,
            });
            audit.extractionAttempts += 1;

            emitProcessingEvent({
              stage: "ai_tool_call",
              message: `Tool ${chunk.toolName} ${success ? "succeeded" : "failed"}`,
              status: success ? "success" : "warn",
              eventType: "end",
              streamId: articleStreamId,
              metadata: {
                toolName: chunk.toolName,
                success,
                ...(success ? {} : { failureType: "ai_tool_failed" }),
              },
            });
            break;
          }

          case "finish-step": {
            const stepTokenSummary = formatTokenSummary(chunk.usage);
            emitProcessingEvent({
              stage: "ai_processing",
              message: `Step ${stepNumber} done [${stepTokenSummary}] reason=${chunk.finishReason}`,
              status: "success",
              eventType: "end",
              streamId: articleStreamId,
              metadata: {
                stepNumber,
                finishReason: chunk.finishReason,
                inputTokens: chunk.usage.inputTokens,
                outputTokens: chunk.usage.outputTokens,
                providerMetadata: chunk.providerMetadata,
              },
            });
            break;
          }

          case "error": {
            emitProcessingEvent({
              stage: "error",
              message: `Stream error: ${chunk.error instanceof Error ? chunk.error.message : "Unknown error"}`,
              status: "error",
              eventType: "error",
              streamId: articleStreamId,
              metadata: { failureType: "ai_stream_error" },
            });
            break;
          }
        }
      }

      const [
        totalUsage,
        extraction,
        steps,
        providerMetadataResult,
        reasoningText,
      ] = await Promise.all([
        result.totalUsage,
        result.output,
        result.steps,
        result.providerMetadata,
        result.reasoningText,
      ]);

      audit.totalLatencyMs = Date.now() - startedAt;

      const reasoningTokens =
        totalUsage.outputTokenDetails?.reasoningTokens ?? undefined;

      audit.tokensUsed = {
        prompt: totalUsage.inputTokens ?? undefined,
        completion: totalUsage.outputTokens ?? undefined,
        total: totalUsage.totalTokens ?? undefined,
        reasoning: reasoningTokens,
      };

      if (audit.totalLatencyMs > 0 && totalUsage.totalTokens) {
        audit.throughputTokensPerSecond = Math.round(
          (totalUsage.totalTokens / audit.totalLatencyMs) * 1000,
        );
      }

      audit.reasoningText = reasoningText;

      if (providerMetadataResult) {
        audit.providerMetadata = providerMetadataResult as Record<
          string,
          unknown
        >;
      }

      const estimatedCostUsd = extractEstimatedCostUsd(providerMetadataResult);

      if (audit.toolsInvoked.length === 0) {
        audit.decisionPath = "Agent_RSS_Sufficient";
      } else {
        const toolSummary = audit.toolResults
          .map((t) => `${t.tool} -> ${t.success ? "Success" : "Failed"}`)
          .join(" -> ");
        audit.decisionPath = `Agent_Invoked -> ${toolSummary} -> Extracted`;
      }

      const finalTokenSummary = [
        totalUsage.inputTokens != null ? `in=${totalUsage.inputTokens}` : null,
        totalUsage.outputTokens != null
          ? `out=${totalUsage.outputTokens}`
          : null,
        reasoningTokens != null ? `reasoning=${reasoningTokens}` : null,
        totalUsage.totalTokens != null
          ? `total=${totalUsage.totalTokens}`
          : null,
        audit.throughputTokensPerSecond != null
          ? `${audit.throughputTokensPerSecond} tok/s`
          : null,
      ]
        .filter(Boolean)
        .join(", ");

      emitProcessingEvent({
        stage: "ai_processing",
        message: `Stream complete [${finalTokenSummary}] in ${audit.totalLatencyMs}ms (${steps.length} steps)`,
        status: "success",
        eventType: "end",
        durationMs: audit.totalLatencyMs,
        streamId: articleStreamId,
        metadata: {
          inputTokens: totalUsage.inputTokens,
          outputTokens: totalUsage.outputTokens,
          reasoningTokens,
          totalTokens: totalUsage.totalTokens,
          estimatedCostUsd,
          throughputTokensPerSecond: audit.throughputTokensPerSecond,
          latencyMs: audit.totalLatencyMs,
          providerMetadata: providerMetadataResult,
        },
      });

      logger.info(
        {
          decisionPath: audit.decisionPath,
          toolsInvoked: audit.toolsInvoked,
          extractionAttempts: audit.extractionAttempts,
          totalLatencyMs: audit.totalLatencyMs,
          tokensUsed: audit.tokensUsed,
          throughputTokensPerSecond: audit.throughputTokensPerSecond,
          reasoningTokens,
          category: extraction.category,
          locationCount: extraction.locations.length,
          locations: extraction.locations.map(
            (l) => `${l.city ?? l.state ?? l.location_name ?? "unknown"}`,
          ),
        },
        "AI agent successfully processed article",
      );

      return { extraction, audit };
    } catch (error) {
      audit.totalLatencyMs = Date.now() - startedAt;
      audit.decisionPath = `${audit.decisionPath} -> Agent_Failed`;

      emitProcessingEvent({
        stage: "error",
        message: `AI agent failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        status: "error",
        eventType: "error",
        durationMs: audit.totalLatencyMs,
        streamId: articleStreamId,
        metadata: { failureType: "ai_agent_failed" },
      });

      logger.error(
        {
          error,
          sourceUrl,
          decisionPath: audit.decisionPath,
          totalLatencyMs: audit.totalLatencyMs,
        },
        "AI agent processing failed",
      );

      return null;
    }
  }
}

export const agentService = new AgentService();
