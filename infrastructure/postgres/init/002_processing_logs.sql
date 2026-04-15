CREATE TABLE IF NOT EXISTS processing_logs (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT,
  job_id TEXT,
  trace_id TEXT,
  article_id UUID REFERENCES news_items(id) ON DELETE SET NULL,
  source_url TEXT NOT NULL,
  feed_url TEXT,
  event_type TEXT NOT NULL DEFAULT 'checkpoint',
  duration_ms INTEGER,
  attempt INTEGER,
  headline TEXT,
  stage TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'info',
  stream_id TEXT,
  is_streaming BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_processing_logs_created_at ON processing_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_processing_logs_source_url ON processing_logs (source_url);
CREATE INDEX IF NOT EXISTS idx_processing_logs_run_id ON processing_logs (run_id);
CREATE INDEX IF NOT EXISTS idx_processing_logs_job_id ON processing_logs (job_id);
CREATE INDEX IF NOT EXISTS idx_processing_logs_trace_id ON processing_logs (trace_id);
CREATE INDEX IF NOT EXISTS idx_processing_logs_article_id ON processing_logs (article_id);
CREATE INDEX IF NOT EXISTS idx_processing_logs_trace_created_at ON processing_logs (trace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_processing_logs_job_created_at ON processing_logs (job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_processing_logs_status_created_at ON processing_logs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_processing_logs_stage_created_at ON processing_logs (stage, created_at DESC);
