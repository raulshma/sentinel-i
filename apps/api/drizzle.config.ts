import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/sentinel_i',
  },
  tablesFilter: ['news_items', 'news_item_locations', 'ingestion_runs', 'processing_logs'],
})
