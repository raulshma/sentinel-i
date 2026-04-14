import type { LanguageModel } from 'ai'

import { env } from './env.js'
import * as openrouterProvider from './providers/openrouter.js'

export interface ProviderAdapter {
  name: string
  createModel: () => LanguageModel
  isConfigured: () => boolean
}

const providerRegistry: Record<string, ProviderAdapter> = {
  openrouter: openrouterProvider as ProviderAdapter,
}

function resolveProvider(): ProviderAdapter {
  const provider = providerRegistry[env.AI_PROVIDER]
  if (!provider) {
    const available = Object.keys(providerRegistry).join(', ')
    throw new Error(
      `Unknown AI_PROVIDER "${env.AI_PROVIDER}". Available providers: ${available}`,
    )
  }
  return provider
}

const activeProvider = resolveProvider()

export const aiModel: LanguageModel = activeProvider.createModel()

export function isAiEnabled(): boolean {
  return activeProvider.isConfigured()
}
