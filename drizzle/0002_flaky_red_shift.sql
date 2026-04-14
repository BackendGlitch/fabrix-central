CREATE TYPE "public"."agent_status" AS ENUM('online', 'offline', 'paired', 'revoked');--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"node_id" varchar(255) NOT NULL,
	"display_name" varchar(255),
	"model" varchar(255),
	"status" "agent_status" DEFAULT 'paired' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_owner_id_idx" ON "agents" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "agents_node_id_idx" ON "agents" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "agents_status_idx" ON "agents" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_owner_node_unique_idx" ON "agents" USING btree ("owner_id","node_id");