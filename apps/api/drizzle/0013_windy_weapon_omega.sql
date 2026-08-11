CREATE TABLE "digest_items" (
	"user_id" uuid NOT NULL,
	"vacancy_id" uuid NOT NULL,
	"score" smallint NOT NULL,
	"slot_key" text NOT NULL,
	"message_id" text,
	"feedback" smallint,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "digest_items_user_id_vacancy_id_pk" PRIMARY KEY("user_id","vacancy_id")
);
--> statement-breakpoint
ALTER TABLE "digest_settings" ADD COLUMN "last_sent_key" text;--> statement-breakpoint
ALTER TABLE "digest_items" ADD CONSTRAINT "digest_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_items" ADD CONSTRAINT "digest_items_vacancy_id_vacancies_id_fk" FOREIGN KEY ("vacancy_id") REFERENCES "public"."vacancies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "digest_items_user_sent_idx" ON "digest_items" USING btree ("user_id","sent_at");