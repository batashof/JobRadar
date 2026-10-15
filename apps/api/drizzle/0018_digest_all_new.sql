ALTER TABLE "digest_settings" ALTER COLUMN "max_items" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "digest_settings" ALTER COLUMN "max_items" DROP NOT NULL;--> statement-breakpoint
-- ADR-022: no cap by default. The old ten was a forced ceiling, not a choice, so every stored value is cleared.
UPDATE "digest_settings" SET "max_items" = NULL;--> statement-breakpoint
-- Hand-edited from drizzle-kit's add + drop: a rename keeps the instant-mode watermark, which now serves both modes.
ALTER TABLE "digest_settings" RENAME COLUMN "instant_through" TO "judged_through";
