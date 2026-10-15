ALTER TABLE "candidate_profiles" ADD COLUMN "feedback_weights" jsonb DEFAULT '{"skills":{},"companies":{}}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "digest_settings" ADD COLUMN "work_formats" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "digest_settings" ADD COLUMN "employment_types" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "digest_settings" ADD COLUMN "min_salary_usd" integer;--> statement-breakpoint
ALTER TABLE "digest_settings" ADD COLUMN "muted_sources" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
-- Every account gets digest settings (roadmap 5.3): bot sign-ups of v1.26–1.27 had none.
INSERT INTO "digest_settings" ("user_id") SELECT "id" FROM "users" ON CONFLICT DO NOTHING;
