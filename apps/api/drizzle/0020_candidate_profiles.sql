CREATE TABLE "bot_dialogs" (
	"chat_id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"flow" text NOT NULL,
	"step" text NOT NULL,
	"payload" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"resume_id" uuid,
	"source" text NOT NULL,
	"prompt_version" smallint NOT NULL,
	"role" text,
	"grade" text,
	"years" smallint,
	"skills" jsonb NOT NULL,
	"english" text,
	"location" text,
	"salary_usd" integer,
	"evaluation" jsonb,
	"confirmed_at" timestamp with time zone,
	"analyzed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_dialogs" ADD CONSTRAINT "bot_dialogs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_profiles" ADD CONSTRAINT "candidate_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_profiles" ADD CONSTRAINT "candidate_profiles_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE set null ON UPDATE no action;