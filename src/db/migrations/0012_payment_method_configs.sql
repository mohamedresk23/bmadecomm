CREATE TABLE "payment_method_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"title_ar" text NOT NULL,
	"title_en" text NOT NULL,
	"instructions_ar" text DEFAULT '' NOT NULL,
	"instructions_en" text DEFAULT '' NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"min_order_subtotal_minor" integer,
	"max_order_subtotal_minor" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "payment_method_configs_id_check" CHECK ("id" IN ('cod', 'online_card')),
	CONSTRAINT "payment_method_title_ar_length" CHECK (length("title_ar") >= 2 AND length("title_ar") <= 100),
	CONSTRAINT "payment_method_title_en_length" CHECK (length("title_en") >= 2 AND length("title_en") <= 100),
	CONSTRAINT "payment_method_instructions_ar_length" CHECK (length("instructions_ar") <= 2000),
	CONSTRAINT "payment_method_instructions_en_length" CHECK (length("instructions_en") <= 2000),
	CONSTRAINT "payment_method_min_non_negative" CHECK ("min_order_subtotal_minor" >= 0),
	CONSTRAINT "payment_method_max_non_negative" CHECK ("max_order_subtotal_minor" >= 0),
	CONSTRAINT "payment_method_subtotal_bounds_valid" CHECK ("min_order_subtotal_minor" IS NULL OR "max_order_subtotal_minor" IS NULL OR "min_order_subtotal_minor" <= "max_order_subtotal_minor"),
	CONSTRAINT "payment_method_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
-- Baseline payment methods seed
INSERT INTO "payment_method_configs" (
	"id",
	"title_ar",
	"title_en",
	"instructions_ar",
	"instructions_en",
	"is_enabled",
	"min_order_subtotal_minor",
	"max_order_subtotal_minor",
	"version",
	"updated_at",
	"updated_by"
) VALUES
	('cod', 'الدفع عند الاستلام', 'Cash on Delivery', 'الدفع عند استلام الطلب', 'Pay when your order is delivered.', true, NULL, NULL, 1, now(), NULL),
	('online_card', 'بطاقة بنكية', 'Credit / Debit Card', 'الدفع بالبطاقة الائتمانية أو بطاقة الخصم المباشر', 'Pay securely with credit or debit card.', true, NULL, NULL, 1, now(), NULL)
ON CONFLICT ("id") DO NOTHING;

