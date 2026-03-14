CREATE TABLE "agent_pairing_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pairing_id" uuid NOT NULL,
	"action" varchar(50) NOT NULL,
	"actor_user_id" uuid,
	"actor_type" varchar(20) NOT NULL,
	"ip_address" "inet",
	"user_agent" text,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_pairings" RENAME COLUMN "user_id" TO "owner_id";--> statement-breakpoint
ALTER TABLE "agent_pairings" ALTER COLUMN "owner_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_pairings" DROP CONSTRAINT "agent_pairings_user_id_users_id_fk";
--> statement-breakpoint
DROP INDEX "agent_pairings_user_id_idx";--> statement-breakpoint
ALTER TABLE "agent_pairings" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_pairing_audit" ADD CONSTRAINT "agent_pairing_audit_pairing_id_agent_pairings_id_fk" FOREIGN KEY ("pairing_id") REFERENCES "public"."agent_pairings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_pairing_audit" ADD CONSTRAINT "agent_pairing_audit_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_pairing_id_idx" ON "agent_pairing_audit" USING btree ("pairing_id");--> statement-breakpoint
CREATE INDEX "audit_action_idx" ON "agent_pairing_audit" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_created_at_idx" ON "agent_pairing_audit" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "agent_pairings" ADD CONSTRAINT "agent_pairings_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_pairings" ADD CONSTRAINT "agent_pairings_session_id_user_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."user_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_pairings_owner_id_idx" ON "agent_pairings" USING btree ("owner_id");--> statement-breakpoint
ALTER TABLE "agent_pairings" DROP COLUMN "agent_token";
