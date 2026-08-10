CREATE TABLE "telegram_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"chat_id" text,
	"username" text,
	"link_token" text,
	"link_token_expires_at" timestamp with time zone,
	"linked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "telegram_accounts" ADD CONSTRAINT "telegram_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_accounts_chat_id_idx" ON "telegram_accounts" USING btree ("chat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_accounts_link_token_idx" ON "telegram_accounts" USING btree ("link_token");--> statement-breakpoint
ALTER TABLE "planner_settings" DROP COLUMN "telegram_chat_id";