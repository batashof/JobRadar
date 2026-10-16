CREATE TABLE "vacancy_recipients" (
	"vacancy_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vacancy_recipients_vacancy_id_user_id_pk" PRIMARY KEY("vacancy_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "alerts_token" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "alerts_confirmation_code" text;--> statement-breakpoint
ALTER TABLE "vacancy_recipients" ADD CONSTRAINT "vacancy_recipients_vacancy_id_vacancies_id_fk" FOREIGN KEY ("vacancy_id") REFERENCES "public"."vacancies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancy_recipients" ADD CONSTRAINT "vacancy_recipients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_alerts_token_unique" UNIQUE("alerts_token");