ALTER TABLE "ingestion_runs" ADD COLUMN IF NOT EXISTS "run_id" text;
ALTER TABLE "ingestion_runs" ADD COLUMN IF NOT EXISTS "job_id" text;
ALTER TABLE "ingestion_runs" ADD COLUMN IF NOT EXISTS "trace_id" text;
ALTER TABLE "ingestion_runs" ADD COLUMN IF NOT EXISTS "source_url" text;
ALTER TABLE "ingestion_runs" ADD COLUMN IF NOT EXISTS "headline" text;
ALTER TABLE "ingestion_runs" ADD COLUMN IF NOT EXISTS "news_item_id" uuid;
ALTER TABLE "ingestion_runs" ADD COLUMN IF NOT EXISTS "step" text;

DO $$ BEGIN
 ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_news_item_id_news_items_id_fk" FOREIGN KEY ("news_item_id") REFERENCES "public"."news_items"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "processing_logs" ADD COLUMN IF NOT EXISTS "run_id" text;
ALTER TABLE "processing_logs" ADD COLUMN IF NOT EXISTS "job_id" text;
ALTER TABLE "processing_logs" ADD COLUMN IF NOT EXISTS "trace_id" text;
ALTER TABLE "processing_logs" ADD COLUMN IF NOT EXISTS "article_id" uuid;
ALTER TABLE "processing_logs" ADD COLUMN IF NOT EXISTS "feed_url" text;
ALTER TABLE "processing_logs" ADD COLUMN IF NOT EXISTS "event_type" text DEFAULT 'checkpoint' NOT NULL;
ALTER TABLE "processing_logs" ADD COLUMN IF NOT EXISTS "duration_ms" integer;
ALTER TABLE "processing_logs" ADD COLUMN IF NOT EXISTS "attempt" integer;
ALTER TABLE "processing_logs" ADD COLUMN IF NOT EXISTS "stream_id" text;
ALTER TABLE "processing_logs" ADD COLUMN IF NOT EXISTS "is_streaming" boolean DEFAULT false NOT NULL;

DO $$ BEGIN
 ALTER TABLE "processing_logs" ADD CONSTRAINT "processing_logs_article_id_news_items_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."news_items"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "idx_ingestion_runs_run_id" ON "ingestion_runs" USING btree ("run_id");
CREATE INDEX IF NOT EXISTS "idx_ingestion_runs_job_id" ON "ingestion_runs" USING btree ("job_id");
CREATE INDEX IF NOT EXISTS "idx_ingestion_runs_trace_id" ON "ingestion_runs" USING btree ("trace_id");
CREATE INDEX IF NOT EXISTS "idx_ingestion_runs_source_url" ON "ingestion_runs" USING btree ("source_url");
CREATE INDEX IF NOT EXISTS "idx_ingestion_runs_started_at" ON "ingestion_runs" USING btree ("started_at");

CREATE INDEX IF NOT EXISTS "idx_processing_logs_run_id" ON "processing_logs" USING btree ("run_id");
CREATE INDEX IF NOT EXISTS "idx_processing_logs_job_id" ON "processing_logs" USING btree ("job_id");
CREATE INDEX IF NOT EXISTS "idx_processing_logs_trace_id" ON "processing_logs" USING btree ("trace_id");
CREATE INDEX IF NOT EXISTS "idx_processing_logs_article_id" ON "processing_logs" USING btree ("article_id");
CREATE INDEX IF NOT EXISTS "idx_processing_logs_trace_created_at" ON "processing_logs" USING btree ("trace_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_processing_logs_job_created_at" ON "processing_logs" USING btree ("job_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_processing_logs_status_created_at" ON "processing_logs" USING btree ("status", "created_at");
CREATE INDEX IF NOT EXISTS "idx_processing_logs_stage_created_at" ON "processing_logs" USING btree ("stage", "created_at");
