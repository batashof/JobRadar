CREATE TABLE "hidden_vacancies" (
	"user_id" uuid NOT NULL,
	"vacancy_id" uuid NOT NULL,
	"hidden_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hidden_vacancies_user_id_vacancy_id_pk" PRIMARY KEY("user_id","vacancy_id")
);
--> statement-breakpoint
ALTER TABLE "hidden_vacancies" ADD CONSTRAINT "hidden_vacancies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hidden_vacancies" ADD CONSTRAINT "hidden_vacancies_vacancy_id_vacancies_id_fk" FOREIGN KEY ("vacancy_id") REFERENCES "public"."vacancies"("id") ON DELETE cascade ON UPDATE no action;