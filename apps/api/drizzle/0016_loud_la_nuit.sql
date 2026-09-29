ALTER TABLE "digest_settings" ADD COLUMN "mode" text DEFAULT 'scheduled' NOT NULL;--> statement-breakpoint
ALTER TABLE "digest_settings" ADD COLUMN "quiet_start" text DEFAULT '22:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "digest_settings" ADD COLUMN "quiet_end" text DEFAULT '08:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "digest_settings" ADD COLUMN "instant_min_score" smallint DEFAULT 75 NOT NULL;--> statement-breakpoint
ALTER TABLE "digest_settings" ADD COLUMN "instant_through" timestamp with time zone;