CREATE TABLE "ingestion_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"feed_url" text NOT NULL,
	"decision_path" text NOT NULL,
	"status" text NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "news_item_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"news_item_id" uuid NOT NULL,
	"location_name" text,
	"city" text,
	"state" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_url" text NOT NULL,
	"headline" text NOT NULL,
	"summary" text NOT NULL,
	"category" text NOT NULL,
	"is_national" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_items_source_url_unique" UNIQUE("source_url")
);
--> statement-breakpoint
CREATE TABLE "processing_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_url" text NOT NULL,
	"headline" text,
	"stage" text NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'info' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "news_item_locations" ADD CONSTRAINT "news_item_locations_news_item_id_news_items_id_fk" FOREIGN KEY ("news_item_id") REFERENCES "public"."news_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_news_item_locations_news_item_id" ON "news_item_locations" USING btree ("news_item_id");--> statement-breakpoint
CREATE INDEX "idx_news_items_published_at" ON "news_items" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "idx_processing_logs_created_at" ON "processing_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_processing_logs_source_url" ON "processing_logs" USING btree ("source_url");