CREATE TABLE "outreach_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"vacancy_id" uuid NOT NULL,
	"resume_id" uuid NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"gmail_message_id" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resume_matches" (
	"resume_id" uuid NOT NULL,
	"vacancy_id" uuid NOT NULL,
	"score" real NOT NULL,
	"explanation" text DEFAULT '' NOT NULL,
	"matched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resume_matches_resume_id_vacancy_id_pk" PRIMARY KEY("resume_id","vacancy_id")
);
--> statement-breakpoint
CREATE TABLE "resumes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"file" "bytea" NOT NULL,
	"extracted_text" text DEFAULT '' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "gmail_refresh_token" text;--> statement-breakpoint
ALTER TABLE "vacancies" ADD COLUMN "apply_contact" jsonb;--> statement-breakpoint
ALTER TABLE "vacancies" ADD COLUMN "summary_ru" text;--> statement-breakpoint
ALTER TABLE "vacancies" ADD COLUMN "summary_generated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outreach_emails" ADD CONSTRAINT "outreach_emails_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_emails" ADD CONSTRAINT "outreach_emails_vacancy_id_vacancies_id_fk" FOREIGN KEY ("vacancy_id") REFERENCES "public"."vacancies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_emails" ADD CONSTRAINT "outreach_emails_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_matches" ADD CONSTRAINT "resume_matches_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_matches" ADD CONSTRAINT "resume_matches_vacancy_id_vacancies_id_fk" FOREIGN KEY ("vacancy_id") REFERENCES "public"."vacancies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outreach_emails_user_id_idx" ON "outreach_emails" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "resumes_user_id_idx" ON "resumes" USING btree ("user_id");