ALTER TABLE products ADD COLUMN media_revision bigint NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE product_media (
  id text PRIMARY KEY,
  product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  media_id text NOT NULL REFERENCES media(id) ON DELETE RESTRICT,
  alt_text text NOT NULL DEFAULT '',
  sort_order integer NOT NULL,
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_media_sort_order_nonnegative CHECK (sort_order >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX product_media_product_media_uq ON product_media(product_id, media_id);
--> statement-breakpoint
CREATE UNIQUE INDEX product_media_active_sort_order_uq ON product_media(product_id, sort_order) WHERE removed_at IS NULL;
--> statement-breakpoint
CREATE INDEX product_media_active_ordered_idx ON product_media(product_id, sort_order) WHERE removed_at IS NULL;
--> statement-breakpoint
CREATE INDEX product_media_reverse_media_idx ON product_media(media_id);

