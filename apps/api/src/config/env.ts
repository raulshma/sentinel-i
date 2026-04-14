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
  OPENROUTER_API_KEY: z.string().optional(),
  GEOCODE_API_KEY: z.string().optional(),
  GEOCODE_BASE_URL: z.string().url().default('https://geocode.maps.co'),
  CRAWL4AI_API_URL: z.string().optional(),
  CRAWL4AI_API_KEY: z.string().optional(),
  RSS_SYNC_CRON: z.string().default('*/15 * * * *'),
})

export const env = envSchema.parse(process.env)
