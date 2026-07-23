CREATE TYPE "public"."day_plan_generator" AS ENUM('manual', 'llm', 'fallback');--> statement-breakpoint
CREATE TYPE "public"."day_plan_status" AS ENUM('draft', 'accepted', 'closed');--> statement-breakpoint
CREATE TYPE "public"."focus_session_end" AS ENUM('completed', 'paused', 'abandoned', 'auto');--> statement-breakpoint
CREATE TYPE "public"."plan_block_category" AS ENUM('job_search', 'interview_prep', 'learning', 'admin', 'other');--> statement-breakpoint
CREATE TYPE "public"."plan_block_source" AS ENUM('manual', 'application_followup', 'interview_topic', 'vacancy_apply', 'course', 'debt');--> statement-breakpoint
CREATE TYPE "public"."plan_block_status" AS ENUM('pending', 'active', 'done', 'partial', 'skipped', 'dropped');--> statement-breakpoint
CREATE TYPE "public"."plan_skip_reason" AS ENUM('no_time', 'no_energy', 'blocked', 'changed_priority', 'avoided', 'unreported');--> statement-breakpoint
CREATE TYPE "public"."planner_nudge_channel" AS ENUM('telegram', 'in_app');--> statement-breakpoint
CREATE TYPE "public"."planner_nudge_kind" AS ENUM('morning', 'block_start', 'midway', 'evening', 'escalation', 'debt');--> statement-breakpoint
CREATE TYPE "public"."planner_nudge_status" AS ENUM('pending', 'sent', 'acknowledged', 'ignored', 'cancelled');--> statement-breakpoint
CREATE TABLE "day_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_date" date NOT NULL,
	"status" "day_plan_status" DEFAULT 'draft' NOT NULL,
	"generated_by" "day_plan_generator" DEFAULT 'manual' NOT NULL,
	"intent" text,
	"accepted_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"auto_closed" boolean DEFAULT false NOT NULL,
	"review" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "focus_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"block_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_seconds" integer,
	"ended_reason" "focus_session_end"
);
--> statement-breakpoint
CREATE TABLE "plan_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"details" text,
	"category" "plan_block_category" DEFAULT 'other' NOT NULL,
	"source_kind" "plan_block_source" DEFAULT 'manual' NOT NULL,
	"source_ref" jsonb,
	"estimate_minutes" integer DEFAULT 30 NOT NULL,
	"corrected_estimate_minutes" integer DEFAULT 30 NOT NULL,
	"actual_minutes" integer DEFAULT 0 NOT NULL,
	"status" "plan_block_status" DEFAULT 'pending' NOT NULL,
	"skip_reason" "plan_skip_reason",
	"outcome_note" text,
	"carried_from_block_id" uuid,
	"carry_count" smallint DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "planner_nudges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" uuid,
	"block_id" uuid,
	"kind" "planner_nudge_kind" NOT NULL,
	"channel" "planner_nudge_channel" DEFAULT 'in_app' NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"status" "planner_nudge_status" DEFAULT 'pending' NOT NULL,
	"repeat_index" smallint DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"telegram_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "planner_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"morning_ritual_at" time DEFAULT '09:00' NOT NULL,
	"evening_review_at" time DEFAULT '20:00' NOT NULL,
	"capacity_minutes" integer DEFAULT 240 NOT NULL,
	"default_block_minutes" integer DEFAULT 30 NOT NULL,
	"category_targets" jsonb,
	"telegram_chat_id" text,
	"telegram_enabled" boolean DEFAULT false NOT NULL,
	"escalation_after_minutes" integer DEFAULT 20 NOT NULL,
	"escalation_max_repeats" smallint DEFAULT 2 NOT NULL,
	"estimation_factor" real DEFAULT 1 NOT NULL,
	"estimation_factor_by_category" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "day_plans" ADD CONSTRAINT "day_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_block_id_plan_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."plan_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_blocks" ADD CONSTRAINT "plan_blocks_plan_id_day_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."day_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_blocks" ADD CONSTRAINT "plan_blocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_blocks" ADD CONSTRAINT "plan_blocks_carried_from_block_id_plan_blocks_id_fk" FOREIGN KEY ("carried_from_block_id") REFERENCES "public"."plan_blocks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planner_nudges" ADD CONSTRAINT "planner_nudges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planner_nudges" ADD CONSTRAINT "planner_nudges_plan_id_day_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."day_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planner_nudges" ADD CONSTRAINT "planner_nudges_block_id_plan_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."plan_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planner_settings" ADD CONSTRAINT "planner_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "day_plans_user_date_idx" ON "day_plans" USING btree ("user_id","plan_date");--> statement-breakpoint
CREATE INDEX "focus_sessions_user_ended_idx" ON "focus_sessions" USING btree ("user_id","ended_at");--> statement-breakpoint
CREATE INDEX "plan_blocks_plan_position_idx" ON "plan_blocks" USING btree ("plan_id","position");--> statement-breakpoint
CREATE INDEX "plan_blocks_user_status_idx" ON "plan_blocks" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "planner_nudges_due_idx" ON "planner_nudges" USING btree ("status","scheduled_for");