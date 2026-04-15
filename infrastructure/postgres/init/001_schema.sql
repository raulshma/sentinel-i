CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS news_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url TEXT NOT NULL UNIQUE,
  headline TEXT NOT NULL,
  summary TEXT NOT NULL,
  category TEXT NOT NULL,
  is_national BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_news_items_published_at ON news_items (published_at DESC);

CREATE TABLE IF NOT EXISTS news_item_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  news_item_id UUID NOT NULL REFERENCES news_items(id) ON DELETE CASCADE,
  location_name TEXT,
  city TEXT,
  state TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  geom GEOGRAPHY(POINT, 4326),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_news_item_locations_geom ON news_item_locations USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_news_item_locations_news_item_id ON news_item_locations (news_item_id);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT,
  job_id TEXT,
  trace_id TEXT,
  feed_url TEXT NOT NULL,
  source_url TEXT,
  headline TEXT,
  news_item_id UUID REFERENCES news_items(id) ON DELETE SET NULL,
  step TEXT,
  decision_path TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_run_id ON ingestion_runs (run_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_job_id ON ingestion_runs (job_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_trace_id ON ingestion_runs (trace_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_source_url ON ingestion_runs (source_url);
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_started_at ON ingestion_runs (started_at DESC);
