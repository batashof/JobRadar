CREATE TYPE "public"."application_stage" AS ENUM('saved', 'applied', 'screening', 'tech_interview', 'offer', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."employment_type" AS ENUM('full_time', 'part_time', 'freelance');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('api', 'rss', 'telegram', 'manual');--> statement-breakpoint
CREATE TYPE "public"."source_run_status" AS ENUM('ok', 'empty', 'error');--> statement-breakpoint
CREATE TYPE "public"."work_format" AS ENUM('remote', 'onsite', 'hybrid');--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"vacancy_id" uuid NOT NULL,
	"stage" "application_stage" DEFAULT 'saved' NOT NULL,
	"stage_order" integer DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"applied_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"remind_after_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_matches" (
	"profile_id" uuid NOT NULL,
	"vacancy_id" uuid NOT NULL,
	"score" real NOT NULL,
	"matched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"digested_at" timestamp with time zone,
	CONSTRAINT "profile_matches_profile_id_vacancy_id_pk" PRIMARY KEY("profile_id","vacancy_id")
);
--> statement-breakpoint
CREATE TABLE "search_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"stack" text[] DEFAULT '{}'::text[] NOT NULL,
	"work_format" "work_format"[] DEFAULT '{}'::work_format[] NOT NULL,
	"employment_type" "employment_type"[] DEFAULT '{}'::employment_type[] NOT NULL,
	"salary_min" integer,
	"salary_max" integer,
	"salary_currency" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"kind" "source_kind" NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_run_status" "source_run_status",
	CONSTRAINT "sources_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"oauth_provider" text,
	"oauth_id" text,
	"digest_enabled" boolean DEFAULT true NOT NULL,
	"digest_last_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vacancies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"company_raw" text NOT NULL,
	"company_normalized" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("vacancies"."title", '') || ' ' || coalesce("vacancies"."company_raw", '') || ' ' || coalesce("vacancies"."description", ''))) STORED,
	"work_format" "work_format",
	"employment_type" "employment_type",
	"salary_min" integer,
	"salary_max" integer,
	"salary_currency" text,
	"location" text,
	"published_at" timestamp with time zone,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"canonical_vacancy_id" uuid
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_vacancy_id_vacancies_id_fk" FOREIGN KEY ("vacancy_id") REFERENCES "public"."vacancies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_matches" ADD CONSTRAINT "profile_matches_profile_id_search_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."search_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_matches" ADD CONSTRAINT "profile_matches_vacancy_id_vacancies_id_fk" FOREIGN KEY ("vacancy_id") REFERENCES "public"."vacancies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_profiles" ADD CONSTRAINT "search_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_canonical_vacancy_id_vacancies_id_fk" FOREIGN KEY ("canonical_vacancy_id") REFERENCES "public"."vacancies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "applications_user_vacancy_idx" ON "applications" USING btree ("user_id","vacancy_id");--> statement-breakpoint
CREATE INDEX "search_profiles_user_id_idx" ON "search_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vacancies_source_external_idx" ON "vacancies" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "vacancies_search_vector_idx" ON "vacancies" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "vacancies_company_normalized_idx" ON "vacancies" USING btree ("company_normalized");--> statement-breakpoint
CREATE INDEX "vacancies_published_at_idx" ON "vacancies" USING btree ("published_at");