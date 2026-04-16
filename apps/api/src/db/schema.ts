import {
  boolean,
  bigserial,
  integer,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const newsItems = pgTable(
  "news_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceUrl: text("source_url").notNull().unique(),
    headline: text("headline").notNull(),
    summary: text("summary").notNull(),
    category: text("category").notNull(),
    isNational: boolean("is_national").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    contentHash: varchar("content_hash", { length: 64 }),
  },
  (table) => [
    index("idx_news_items_published_at").on(table.publishedAt),
    index("idx_news_items_content_hash").on(table.contentHash),
  ],
);

export const newsItemLocations = pgTable(
  "news_item_locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    newsItemId: uuid("news_item_id")
      .notNull()
      .references(() => newsItems.id, { onDelete: "cascade" }),
    locationName: text("location_name"),
    city: text("city"),
    state: text("state"),
    isPrimary: boolean("is_primary").notNull().default(false),
    geom: text("geom"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_news_item_locations_news_item_id").on(table.newsItemId),
  ],
);

export const ingestionRuns = pgTable(
  "ingestion_runs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: text("run_id"),
    jobId: text("job_id"),
    traceId: text("trace_id"),
    feedUrl: text("feed_url").notNull(),
    sourceUrl: text("source_url"),
    headline: text("headline"),
    newsItemId: uuid("news_item_id").references(() => newsItems.id, {
      onDelete: "set null",
    }),
    step: text("step"),
    decisionPath: text("decision_path").notNull(),
    status: text("status").notNull(),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_ingestion_runs_run_id").on(table.runId),
    index("idx_ingestion_runs_job_id").on(table.jobId),
    index("idx_ingestion_runs_trace_id").on(table.traceId),
    index("idx_ingestion_runs_source_url").on(table.sourceUrl),
    index("idx_ingestion_runs_started_at").on(table.startedAt),
  ],
);

export const processingLogs = pgTable(
  "processing_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: text("run_id"),
    jobId: text("job_id"),
    traceId: text("trace_id"),
    articleId: uuid("article_id").references(() => newsItems.id, {
      onDelete: "set null",
    }),
    sourceUrl: text("source_url").notNull(),
    feedUrl: text("feed_url"),
    eventType: text("event_type").notNull().default("checkpoint"),
    durationMs: integer("duration_ms"),
    attempt: integer("attempt"),
    headline: text("headline"),
    stage: text("stage").notNull(),
    message: text("message").notNull(),
    status: text("status").notNull().default("info"),
    streamId: text("stream_id"),
    isStreaming: boolean("is_streaming").notNull().default(false),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_processing_logs_created_at").on(table.createdAt),
    index("idx_processing_logs_source_url").on(table.sourceUrl),
    index("idx_processing_logs_run_id").on(table.runId),
    index("idx_processing_logs_job_id").on(table.jobId),
    index("idx_processing_logs_trace_id").on(table.traceId),
    index("idx_processing_logs_article_id").on(table.articleId),
    index("idx_processing_logs_trace_created_at").on(
      table.traceId,
      table.createdAt,
    ),
    index("idx_processing_logs_job_created_at").on(
      table.jobId,
      table.createdAt,
    ),
    index("idx_processing_logs_status_created_at").on(
      table.status,
      table.createdAt,
    ),
    index("idx_processing_logs_stage_created_at").on(
      table.stage,
      table.createdAt,
    ),
  ],
);
