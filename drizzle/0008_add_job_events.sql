-- Create job event type enum (if not exists)
DO $$ BEGIN
  CREATE TYPE "public"."job_event_type" AS ENUM ('progress', 'completed', 'failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create job_events table
CREATE TABLE IF NOT EXISTS "public"."job_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"type" "public"."job_event_type" NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Create indexes for performance (if not exists)
CREATE INDEX IF NOT EXISTS "job_events_job_id_idx" ON "public"."job_events" ("job_id");
CREATE INDEX IF NOT EXISTS "job_events_created_at_idx" ON "public"."job_events" ("created_at");
CREATE INDEX IF NOT EXISTS "job_events_type_idx" ON "public"."job_events" ("type");

-- Add foreign key constraint (if not exists)
DO $$ BEGIN
  ALTER TABLE "public"."job_events" ADD CONSTRAINT "job_events_job_id_fk" 
    FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
