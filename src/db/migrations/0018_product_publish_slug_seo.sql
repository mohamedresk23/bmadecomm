ALTER TABLE products ADD COLUMN slug text;
--> statement-breakpoint
ALTER TABLE products ADD COLUMN meta_title text;
--> statement-breakpoint
ALTER TABLE products ADD COLUMN meta_description text;
--> statement-breakpoint
ALTER TABLE products ADD COLUMN published_at timestamptz;
--> statement-breakpoint
WITH numbered AS (
  SELECT id,
    rtrim(left(
      COALESCE(
        NULLIF(btrim(lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')), '-'), ''),
        NULLIF(btrim(lower(regexp_replace(id, '[^a-zA-Z0-9]+', '-', 'g')), '-'), ''),
        'product'
      ), 240), '-') AS base_slug,
    ROW_NUMBER() OVER (
      PARTITION BY rtrim(left(
        COALESCE(
          NULLIF(btrim(lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')), '-'), ''),
          NULLIF(btrim(lower(regexp_replace(id, '[^a-zA-Z0-9]+', '-', 'g')), '-'), ''),
          'product'
        ), 240), '-')
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM products
  WHERE slug IS NULL OR slug = ''
)
UPDATE products p
SET slug = CASE WHEN n.rn = 1 THEN n.base_slug ELSE n.base_slug || '-' || (n.rn - 1)::text END
FROM numbered n
WHERE p.id = n.id;
--> statement-breakpoint
DO $$
DECLARE
  v_conflicts integer;
BEGIN
  LOOP
    WITH duplicates AS (
      SELECT id, slug,
        ROW_NUMBER() OVER (PARTITION BY slug ORDER BY created_at ASC, id ASC) AS rn
      FROM products
    )
    UPDATE products p
    SET slug = d.slug || '-' || (d.rn - 1)::text
    FROM duplicates d
    WHERE p.id = d.id AND d.rn > 1;

    GET DIAGNOSTICS v_conflicts = ROW_COUNT;
    EXIT WHEN v_conflicts = 0;
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE products ALTER COLUMN slug SET NOT NULL;
--> statement-breakpoint
ALTER TABLE products ADD CONSTRAINT products_slug_normalized CHECK (slug = lower(btrim(slug)) AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 255);
--> statement-breakpoint
ALTER TABLE products ADD CONSTRAINT products_meta_title_len CHECK (meta_title IS NULL OR length(meta_title) <= 70);
--> statement-breakpoint
ALTER TABLE products ADD CONSTRAINT products_meta_description_len CHECK (meta_description IS NULL OR length(meta_description) <= 160);
--> statement-breakpoint
CREATE UNIQUE INDEX products_slug_unique ON products(slug);
--> statement-breakpoint
CREATE TABLE slug_redirects (
  id text PRIMARY KEY,
  source_slug text NOT NULL,
  target_slug text NOT NULL,
  product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT slug_redirects_no_self_redirect CHECK (source_slug <> target_slug),
  CONSTRAINT slug_redirects_source_slug_normalized CHECK (source_slug = lower(btrim(source_slug)) AND source_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(source_slug) <= 255),
  CONSTRAINT slug_redirects_target_slug_normalized CHECK (target_slug = lower(btrim(target_slug)) AND target_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(target_slug) <= 255)
);
--> statement-breakpoint
CREATE UNIQUE INDEX slug_redirects_source_slug_uq ON slug_redirects(source_slug);
--> statement-breakpoint
CREATE INDEX slug_redirects_product_id_idx ON slug_redirects(product_id);
--> statement-breakpoint
CREATE INDEX slug_redirects_target_slug_idx ON slug_redirects(target_slug);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION products_slug_autofill()
RETURNS trigger AS $$
DECLARE
  base_slug text;
  candidate text;
  suffix integer := 1;
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    base_slug := rtrim(left(
      COALESCE(
        NULLIF(btrim(lower(regexp_replace(NEW.name, '[^a-zA-Z0-9]+', '-', 'g')), '-'), ''),
        NULLIF(btrim(lower(regexp_replace(NEW.id, '[^a-zA-Z0-9]+', '-', 'g')), '-'), ''),
        'product'
      ), 240), '-');
    IF base_slug = '' THEN
      base_slug := 'product';
    END IF;
    candidate := base_slug;
    WHILE EXISTS (SELECT 1 FROM products WHERE slug = candidate AND id <> NEW.id)
       OR EXISTS (SELECT 1 FROM slug_redirects WHERE source_slug = candidate) LOOP
      candidate := base_slug || '-' || suffix::text;
      suffix := suffix + 1;
    END LOOP;
    NEW.slug := candidate;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER products_slug_autofill_trigger
BEFORE INSERT ON products
FOR EACH ROW
EXECUTE FUNCTION products_slug_autofill();
