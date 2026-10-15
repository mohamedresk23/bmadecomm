DROP INDEX IF EXISTS product_media_reverse_media_idx;
DROP INDEX IF EXISTS product_media_active_ordered_idx;
DROP INDEX IF EXISTS product_media_active_sort_order_uq;
DROP INDEX IF EXISTS product_media_product_media_uq;
DROP TABLE IF EXISTS product_media;
ALTER TABLE products DROP COLUMN IF EXISTS media_revision;

