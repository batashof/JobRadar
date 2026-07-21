CREATE TYPE "public"."interview_question_kind" AS ENUM('theory', 'behavioral', 'coding');--> statement-breakpoint
CREATE TYPE "public"."interview_topic_status" AS ENUM('todo', 'in_progress', 'done');--> statement-breakpoint
CREATE TABLE "interview_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"answer" text NOT NULL,
	"review" jsonb,
	"score" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"resume_id" uuid,
	"target_role" text,
	"target_seniority" text,
	"focus" text[] DEFAULT '{}'::text[] NOT NULL,
	"structure" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" uuid,
	"topic" text NOT NULL,
	"kind" "interview_question_kind" NOT NULL,
	"difficulty" text,
	"prompt" text NOT NULL,
	"model_answer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_topic_progress" (
	"plan_id" uuid NOT NULL,
	"topic_key" text NOT NULL,
	"status" "interview_topic_status" DEFAULT 'todo' NOT NULL,
	"confidence" smallint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interview_topic_progress_plan_id_topic_key_pk" PRIMARY KEY("plan_id","topic_key")
);
--> statement-breakpoint
ALTER TABLE "interview_answers" ADD CONSTRAINT "interview_answers_question_id_interview_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."interview_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_answers" ADD CONSTRAINT "interview_answers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_plans" ADD CONSTRAINT "interview_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_plans" ADD CONSTRAINT "interview_plans_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_questions" ADD CONSTRAINT "interview_questions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_questions" ADD CONSTRAINT "interview_questions_plan_id_interview_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."interview_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_topic_progress" ADD CONSTRAINT "interview_topic_progress_plan_id_interview_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."interview_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interview_answers_question_id_idx" ON "interview_answers" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "interview_plans_user_id_idx" ON "interview_plans" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "interview_questions_user_id_idx" ON "interview_questions" USING btree ("user_id");