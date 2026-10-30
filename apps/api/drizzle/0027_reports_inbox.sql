CREATE TABLE "reports" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"fingerprint" text NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"user_id" uuid,
	"count" integer DEFAULT 1 NOT NULL,
	"transient" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"issue_number" integer,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"digested_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reports_fingerprint_idx" ON "reports" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "reports_status_idx" ON "reports" USING btree ("status");