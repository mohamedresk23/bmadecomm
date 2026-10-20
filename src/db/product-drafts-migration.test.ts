import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { runMigrations, rollbackMigration } from "./migrate";

describe("product drafts migration", () => {
  it("applies, reverses and reapplies all four tables with database defaults", async () => {
    const client = new PGlite();
    const database = drizzle(client);
    try {
      await runMigrations({ db: database, quiet: true });
      await database.execute(sql`INSERT INTO products(id, name) VALUES ('migration-product', 'Draft')`);
      const before = await client.query<{ status: string }>("SELECT status FROM products");
      expect(before.rows[0].status).toBe("draft");
      // Remove dependents before reversing the product migration itself.
      const result = await rollbackMigration({ db: database, target: "0013_categories", quiet: true });
      expect(result.rolledBack).toEqual([
        "0018_product_publish_slug_seo",
        "0017_variant_media",
        "0016_upload_rate_limit",
        "0015_product_gallery",
        "0014_product_drafts",
      ]);
      const tables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_name IN ('products','variants','variant_attributes','product_categories')");
      expect(tables.rows).toHaveLength(0);
      const reapplied = await runMigrations({ db: database, quiet: true });
      expect(reapplied.applied).toEqual([
        "0014_product_drafts",
        "0015_product_gallery",
        "0016_upload_rate_limit",
        "0017_variant_media",
        "0018_product_publish_slug_seo",
      ]);
      const restored = await client.query("SELECT table_name FROM information_schema.tables WHERE table_name IN ('products','variants','variant_attributes','product_categories')");
      expect(restored.rows).toHaveLength(4);
      await database.execute(sql`INSERT INTO products(id, name) VALUES ('restored-product', 'Restored draft')`);
      const defaults = await client.query<{ status: string; media_revision: string }>("SELECT status, media_revision::text FROM products WHERE id = 'restored-product'");
      expect(defaults.rows).toEqual([{ status: "draft", media_revision: "0" }]);
    } finally { await client.close(); }
  });
});
