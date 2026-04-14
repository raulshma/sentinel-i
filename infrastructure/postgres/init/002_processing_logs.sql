CREATE TABLE IF NOT EXISTS processing_logs (
  id BIGSERIAL PRIMARY KEY,
  source_url TEXT NOT NULL,
  headline TEXT,
  stage TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'info',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_processing_logs_created_at ON processing_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_processing_logs_source_url ON processing_logs (source_url);
