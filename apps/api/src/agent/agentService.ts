import { randomUUID } from 'node:crypto'

import { streamText, Output, stepCountIs } from 'ai'

import { aiModel, isAiEnabled } from '../config/ai.js'
import { isDevToolsEnabled } from '../config/env.js'
import { logger } from '../config/logger.js'
import { fetchCrawl4aiTool, fetchStandardHtmlTool } from './tools.js'
import {
  newsExtractionSchema,
  type AgentDecisionAudit,
  type AgentProcessResult,
} from '../types/ai.js'
import { processingEventBus } from '../services/processingEventBus.js'

const SYSTEM_PROMPT = `You are a geo-spatial news extraction agent for Indian news articles.

Your task is to analyze news article content and extract structured data with a focus on geographic accuracy for India.

## Rules:
1. **Multi-Location Detection**: Identify ALL distinct Indian geographic locations mentioned in the article. Each location is a separate entry in the "locations" array.
    - An article may reference multiple cities, states, districts, landmarks, or neighborhoods. Extract each one.
    - For each location, provide the most granular detail available: location_name (landmark/neighborhood), city, and state.
    - If a city is mentioned, include the state if known.
    - If only a state is mentioned, use the state as location_name with city null.
    - If no specific Indian location can be determined, return an empty locations array.

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

## Important:
- Only identify locations in India.
- Extract ALL distinct locations mentioned, not just the primary one.
- If the article is about national-level news with no specific city/state, return an empty locations array and use category "Uncategorized / National".
- Never fabricate or guess locations. If uncertain, omit that location.`

const REASONING_FLUSH_INTERVAL_MS = 150

function formatTokenSummary(usage: { inputTokens?: number | undefined; outputTokens?: number | undefined }): string {
  return [
    usage.inputTokens != null ? `in=${usage.inputTokens}` : null,
    usage.outputTokens != null ? `out=${usage.outputTokens}` : null,
  ].filter(Boolean).join(', ')
}

export class AgentService {
  private isEnabled(): boolean {
    return isAiEnabled()
  }

