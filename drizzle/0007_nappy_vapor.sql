CREATE TYPE "public"."command_state" AS ENUM('sent', 'acked', 'failed', 'timeout');--> statement-breakpoint
CREATE TYPE "public"."command_type" AS ENUM('start', 'pause', 'cancel');--> statement-breakpoint
CREATE TABLE "agent_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"correlation_id" varchar(36) NOT NULL,
	"agent_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"command_type" "command_type" NOT NULL,
	"state" "command_state" DEFAULT 'sent' NOT NULL,
	"payload" jsonb NOT NULL,
	"error_message" text,
	"acked_at" timestamp with time zone,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_commands" ADD CONSTRAINT "agent_commands_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_commands" ADD CONSTRAINT "agent_commands_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_commands_correlation_id_idx" ON "agent_commands" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "agent_commands_agent_id_idx" ON "agent_commands" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_commands_job_id_idx" ON "agent_commands" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "agent_commands_state_idx" ON "agent_commands" USING btree ("state");--> statement-breakpoint
CREATE INDEX "agent_commands_sent_at_idx" ON "agent_commands" USING btree ("sent_at");