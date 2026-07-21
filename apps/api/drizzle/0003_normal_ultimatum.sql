ALTER TABLE "applications" ADD COLUMN "furthest_stage" "application_stage" DEFAULT 'saved' NOT NULL;--> statement-breakpoint
UPDATE "applications" SET "furthest_stage" = CASE
  WHEN "stage" IN ('rejected', 'withdrawn') THEN
    CASE WHEN "applied_at" IS NOT NULL THEN 'applied'::"application_stage" ELSE 'saved'::"application_stage" END
  ELSE "stage"
END;
