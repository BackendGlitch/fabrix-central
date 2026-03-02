CREATE TYPE "public"."user_role" AS ENUM('OWNER', 'CUSTOMER', 'ADMIN');--> statement-breakpoint
CREATE TABLE "health_check" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"checked_at" timestamp DEFAULT now() NOT NULL,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"hashed_refresh_token" text NOT NULL,
	"user_agent" text NOT NULL,
	"ip_address" "inet" NOT NULL,
	"expried_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"name" varchar(120) NOT NULL,
	"role" "user_role" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "user_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expired_at_idx" ON "user_sessions" USING btree ("expried_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");