  async processArticle(
    headline: string,
    content: string,
    sourceUrl: string,
  ): Promise<AgentProcessResult | null> {
    if (!this.isEnabled()) {
      logger.debug('OpenRouter API key not configured; skipping AI agent processing')
      return null
    }

    const startedAt = Date.now()
    const articleStreamId = randomUUID()

    if (isDevToolsEnabled) {
      processingEventBus.emitLog({
        sourceUrl,
        headline,
        stage: 'ai_processing',
        message: 'Streaming article to AI model...',
        status: 'start',
        streamId: articleStreamId,
      })
    }

    const audit: AgentDecisionAudit = {
      decisionPath: 'Agent_Invoked',
      toolsInvoked: [],
      toolResults: [],
      extractionAttempts: 1,
      totalLatencyMs: 0,
    }

    const userContent = [
      `## Article URL: ${sourceUrl}`,
      `## Headline: ${headline}`,
      `## Content:\n${content}`,
      '',
      'Extract the structured data from this Indian news article. If the content above lacks sufficient geographic detail, use the available tools to fetch the full article from the URL before producing your final extraction.',
    ].join('\n')

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
      })

      let reasoningBuffer = ''
      let lastReasoningFlush = 0
      let reasoningStreamId: string | undefined
      let stepNumber = 0

      for await (const chunk of result.fullStream) {
        switch (chunk.type) {
          case 'start-step': {
            stepNumber += 1
            if (reasoningBuffer.length > 0) {
              if (isDevToolsEnabled) {
                processingEventBus.emitLog({
                  sourceUrl,
                  headline,
                  stage: 'ai_reasoning',
                  message: reasoningBuffer,
                  status: 'info',
                  streamId: reasoningStreamId,
                  isStreaming: false,
                  metadata: { reasoningLength: reasoningBuffer.length },
                })
              }
              reasoningBuffer = ''
              reasoningStreamId = undefined
            }
            if (isDevToolsEnabled) {
              processingEventBus.emitLog({
                sourceUrl,
                headline,
                stage: 'ai_processing',
                message: `LLM step ${stepNumber} started...`,
                status: 'start',
                streamId: articleStreamId,
                metadata: { stepNumber },
              })
            }
            break
          }

          case 'reasoning-delta': {
            reasoningBuffer += chunk.text
            if (!reasoningStreamId) {
              reasoningStreamId = randomUUID()
            }
            if (isDevToolsEnabled) {
              const now = Date.now()
              if (now - lastReasoningFlush >= REASONING_FLUSH_INTERVAL_MS) {
                lastReasoningFlush = now
                processingEventBus.emitLog({
                  sourceUrl,
                  headline,
                  stage: 'ai_reasoning',
                  message: reasoningBuffer,
                  status: 'info',
                  streamId: reasoningStreamId,
                  isStreaming: true,
                })
              }
            }
            break
          }

          case 'reasoning-end': {
            if (reasoningBuffer.length > 0) {
              if (isDevToolsEnabled) {
                processingEventBus.emitLog({
                  sourceUrl,
                  headline,
                  stage: 'ai_reasoning',
                  message: reasoningBuffer,
                  status: 'info',
                  streamId: reasoningStreamId,
                  isStreaming: false,
                  metadata: { reasoningLength: reasoningBuffer.length },
                })
              }
              reasoningBuffer = ''
              reasoningStreamId = undefined
            }
            break
          }

          case 'tool-call': {
            audit.toolsInvoked.push(chunk.toolName)
            if (isDevToolsEnabled) {
              processingEventBus.emitLog({
                sourceUrl,
                headline,
                stage: 'ai_tool_call',
                message: `Invoking tool: ${chunk.toolName}`,
                status: 'info',
                streamId: articleStreamId,
                metadata: { toolName: chunk.toolName },
              })
            }
            break
          }

          case 'tool-result': {
            const resultData = chunk.output as
              | { success: boolean; error?: string | null }
              | undefined
            const success = resultData?.success ?? false

            audit.toolResults.push({
              tool: chunk.toolName,
              success,
              latencyMs: 0,
            })
            audit.extractionAttempts += 1

            if (isDevToolsEnabled) {
              processingEventBus.emitLog({
                sourceUrl,
                headline,
                stage: 'ai_tool_call',
                message: `Tool ${chunk.toolName} ${success ? 'succeeded' : 'failed'}`,
                status: success ? 'success' : 'warn',
                streamId: articleStreamId,
                metadata: { toolName: chunk.toolName, success },
              })
            }
            break
          }

          case 'finish-step': {
            if (isDevToolsEnabled) {
              const stepTokenSummary = formatTokenSummary(chunk.usage)
              processingEventBus.emitLog({
                sourceUrl,
                headline,
                stage: 'ai_processing',
                message: `Step ${stepNumber} done [${stepTokenSummary}] reason=${chunk.finishReason}`,
                status: 'success',
                streamId: articleStreamId,
                metadata: {
                  stepNumber,
                  finishReason: chunk.finishReason,
                  inputTokens: chunk.usage.inputTokens,
                  outputTokens: chunk.usage.outputTokens,
                  providerMetadata: chunk.providerMetadata,
                },
              })
            }
            break
          }

          case 'error': {
            if (isDevToolsEnabled) {
              processingEventBus.emitLog({
                sourceUrl,
                headline,
                stage: 'error',
                message: `Stream error: ${chunk.error instanceof Error ? chunk.error.message : 'Unknown error'}`,
                status: 'error',
                streamId: articleStreamId,
              })
            }
            break
          }
        }
      }

      const [totalUsage, extraction, steps, providerMetadataResult, reasoningText] = await Promise.all([
        result.totalUsage,
        result.output,
        result.steps,
        result.providerMetadata,
        result.reasoningText,
      ])

      audit.totalLatencyMs = Date.now() - startedAt

      const reasoningTokens = totalUsage.outputTokenDetails?.reasoningTokens ?? undefined

      audit.tokensUsed = {
        prompt: totalUsage.inputTokens ?? undefined,
        completion: totalUsage.outputTokens ?? undefined,
        total: totalUsage.totalTokens ?? undefined,
        reasoning: reasoningTokens,
      }

      if (audit.totalLatencyMs > 0 && totalUsage.totalTokens) {
        audit.throughputTokensPerSecond = Math.round((totalUsage.totalTokens / audit.totalLatencyMs) * 1000)
      }

      audit.reasoningText = reasoningText

      if (providerMetadataResult) {
        audit.providerMetadata = providerMetadataResult as Record<string, unknown>
      }

      if (audit.toolsInvoked.length === 0) {
        audit.decisionPath = 'Agent_RSS_Sufficient'
      } else {
        const toolSummary = audit.toolResults
          .map((t) => `${t.tool} -> ${t.success ? 'Success' : 'Failed'}`)
          .join(' -> ')
        audit.decisionPath = `Agent_Invoked -> ${toolSummary} -> Extracted`
      }

      if (isDevToolsEnabled) {
        const finalTokenSummary = [
          totalUsage.inputTokens != null ? `in=${totalUsage.inputTokens}` : null,
          totalUsage.outputTokens != null ? `out=${totalUsage.outputTokens}` : null,
          reasoningTokens != null ? `reasoning=${reasoningTokens}` : null,
          totalUsage.totalTokens != null ? `total=${totalUsage.totalTokens}` : null,
          audit.throughputTokensPerSecond != null ? `${audit.throughputTokensPerSecond} tok/s` : null,
        ].filter(Boolean).join(', ')

        processingEventBus.emitLog({
          sourceUrl,
          headline,
          stage: 'ai_processing',
          message: `Stream complete [${finalTokenSummary}] in ${audit.totalLatencyMs}ms (${steps.length} steps)`,
          status: 'success',
          streamId: articleStreamId,
          metadata: {
            inputTokens: totalUsage.inputTokens,
            outputTokens: totalUsage.outputTokens,
            reasoningTokens,
            totalTokens: totalUsage.totalTokens,
            throughputTokensPerSecond: audit.throughputTokensPerSecond,
            latencyMs: audit.totalLatencyMs,
            providerMetadata: providerMetadataResult,
          },
        })
      }

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
          locations: extraction.locations.map((l) => `${l.city ?? l.state ?? l.location_name ?? 'unknown'}`),
        },
        'AI agent successfully processed article',
      )

      return { extraction, audit }
    } catch (error) {
      audit.totalLatencyMs = Date.now() - startedAt
      audit.decisionPath = `${audit.decisionPath} -> Agent_Failed`

      if (isDevToolsEnabled) {
        processingEventBus.emitLog({
          sourceUrl,
          headline,
          stage: 'error',
          message: `AI agent failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          status: 'error',
          streamId: articleStreamId,
        })
      }

      logger.error(
        {
          error,
          sourceUrl,
          decisionPath: audit.decisionPath,
          totalLatencyMs: audit.totalLatencyMs,
        },
        'AI agent processing failed',
      )

      return null
    }
  }
}

export const agentService = new AgentService()
