import { z } from 'zod'

export const locationExtractionSchema = z.object({
  location_name: z
    .string()
    .describe(
      'Specific landmark, neighborhood, or district mentioned. Null if not locally specific.',
    )
    .nullable(),
  city: z
    .string()
    .describe('City name if found. Null if not mentioned.')
    .nullable(),
  state: z
    .string()
    .describe('Indian state or union territory. Null if not mentioned.')
    .nullable(),
})

export const newsExtractionSchema = z.object({
  locations: z
    .array(locationExtractionSchema)
    .describe(
      'All distinct Indian geographic locations mentioned in the article. ' +
        'Include every city, state, district, landmark, or neighborhood that is referenced. ' +
        'Use an empty array only if no specific Indian location can be determined.',
    ),
  category: z
    .enum([
      'Politics',
      'Business',
      'Technology',
      'Sports',
      'Entertainment',
      'Crime',
      'Weather',
      'General',
      'Uncategorized / National',
    ])
    .describe('Best-fit category for the article.'),
  headline: z
    .string()
    .min(5)
    .describe('A concise, factual headline summarizing the article.'),
  summary: z
    .string()
    .min(20)
    .describe(
      'A 2-3 sentence summary of the article including key facts and context.',
    ),
})

export type NewsExtraction = z.infer<typeof newsExtractionSchema>

export interface AgentDecisionAudit {
  decisionPath: string
  toolsInvoked: string[]
  toolResults: Array<{ tool: string; success: boolean; latencyMs: number }>
  extractionAttempts: number
  totalLatencyMs: number
  tokensUsed?: {
    prompt?: number
    completion?: number
    total?: number
    reasoning?: number
  }
  throughputTokensPerSecond?: number
  reasoningText?: string
  providerMetadata?: Record<string, unknown>
}

export interface AgentProcessResult {
  extraction: NewsExtraction
  audit: AgentDecisionAudit
}
