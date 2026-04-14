import { config } from 'dotenv'
import { z } from 'zod'

config()

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgresql://postgres:postgres@localhost:5432/sentinel_i'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  AI_PROVIDER: z.enum(['openrouter']).default('openrouter'),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_BASE_URL: z
    .string()
    .url()
    .default('https://openrouter.ai/api/v1'),
  OPENROUTER_MODEL: z
    .string()
    .min(1)
    .default('nvidia/nemotron-3-super-120b-a12b:free'),
  GEOCODE_API_KEY: z.string().optional(),
  GEOCODE_BASE_URL: z.string().url().default('https://geocode.maps.co'),
  CREW4AI_API_URL: z.string().optional(),
  CREW4AI_API_KEY: z.string().optional(),
  CREW4AI_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  CRAWL4AI_API_URL: z.string().optional(),
  CRAWL4AI_API_KEY: z.string().optional(),
  RSS_FEED_URLS: z.string().optional(),
  RSS_SYNC_CRON: z.string().default('*/15 * * * *'),
  HTTP_FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  CRAWL4AI_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
})

const parsedEnv = envSchema.parse(process.env)

const crawl4aiApiUrl = parsedEnv.CRAWL4AI_API_URL ?? parsedEnv.CREW4AI_API_URL
const crawl4aiApiKey = parsedEnv.CRAWL4AI_API_KEY ?? parsedEnv.CREW4AI_API_KEY
const crawl4aiTimeoutMs =
  parsedEnv.CRAWL4AI_TIMEOUT_MS ?? parsedEnv.CREW4AI_TIMEOUT_MS ?? 15_000

export const env = {
  ...parsedEnv,
  CRAWL4AI_API_URL: crawl4aiApiUrl,
  CRAWL4AI_API_KEY: crawl4aiApiKey,
  CRAWL4AI_TIMEOUT_MS: crawl4aiTimeoutMs,
  CREW4AI_API_URL: parsedEnv.CREW4AI_API_URL ?? crawl4aiApiUrl,
  CREW4AI_API_KEY: parsedEnv.CREW4AI_API_KEY ?? crawl4aiApiKey,
  CREW4AI_TIMEOUT_MS: parsedEnv.CREW4AI_TIMEOUT_MS ?? crawl4aiTimeoutMs,
}
