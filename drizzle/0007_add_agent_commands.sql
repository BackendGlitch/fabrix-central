CREATE TYPE "command_state" AS ENUM('sent', 'acked', 'failed', 'timeout');
CREATE TYPE "command_type" AS ENUM('start', 'pause', 'cancel');

CREATE TABLE "agent_commands" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
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
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE,
  FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE
);

CREATE INDEX "agent_commands_correlation_id_idx" ON "agent_commands" ("correlation_id");
CREATE INDEX "agent_commands_agent_id_idx" ON "agent_commands" ("agent_id");
CREATE INDEX "agent_commands_job_id_idx" ON "agent_commands" ("job_id");
CREATE INDEX "agent_commands_state_idx" ON "agent_commands" ("state");
CREATE INDEX "agent_commands_sent_at_idx" ON "agent_commands" ("sent_at");
