CREATE TYPE "public"."filament_type" AS ENUM('PLA', 'PETG', 'ABS', 'TPU', 'ASA', 'PC', 'NYLON', 'HIPS', 'WOOD', 'METAL_FILLED', 'CARBON_FIBER', 'OTHER');--> statement-breakpoint
CREATE TABLE "filament_standards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "filament_type" NOT NULL,
	"name" varchar(100) NOT NULL,
	"density" text NOT NULL,
	"default_nozzle_temp" integer NOT NULL,
	"default_bed_temp" integer NOT NULL,
	"default_print_speed" integer NOT NULL,
	"color" varchar(50),
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "filament_standards_type_unique" UNIQUE("type")
);
--> statement-breakpoint
CREATE TABLE "job_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"printer_config_id" uuid,
	"filament_id" uuid,
	"scale" text DEFAULT '1.0' NOT NULL,
	"infill_percent" integer DEFAULT 20 NOT NULL,
	"layer_height" text DEFAULT '0.2' NOT NULL,
	"wall_count" integer DEFAULT 3 NOT NULL,
	"support_enabled" boolean DEFAULT false,
	"model_volume_cm3" text NOT NULL,
	"bounding_box_volume_cm3" text NOT NULL,
	"filament_volume_cm3" text NOT NULL,
	"filament_weight_grams" text NOT NULL,
	"estimated_print_time_minutes" integer NOT NULL,
	"filament_cost" text NOT NULL,
	"machine_time_cost" text NOT NULL,
	"support_material_cost" text DEFAULT '0',
	"platform_fee" text NOT NULL,
	"total_price" text NOT NULL,
	"currency" varchar(3) DEFAULT 'TND' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_pricing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform_fee_percent" integer DEFAULT 15 NOT NULL,
	"min_platform_fee" text DEFAULT '3.00' NOT NULL,
	"max_platform_fee" text,
	"peak_hour_multiplier" text DEFAULT '1.0',
	"rush_job_multiplier" text DEFAULT '1.5',
	"bulk_discount_threshold" integer,
	"bulk_discount_percent" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "printer_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"bed_width" integer DEFAULT 220 NOT NULL,
	"bed_depth" integer DEFAULT 220 NOT NULL,
	"bed_height" integer DEFAULT 250 NOT NULL,
	"nozzle_diameter" text DEFAULT '0.4' NOT NULL,
	"hourly_rate" text DEFAULT '6.00' NOT NULL,
	"default_layer_height" text DEFAULT '0.2' NOT NULL,
	"default_infill_percent" integer DEFAULT 20 NOT NULL,
	"default_wall_count" integer DEFAULT 3 NOT NULL,
	"supports_multi_material" boolean DEFAULT false,
	"has_heated_bed" boolean DEFAULT true,
	"max_nozzle_temp" integer DEFAULT 300,
	"max_bed_temp" integer DEFAULT 110,
	"capabilities" jsonb DEFAULT null,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "printer_configs_agent_id_unique" UNIQUE("agent_id")
);
--> statement-breakpoint
CREATE TABLE "printer_filaments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"printer_config_id" uuid NOT NULL,
	"type" "filament_type" NOT NULL,
	"brand" varchar(100),
	"color" varchar(50) NOT NULL,
	"color_hex" varchar(7),
	"price_per_gram" text NOT NULL,
	"stock_grams" integer,
	"is_available" boolean DEFAULT true NOT NULL,
	"nozzle_temp" integer,
	"bed_temp" integer,
	"print_speed" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_quotes" ADD CONSTRAINT "job_quotes_file_id_job_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."job_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_quotes" ADD CONSTRAINT "job_quotes_printer_config_id_printer_configs_id_fk" FOREIGN KEY ("printer_config_id") REFERENCES "public"."printer_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_quotes" ADD CONSTRAINT "job_quotes_filament_id_printer_filaments_id_fk" FOREIGN KEY ("filament_id") REFERENCES "public"."printer_filaments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printer_configs" ADD CONSTRAINT "printer_configs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printer_filaments" ADD CONSTRAINT "printer_filaments_printer_config_id_printer_configs_id_fk" FOREIGN KEY ("printer_config_id") REFERENCES "public"."printer_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "filament_standards_type_idx" ON "filament_standards" USING btree ("type");--> statement-breakpoint
CREATE INDEX "job_quotes_file_id_idx" ON "job_quotes" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "job_quotes_printer_config_idx" ON "job_quotes" USING btree ("printer_config_id");--> statement-breakpoint
CREATE INDEX "job_quotes_expires_at_idx" ON "job_quotes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "printer_configs_agent_id_idx" ON "printer_configs" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "printer_configs_active_idx" ON "printer_configs" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "printer_filaments_config_idx" ON "printer_filaments" USING btree ("printer_config_id");--> statement-breakpoint
CREATE INDEX "printer_filaments_type_idx" ON "printer_filaments" USING btree ("type");--> statement-breakpoint
CREATE INDEX "printer_filaments_available_idx" ON "printer_filaments" USING btree ("is_available");--> statement-breakpoint
CREATE UNIQUE INDEX "printer_filaments_unique_variant" ON "printer_filaments" USING btree ("printer_config_id","type","brand","color");