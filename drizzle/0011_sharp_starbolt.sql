CREATE TYPE "public"."topup_status" AS ENUM('pending', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "pending_topups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"intent_id" text NOT NULL,
	"amount" integer NOT NULL,
	"status" "topup_status" DEFAULT 'pending' NOT NULL,
	"pay_url" text,
	"confirmed_at" timestamp with time zone,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pending_topups_intent_id_unique" UNIQUE("intent_id")
);
--> statement-breakpoint
ALTER TABLE "pending_topups" ADD CONSTRAINT "pending_topups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "topups_user_idx" ON "pending_topups" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "topups_intent_idx" ON "pending_topups" USING btree ("intent_id");--> statement-breakpoint
CREATE INDEX "topups_status_idx" ON "pending_topups" USING btree ("status");