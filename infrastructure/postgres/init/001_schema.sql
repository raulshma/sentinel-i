CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS news_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url TEXT NOT NULL UNIQUE,
  headline TEXT NOT NULL,
  summary TEXT NOT NULL,
  category TEXT NOT NULL,
  location_name TEXT,
  city TEXT,
  state TEXT,
  is_national BOOLEAN NOT NULL DEFAULT FALSE,
  geom GEOGRAPHY(POINT, 4326),
  published_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_news_items_geom ON news_items USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_news_items_published_at ON news_items (published_at DESC);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id BIGSERIAL PRIMARY KEY,
  feed_url TEXT NOT NULL,
  decision_path TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);
