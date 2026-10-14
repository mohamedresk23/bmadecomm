CREATE TABLE products (
  id text PRIMARY KEY, name text NOT NULL, description text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE variants (
  id text PRIMARY KEY, product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku text NOT NULL, combination_key text NOT NULL,
  price_minor bigint NOT NULL, compare_price_minor bigint,
  currency text NOT NULL, currency_scale integer NOT NULL, sort_order integer NOT NULL,
  CONSTRAINT variants_sku_normalized CHECK (sku = upper(btrim(sku)) AND sku ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'),
  CONSTRAINT variants_money_valid CHECK (price_minor >= 0 AND (compare_price_minor IS NULL OR compare_price_minor >= price_minor)),
  CONSTRAINT variants_currency_valid CHECK (currency ~ '^[A-Z]{3}$' AND currency_scale BETWEEN 0 AND 4)
);
--> statement-breakpoint
CREATE UNIQUE INDEX variants_sku_unique ON variants(sku);
--> statement-breakpoint
CREATE UNIQUE INDEX variants_product_combination_unique ON variants(product_id, combination_key);
--> statement-breakpoint
CREATE TABLE variant_attributes (
  variant_id text NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  name text NOT NULL, value text NOT NULL, PRIMARY KEY (variant_id, name)
);
--> statement-breakpoint
CREATE TABLE product_categories (
  product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  category_id text NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  PRIMARY KEY (product_id, category_id)
);
--> statement-breakpoint
CREATE INDEX product_categories_category_idx ON product_categories(category_id);
