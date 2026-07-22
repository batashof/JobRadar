ALTER TABLE "resume_matches" ADD COLUMN "explanation_en" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "language" text DEFAULT 'ru' NOT NULL;--> statement-breakpoint
ALTER TABLE "vacancies" ADD COLUMN "summary_en" text;--> statement-breakpoint
ALTER TABLE "vacancies" ADD COLUMN "summary_en_generated_at" timestamp with time zone;