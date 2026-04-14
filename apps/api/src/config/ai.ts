import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

import { env } from './env.js'

export const openrouter = createOpenAICompatible({
  name: 'openrouter',
  baseURL: env.OPENROUTER_BASE_URL,
  apiKey: env.OPENROUTER_API_KEY,
  headers: {
    'HTTP-Referer': 'https://sentinel-i.local',
    'X-Title': 'Sentinel-i',
  },
})

export const aiModel = openrouter.chatModel(env.OPENROUTER_MODEL)
