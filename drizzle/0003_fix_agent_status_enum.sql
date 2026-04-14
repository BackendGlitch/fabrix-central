-- Drop the agents table temporarily
DROP TABLE IF EXISTS "public"."agents" CASCADE;

-- Drop the old enum type
DROP TYPE IF EXISTS "public"."agent_status" CASCADE;

-- Recreate the enum with correct values
CREATE TYPE "public"."agent_status" AS ENUM('online', 'offline', 'paired', 'revoked');

-- Recreate the agents table with the correct enum
CREATE TABLE "public"."agents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_id" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade,
  "node_id" varchar(255) NOT NULL,
  "display_name" varchar(255),
  "model" varchar(255),
  "status" "public"."agent_status" DEFAULT 'paired' NOT NULL,
  "last_seen_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "agents_owner_node_unique_idx" UNIQUE("owner_id", "node_id")
);

-- Recreate indexes
CREATE INDEX "agents_owner_id_idx" ON "public"."agents" ("owner_id");
CREATE INDEX "agents_node_id_idx" ON "public"."agents" ("node_id");
CREATE INDEX "agents_status_idx" ON "public"."agents" ("status");
