import { z } from 'zod'

export const locationExtractionSchema = z.object({
  location_name: z
    .string()
    .describe(
      'Specific landmark, neighborhood, district, or area mentioned (e.g. "Sector 62, Noida", "Andheri", "Koramangala"). Null if only a city or state is mentioned.',
    )
    .nullable(),
  city: z
    .string()
    .describe('City name if found (e.g. "Mumbai", "Bengaluru", "Delhi"). Use the modern official name (Bengaluru not Bangalore, Kolkata not Calcutta). Null if not mentioned.')
    .nullable(),
  state: z
    .string()
    .describe('Indian state or union territory (e.g. "Maharashtra", "Karnataka", "Delhi"). Always fill this when a city is known. Null if not mentioned.')
    .nullable(),
})

export const newsExtractionSchema = z.object({
  locations: z
    .array(locationExtractionSchema)
    .min(0)
    .describe(
      'ALL distinct Indian geographic locations found in the HEADLINE and content. ' +
        'Carefully scan the headline first — it often contains city/state names. ' +
        'Then scan the full content for additional locations. ' +
        'Include every city, state, district, landmark, or neighborhood that is referenced. ' +
        'Use an empty array ONLY if no specific Indian location can be determined from either headline or content.',
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
