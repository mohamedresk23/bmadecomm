import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  runMigrations,
  rollbackMigration,
  getAppliedMigrations,
  getPendingMigrations,
} from "./migrate";
import { drizzle } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";
import os from "os";

async function checkTableExists(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  targetDb: any,
  tableName: string
): Promise<boolean> {
  const res = await targetDb.execute(
    sql.raw(`
      SELECT EXISTS (
        SELECT 1 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = '${tableName}'
      ) as exists
    `)
  );
  const rows = Array.isArray(res) ? res : res?.rows ?? [];
  return rows.length > 0 && Boolean(rows[0]?.exists);
}

describe("Database Migrations (Up / Down / Rollback)", () => {
  let client: PGlite;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let testDb: any;

  beforeEach(() => {
    client = new PGlite();
    testDb = drizzle(client);
  });

  afterEach(async () => {
    await client.close();
  });

  async function seedRetainedDraft() {
    await testDb.execute(sql`INSERT INTO products (id, name) VALUES ('retained-product', 'Retained draft')`);
    await testDb.execute(sql`INSERT INTO variants (id, product_id, sku, combination_key, price_minor, currency, currency_scale, sort_order)
      VALUES ('retained-variant', 'retained-product', 'MIGRATION-SKU', '[]', 1234, 'EGP', 2, 0)`);
  }

  async function expectRetainedDraft() {
    const result = await client.query("SELECT p.name, v.sku, v.price_minor::text AS price FROM products p JOIN variants v ON v.product_id = p.id WHERE p.id = 'retained-product'");
    expect(result.rows).toEqual([{ name: "Retained draft", sku: "MIGRATION-SKU", price: "1234" }]);
  }

  async function expectMediaRevision(present: boolean) {
    const result = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'media_revision'");
    expect(result.rows).toHaveLength(present ? 1 : 0);
  }

  it("applies up on a clean database and records all migrations in journal", async () => {
    const pendingBefore = await getPendingMigrations(testDb);
    expect(pendingBefore.length).toBeGreaterThan(0);

    const result = await runMigrations({ db: testDb, quiet: true });
    expect(result.applied.length).toBe(pendingBefore.length);

    // Verify key tables exist
    expect(await checkTableExists(testDb, "_migrations_test")).toBe(true);
    expect(await checkTableExists(testDb, "audit_events")).toBe(true);
    expect(await checkTableExists(testDb, "shipping_zones")).toBe(true);
    expect(await checkTableExists(testDb, "shipping_methods")).toBe(true);
    expect(await checkTableExists(testDb, "payment_method_configs")).toBe(true);
    expect(await checkTableExists(testDb, "categories")).toBe(true);
    for (const table of ["products", "variants", "variant_attributes", "product_categories"]) expect(await checkTableExists(testDb, table)).toBe(true);

    // Verify seeded baseline payment methods
    const configs = await testDb.execute(sql`SELECT * FROM payment_method_configs ORDER BY id ASC;`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const configRows = Array.isArray(configs) ? configs : (configs as any)?.rows ?? [];
    expect(configRows.length).toBe(2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(configRows.find((r: any) => r.id === "cod")?.version).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(configRows.find((r: any) => r.id === "online_card")?.version).toBe(1);

    const applied = await getAppliedMigrations(testDb);
    expect(applied.length).toBe(pendingBefore.length);
    expect(applied[0].tag).toBe("0000_busy_loki");
    expect(applied[applied.length - 1].tag).toBe("0016_upload_rate_limit");
    expect(await checkTableExists(testDb, "product_media")).toBe(true);
    expect(await checkTableExists(testDb, "upload_rate_buckets")).toBe(true);
  }, 20000);

  it("re-running up is idempotent without duplicating or corrupting migration history", async () => {
    // First run
    await runMigrations({ db: testDb, quiet: true });
    const appliedFirst = await getAppliedMigrations(testDb);

    // Second run
    const resultSecond = await runMigrations({ db: testDb, quiet: true });
    expect(resultSecond.applied).toEqual([]);

    const appliedSecond = await getAppliedMigrations(testDb);
    expect(appliedSecond.length).toBe(appliedFirst.length);
    expect(appliedSecond.map((a) => a.id)).toEqual(appliedFirst.map((a) => a.id));
  }, 20000);

  it("executes down (1 step) and restores previous schema state", async () => {
    await runMigrations({ db: testDb, quiet: true });
    await seedRetainedDraft();
    const appliedBefore = await getAppliedMigrations(testDb);
    const totalCount = appliedBefore.length;

    // Roll back the latest rate limiter while preserving gallery and products.
    const rollbackRes = await rollbackMigration({ db: testDb, steps: 1, quiet: true });
    expect(rollbackRes.rolledBack).toEqual(["0016_upload_rate_limit"]);

    expect(await checkTableExists(testDb, "upload_rate_buckets")).toBe(false);
    await expectRetainedDraft();
    await expectMediaRevision(true);
    for (const table of ["product_media", "products", "variants", "variant_attributes", "product_categories"]) expect(await checkTableExists(testDb, table)).toBe(true);
    expect(await checkTableExists(testDb, "categories")).toBe(true);

    // Payment, shipping and store settings tables still exist
    expect(await checkTableExists(testDb, "payment_method_configs")).toBe(true);
    expect(await checkTableExists(testDb, "shipping_methods")).toBe(true);
    expect(await checkTableExists(testDb, "shipping_zones")).toBe(true);
    expect(await checkTableExists(testDb, "store_settings")).toBe(true);

    // Journal record removed
    const appliedAfter = await getAppliedMigrations(testDb);
    expect(appliedAfter.length).toBe(totalCount - 1);
    expect(appliedAfter[appliedAfter.length - 1].tag).toBe("0015_product_gallery");
  }, 20000);

  it("repeated rollback to the same target is a safe no-op", async () => {
    await runMigrations({ db: testDb, quiet: true });

    // Rollback to target 0012_payment_method_configs
    const res1 = await rollbackMigration({
      db: testDb,
      target: "0012_payment_method_configs",
      quiet: true,
    });
    expect(res1.rolledBack).toEqual(["0016_upload_rate_limit", "0015_product_gallery", "0014_product_drafts", "0013_categories"]);

    // Repeating rollback targeting 0012_payment_method_configs
    const res2 = await rollbackMigration({
      db: testDb,
      target: "0012_payment_method_configs",
      quiet: true,
    });
    expect(res2.rolledBack).toEqual([]);

    const applied = await getAppliedMigrations(testDb);
    expect(applied[applied.length - 1].tag).toBe("0012_payment_method_configs");
  }, 20000);

  it("re-applies up after down successfully", async () => {
    await runMigrations({ db: testDb, quiet: true });
    await seedRetainedDraft();

    // Rollback 1 step
    await rollbackMigration({ db: testDb, steps: 1, quiet: true });
    expect(await checkTableExists(testDb, "upload_rate_buckets")).toBe(false);
    expect(await checkTableExists(testDb, "products")).toBe(true);

    // Re-apply up
    const reapplyRes = await runMigrations({ db: testDb, quiet: true });
    expect(reapplyRes.applied).toEqual(["0016_upload_rate_limit"]);
    await expectRetainedDraft();
    await expectMediaRevision(true);

    // Schema restored
    expect(await checkTableExists(testDb, "categories")).toBe(true);
    expect(await checkTableExists(testDb, "products")).toBe(true);
    expect(await checkTableExists(testDb, "product_media")).toBe(true);
    expect(await checkTableExists(testDb, "upload_rate_buckets")).toBe(true);
    expect(await checkTableExists(testDb, "payment_method_configs")).toBe(true);
    expect(await checkTableExists(testDb, "shipping_zones")).toBe(true);
    expect(await checkTableExists(testDb, "shipping_methods")).toBe(true);

    const applied = await getAppliedMigrations(testDb);
    expect(applied[applied.length - 1].tag).toBe("0016_upload_rate_limit");
  }, 20000);

  it("rolls back multiple migrations in correct reverse order", async () => {
    await runMigrations({ db: testDb, quiet: true });
    await seedRetainedDraft();

    // Rollback 2 steps
    const res = await rollbackMigration({ db: testDb, steps: 2, quiet: true });
    expect(res.rolledBack).toEqual([
      "0016_upload_rate_limit",
      "0015_product_gallery",
    ]);

    // Gallery/rate tables are dropped; product drafts and earlier tables remain.
    expect(await checkTableExists(testDb, "upload_rate_buckets")).toBe(false);
    expect(await checkTableExists(testDb, "product_media")).toBe(false);
    await expectRetainedDraft();
    await expectMediaRevision(false);
    expect(await checkTableExists(testDb, "categories")).toBe(true);
    expect(await checkTableExists(testDb, "products")).toBe(true);
    expect(await checkTableExists(testDb, "payment_method_configs")).toBe(true);
    expect(await checkTableExists(testDb, "shipping_methods")).toBe(true);
    expect(await checkTableExists(testDb, "shipping_zones")).toBe(true);
    expect(await checkTableExists(testDb, "store_settings")).toBe(true);

    // 0014 is now the active head.
    const applied = await getAppliedMigrations(testDb);
    expect(applied[applied.length - 1].tag).toBe("0014_product_drafts");
  }, 20000);

  it("maintains schema and journal consistency if a rollback operation fails", async () => {
    // Setup isolated temp migrations directory
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "migration-atomic-test-"));
    const metaDir = path.join(tempDir, "meta");
    fs.mkdirSync(metaDir, { recursive: true });

    const journal = {
      version: "7",
      dialect: "postgresql",
      entries: [
        {
          idx: 0,
          version: "7",
          when: 1000,
          tag: "0000_sample",
          breakpoints: true,
        },
      ],
    };
    fs.writeFileSync(path.join(metaDir, "_journal.json"), JSON.stringify(journal));
    fs.writeFileSync(
      path.join(tempDir, "0000_sample.sql"),
      'CREATE TABLE "sample_atomic" ("id" text PRIMARY KEY);'
    );
    // Write invalid SQL in down migration to force failure
    fs.writeFileSync(
      path.join(tempDir, "0000_sample.down.sql"),
      "DROP TABLE sample_atomic; INVALID SQL THAT CAUSES ERROR;"
    );

    try {
      // Apply up
      await runMigrations({ db: testDb, migrationsFolder: tempDir, quiet: true });
      expect(await checkTableExists(testDb, "sample_atomic")).toBe(true);
      const appliedBefore = await getAppliedMigrations(testDb, tempDir);
      expect(appliedBefore.length).toBe(1);

      // Attempt rollback - must throw and abort
      await expect(
        rollbackMigration({ db: testDb, migrationsFolder: tempDir, steps: 1, quiet: true })
      ).rejects.toThrow();

      // Transaction must have rolled back: table still exists, journal entry preserved!
      expect(await checkTableExists(testDb, "sample_atomic")).toBe(true);
      const appliedAfter = await getAppliedMigrations(testDb, tempDir);
      expect(appliedAfter.length).toBe(1);
      expect(appliedAfter[0].tag).toBe("0000_sample");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }, 20000);

  it("refuses rollback with clear error when required .down.sql is missing", async () => {
    // Setup isolated temp migrations directory
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "migration-missing-down-"));
    const metaDir = path.join(tempDir, "meta");
    fs.mkdirSync(metaDir, { recursive: true });

    const journal = {
      version: "7",
      dialect: "postgresql",
      entries: [
        {
          idx: 0,
          version: "7",
          when: 2000,
          tag: "0000_no_down",
          breakpoints: true,
        },
      ],
    };
    fs.writeFileSync(path.join(metaDir, "_journal.json"), JSON.stringify(journal));
    fs.writeFileSync(
      path.join(tempDir, "0000_no_down.sql"),
      'CREATE TABLE "table_no_down" ("id" text PRIMARY KEY);'
    );
    // Intentionally omit 0000_no_down.down.sql

    try {
      // Apply up
      await runMigrations({ db: testDb, migrationsFolder: tempDir, quiet: true });
      expect(await checkTableExists(testDb, "table_no_down")).toBe(true);

      // Attempt rollback - must reject with explicit error
      await expect(
        rollbackMigration({ db: testDb, migrationsFolder: tempDir, steps: 1, quiet: true })
      ).rejects.toThrow(/Missing down migration file for "0000_no_down"/);

      // Table and migration record remain completely intact
      expect(await checkTableExists(testDb, "table_no_down")).toBe(true);
      const applied = await getAppliedMigrations(testDb, tempDir);
      expect(applied.length).toBe(1);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }, 20000);
});
