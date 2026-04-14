import { generateText, Output, stepCountIs } from "ai";

import { aiModel, isAiEnabled } from "../config/ai.js";
import { isLiveUpdatesEnabled } from "../config/env.js";
import { logger } from "../config/logger.js";
import { fetchCrawl4aiTool, fetchStandardHtmlTool } from "./tools.js";
import {
  newsExtractionSchema,
  type AgentDecisionAudit,
  type AgentProcessResult,
} from "../types/ai.js";
import { processingEventBus } from "../services/processingEventBus.js";

const SYSTEM_PROMPT = `You are a geo-spatial news extraction agent for Indian news articles.

Your task is to analyze news article content and extract structured data with a focus on geographic accuracy for India.

## Rules:
1. **Location Detection**: Identify specific Indian cities, states, districts, landmarks, or neighborhoods mentioned in the article. Use the most specific location available.
   - If a city is mentioned, use that as location_name along with the state.
   - If only a state is mentioned, use the state as location_name.
   - If no specific Indian location can be determined, set location_name, city, and state to null.

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

5. **Tool Usage**: If the provided content is insufficient to determine a specific geographic location within India, use the available tools to fetch more content from the article URL. Try fetch_crawl4ai first, then fetch_standard_html as fallback.

6. **Geographic Precision**: Always prefer the most granular location. "Koramangala, Bengaluru" is better than just "Bengaluru". "Bengaluru" is better than "Karnataka".

## Important:
- Only identify locations in India.
- If the article is about national-level news with no specific city/state, set location_name/city/state to null and use category "Uncategorized / National".
- Never fabricate or guess locations. If uncertain, mark as null.`;

export class AgentService {
  private isEnabled(): boolean {
    return isAiEnabled();
  }

  async processArticle(
    headline: string,
    content: string,
    sourceUrl: string,
  ): Promise<AgentProcessResult | null> {
    if (!this.isEnabled()) {
      logger.debug(
        "OpenRouter API key not configured; skipping AI agent processing",
      );
      return null;
    }

    const startedAt = Date.now();

    if (isLiveUpdatesEnabled) {
      processingEventBus.emitLog({
        sourceUrl,
        headline,
        stage: 'ai_processing',
        message: `Sending article to AI model for extraction...`,
        status: 'start',
      })
    }

    const audit: AgentDecisionAudit = {
      decisionPath: "Agent_Invoked",
      toolsInvoked: [],
      toolResults: [],
      extractionAttempts: 1,
      totalLatencyMs: 0,
    };

    const userContent = [
      `## Article URL: ${sourceUrl}`,
      `## Headline: ${headline}`,
      `## Content:\n${content}`,
      "",
      "Extract the structured data from this Indian news article. If the content above lacks sufficient geographic detail, use the available tools to fetch the full article from the URL before producing your final extraction.",
    ].join("\n");

    try {
      const result = await generateText({
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

      audit.totalLatencyMs = Date.now() - startedAt;

      const usage = result.totalUsage;
      audit.tokensUsed = {
        prompt: usage.inputTokens ?? undefined,
        completion: usage.outputTokens ?? undefined,
        total: usage.totalTokens ?? undefined,
      };

      for (const step of result.steps) {
        if (step.toolCalls && step.toolCalls.length > 0) {
          for (const toolCall of step.toolCalls) {
            audit.toolsInvoked.push(toolCall.toolName);

            if (isLiveUpdatesEnabled) {
              processingEventBus.emitLog({
                sourceUrl,
                headline,
                stage: 'ai_tool_call',
                message: `AI agent invoked tool: ${toolCall.toolName}`,
                status: 'info',
                metadata: { toolName: toolCall.toolName },
              })
            }

            const matchedResult = step.toolResults.find(
              (r: { toolCallId: string }) =>
                r.toolCallId === toolCall.toolCallId,
            );

            const resultData = matchedResult?.output as
              | { success: boolean; error?: string | null }
              | undefined;

            audit.toolResults.push({
              tool: toolCall.toolName,
              success: resultData?.success ?? false,
              latencyMs: 0,
            });
          }
        }

        if (step.toolResults && step.toolResults.length > 0) {
          audit.extractionAttempts += 1;
        }
      }

      if (audit.toolsInvoked.length === 0) {
        audit.decisionPath = "Agent_RSS_Sufficient";
      } else {
        const toolSummary = audit.toolResults
          .map((t) => `${t.tool} -> ${t.success ? "Success" : "Failed"}`)
          .join(" -> ");
        audit.decisionPath = `Agent_Invoked -> ${toolSummary} -> Extracted`;
      }

      const extraction = result.output;

      logger.info(
        {
          decisionPath: audit.decisionPath,
          toolsInvoked: audit.toolsInvoked,
          extractionAttempts: audit.extractionAttempts,
          totalLatencyMs: audit.totalLatencyMs,
          tokensUsed: audit.tokensUsed,
          category: extraction.category,
          city: extraction.city,
          state: extraction.state,
        },
        "AI agent successfully processed article",
      );

      return {
        extraction,
        audit,
      };
    } catch (error) {
      audit.totalLatencyMs = Date.now() - startedAt;
      audit.decisionPath = `${audit.decisionPath} -> Agent_Failed`;

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
