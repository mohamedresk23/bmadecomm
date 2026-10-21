DROP TRIGGER IF EXISTS products_slug_autofill_trigger ON products;
--> statement-breakpoint
DROP FUNCTION IF EXISTS products_slug_autofill();
--> statement-breakpoint
DROP TABLE IF EXISTS slug_redirects;
--> statement-breakpoint
DROP INDEX IF EXISTS products_slug_unique;
--> statement-breakpoint
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_meta_description_len;
--> statement-breakpoint
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_meta_title_len;
--> statement-breakpoint
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_slug_normalized;
--> statement-breakpoint
ALTER TABLE products DROP COLUMN IF EXISTS published_at;
--> statement-breakpoint
ALTER TABLE products DROP COLUMN IF EXISTS meta_description;
--> statement-breakpoint
ALTER TABLE products DROP COLUMN IF EXISTS meta_title;
--> statement-breakpoint
ALTER TABLE products DROP COLUMN IF EXISTS slug;
