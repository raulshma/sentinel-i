DO $$ BEGIN
  ALTER TABLE "news_items" ADD COLUMN "content_hash" varchar(64);
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "idx_news_items_content_hash" ON "news_items" USING "btree" ("content_hash");
