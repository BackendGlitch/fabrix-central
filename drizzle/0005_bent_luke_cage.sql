CREATE TYPE "public"."job_status" AS ENUM('pending', 'queued', 'printing', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "job_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" varchar(255) NOT NULL,
	"original_name" varchar(255) NOT NULL,
	"mime_type" varchar(50) NOT NULL,
	"size" text NOT NULL,
	"storage_path" varchar(512) NOT NULL,
	"checksum" varchar(64),
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"printer_id" uuid,
	"name" varchar(255) NOT NULL,
	"description" text,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"metadata" jsonb DEFAULT 'null'::jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_file_id_job_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."job_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_printer_id_agents_id_fk" FOREIGN KEY ("printer_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_files_uploaded_at_idx" ON "job_files" USING btree ("uploaded_at");--> statement-breakpoint
CREATE INDEX "job_files_checksum_idx" ON "job_files" USING btree ("checksum");--> statement-breakpoint
CREATE INDEX "jobs_customer_id_idx" ON "jobs" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "jobs_printer_id_idx" ON "jobs" USING btree ("printer_id");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "jobs_created_at_idx" ON "jobs" USING btree ("created_at");