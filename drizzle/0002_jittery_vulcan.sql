CREATE TYPE "public"."pairing_status" AS ENUM('pending', 'approved', 'expired', 'consumed');--> statement-breakpoint
CREATE TABLE "agent_pairings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(10) NOT NULL,
	"status" "pairing_status" DEFAULT 'pending' NOT NULL,
	"user_id" uuid NOT NULL,
	"agent_name" varchar(255),
	"expires_at" timestamp with time zone NOT NULL,
	"approved_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"agent_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_pairings" ADD CONSTRAINT "agent_pairings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_pairings_code_idx" ON "agent_pairings" USING btree ("code");--> statement-breakpoint
CREATE INDEX "agent_pairings_status_idx" ON "agent_pairings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_pairings_expires_at_idx" ON "agent_pairings" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "agent_pairings_user_id_idx" ON "agent_pairings" USING btree ("user_id");