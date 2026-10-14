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
      const result = await rollbackMigration({ db: database, steps: 1, quiet: true });
      expect(result.rolledBack).toEqual(["0014_product_drafts"]);
      const tables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_name IN ('products','variants','variant_attributes','product_categories')");
      expect(tables.rows).toHaveLength(0);
      await runMigrations({ db: database, quiet: true });
      const restored = await client.query("SELECT table_name FROM information_schema.tables WHERE table_name IN ('products','variants','variant_attributes','product_categories')");
      expect(restored.rows).toHaveLength(4);
    } finally { await client.close(); }
  });
});
