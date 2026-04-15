ALTER TABLE "news_item_locations" ADD COLUMN "geom" geography(POINT, 4326);
CREATE INDEX "idx_news_item_locations_geom" ON "news_item_locations" USING GIST ("geom");
