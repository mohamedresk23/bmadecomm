CREATE TABLE "store_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"store_name" text NOT NULL,
	"legal_name" text,
	"support_email" text NOT NULL,
	"support_phone" text NOT NULL,
	"address" text,
	"logo_media_id" text,
	"default_language" text DEFAULT 'ar-EG' NOT NULL,
	"currency" text DEFAULT 'EGP' NOT NULL,
	"currency_symbol" text DEFAULT 'ج.م' NOT NULL,
	"currency_exponent" integer DEFAULT 2 NOT NULL,
	"timezone" text DEFAULT 'Africa/Cairo' NOT NULL,
	"date_format" text DEFAULT 'YYYY-MM-DD' NOT NULL,
	"order_prefix" text DEFAULT 'ORD-' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_settings_single_row" CHECK ("id" = 'default')
);
--> statement-breakpoint
ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_logo_media_id_media_id_fk" FOREIGN KEY ("logo_media_id") REFERENCES "media"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "store_settings" (
	"id",
	"store_name",
	"legal_name",
	"support_email",
	"support_phone",
	"address",
	"default_language",
	"currency",
	"currency_symbol",
	"currency_exponent",
	"timezone",
	"date_format",
	"order_prefix",
	"updated_at",
	"created_at"
) VALUES (
	'default',
	'متجر بيميد',
	'شركة التجارة الإلكترونية المصرية ش.ذ.م.م',
	'support@bmadecomm.eg',
	'+201012345678',
	'15 شارع مصدق، الدقي، الجيزة، مصر',
	'ar-EG',
	'EGP',
	'ج.م',
	2,
	'Africa/Cairo',
	'YYYY-MM-DD',
	'ORD-',
	now(),
	now()
) ON CONFLICT ("id") DO NOTHING;

