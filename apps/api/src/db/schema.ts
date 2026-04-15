import {
  boolean,
  bigserial,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

export const newsItems = pgTable(
  'news_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceUrl: text('source_url').notNull().unique(),
    headline: text('headline').notNull(),
    summary: text('summary').notNull(),
    category: text('category').notNull(),
    isNational: boolean('is_national').notNull().default(false),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_news_items_published_at').on(table.publishedAt),
  ],
)

export const newsItemLocations = pgTable(
  'news_item_locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    newsItemId: uuid('news_item_id')
      .notNull()
      .references(() => newsItems.id, { onDelete: 'cascade' }),
    locationName: text('location_name'),
    city: text('city'),
    state: text('state'),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_news_item_locations_news_item_id').on(table.newsItemId),
  ],
)

export const ingestionRuns = pgTable('ingestion_runs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  feedUrl: text('feed_url').notNull(),
  decisionPath: text('decision_path').notNull(),
  status: text('status').notNull(),
  errorMessage: text('error_message'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
})

export const processingLogs = pgTable(
  'processing_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sourceUrl: text('source_url').notNull(),
    headline: text('headline'),
    stage: text('stage').notNull(),
    message: text('message').notNull(),
    status: text('status').notNull().default('info'),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_processing_logs_created_at').on(table.createdAt),
    index('idx_processing_logs_source_url').on(table.sourceUrl),
  ],
)
