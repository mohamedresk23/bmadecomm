CREATE UNIQUE INDEX variants_product_id_uq ON variants(product_id, id);
--> statement-breakpoint
CREATE UNIQUE INDEX product_media_product_id_uq ON product_media(product_id, id);
--> statement-breakpoint
CREATE TABLE variant_media (
  variant_id text PRIMARY KEY,
  product_id text NOT NULL,
  product_media_id text NOT NULL,
  CONSTRAINT variant_media_variant_fk FOREIGN KEY(product_id, variant_id) REFERENCES variants(product_id, id) ON DELETE RESTRICT,
  CONSTRAINT variant_media_attachment_fk FOREIGN KEY(product_id, product_media_id) REFERENCES product_media(product_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX variant_media_attachment_idx ON variant_media(product_media_id);
