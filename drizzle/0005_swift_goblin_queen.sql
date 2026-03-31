CREATE TYPE "public"."agent_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TABLE "agent_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"hashed_refresh_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT 'null'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"node_id" varchar(255) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"status" "agent_status" DEFAULT 'active' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_pairings" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_pairings" ADD COLUMN "node_id" varchar(255);--> statement-breakpoint
ALTER TABLE "agent_pairings" ADD COLUMN "app_version" varchar(60);--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_sessions_agent_id_idx" ON "agent_sessions" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_sessions_expires_at_idx" ON "agent_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "agent_sessions_revoked_at_idx" ON "agent_sessions" USING btree ("revoked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_owner_node_unique_idx" ON "agents" USING btree ("owner_id","node_id");--> statement-breakpoint
CREATE INDEX "agents_owner_id_idx" ON "agents" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "agents_status_idx" ON "agents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agents_last_seen_at_idx" ON "agents" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "agent_pairings_agent_id_idx" ON "agent_pairings" USING btree ("agent_id");