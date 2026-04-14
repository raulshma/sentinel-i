import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { LanguageModel } from 'ai'

import { env } from '../env.js'

export const name = 'openrouter'

export function createModel(): LanguageModel {
  const openrouter = createOpenRouter({
    apiKey: env.OPENROUTER_API_KEY ?? '',
  })
  return openrouter.chat(env.OPENROUTER_MODEL)
}

export function isConfigured(): boolean {
  return !!env.OPENROUTER_API_KEY
}
