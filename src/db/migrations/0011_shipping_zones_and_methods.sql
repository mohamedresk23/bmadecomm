CREATE TABLE "shipping_zones" (
	"id" text PRIMARY KEY NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"country_code" text DEFAULT 'EG' NOT NULL,
	"governorates" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipping_methods" (
	"id" text PRIMARY KEY NOT NULL,
	"zone_id" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"cost_minor" integer DEFAULT 0 NOT NULL,
	"estimated_days_min" integer DEFAULT 1 NOT NULL,
	"estimated_days_max" integer DEFAULT 3 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipping_cost_non_negative" CHECK ("cost_minor" >= 0),
	CONSTRAINT "shipping_days_valid" CHECK ("estimated_days_min" <= "estimated_days_max")
);
--> statement-breakpoint
ALTER TABLE "shipping_methods" ADD CONSTRAINT "shipping_methods_zone_id_shipping_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."shipping_zones"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "shipping_methods_zone_idx" ON "shipping_methods" USING btree ("zone_id");
--> statement-breakpoint
-- Baseline Egypt Shipping Zones Seed
INSERT INTO "shipping_zones" ("id", "name_ar", "name_en", "country_code", "governorates", "is_active", "created_at", "updated_at")
VALUES
	('zone_cairo_giza', 'القاهرة الكبرى', 'Greater Cairo', 'EG', '["cairo", "giza"]'::jsonb, true, now(), now()),
	('zone_alex_delta', 'الإسكندرية والدلتا', 'Alexandria & Delta', 'EG', '["alexandria", "beheira", "dakahlia", "gharbia", "kafr_el_sheikh", "monufia", "qalyubia", "sharqia", "damietta"]'::jsonb, true, now(), now()),
	('zone_canal_upper', 'مدن القناة والصعيد والمحافظات الحدودية', 'Canal & Upper Egypt', 'EG', '["ismailia", "port_said", "suez", "faiyum", "beni_suef", "minya", "asyut", "sohag", "qena", "luxor", "aswan", "red_sea", "new_valley", "matrouh", "north_sinai", "south_sinai"]'::jsonb, true, now(), now())
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
-- Baseline Egypt Shipping Methods Seed
INSERT INTO "shipping_methods" ("id", "zone_id", "name_ar", "name_en", "cost_minor", "estimated_days_min", "estimated_days_max", "is_active", "created_at", "updated_at")
VALUES
	('sm_cairo_standard', 'zone_cairo_giza', 'توصيل عادي', 'Standard Delivery', 5000, 1, 2, true, now(), now()),
	('sm_cairo_express', 'zone_cairo_giza', 'توصيل سريع', 'Express Delivery', 8500, 1, 1, true, now(), now()),
	('sm_alex_standard', 'zone_alex_delta', 'توصيل قياسي', 'Standard Delivery', 6500, 2, 4, true, now(), now()),
	('sm_canal_upper_standard', 'zone_canal_upper', 'شحن قياسي', 'Standard Delivery', 8500, 3, 6, true, now(), now())
ON CONFLICT ("id") DO NOTHING;

