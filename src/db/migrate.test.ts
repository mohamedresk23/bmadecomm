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

    const applied = await getAppliedMigrations(testDb);
    expect(applied.length).toBe(pendingBefore.length);
    expect(applied[0].tag).toBe("0000_busy_loki");
    expect(applied[applied.length - 1].tag).toBe("0011_shipping_zones_and_methods");
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
    const appliedBefore = await getAppliedMigrations(testDb);
    const totalCount = appliedBefore.length;

    // Rollback last migration (0011_shipping_zones_and_methods)
    const rollbackRes = await rollbackMigration({ db: testDb, steps: 1, quiet: true });
    expect(rollbackRes.rolledBack).toEqual(["0011_shipping_zones_and_methods"]);

    // Shipping tables dropped
    expect(await checkTableExists(testDb, "shipping_methods")).toBe(false);
    expect(await checkTableExists(testDb, "shipping_zones")).toBe(false);

    // Store settings table (from 0010) still exists
    expect(await checkTableExists(testDb, "store_settings")).toBe(true);

    // Journal record removed
    const appliedAfter = await getAppliedMigrations(testDb);
    expect(appliedAfter.length).toBe(totalCount - 1);
    expect(appliedAfter[appliedAfter.length - 1].tag).toBe("0010_store_settings");
  }, 20000);

  it("repeated rollback to the same target is a safe no-op", async () => {
    await runMigrations({ db: testDb, quiet: true });

    // Rollback to target 0010_store_settings
    const res1 = await rollbackMigration({
      db: testDb,
      target: "0010_store_settings",
      quiet: true,
    });
    expect(res1.rolledBack).toEqual(["0011_shipping_zones_and_methods"]);

    // Repeating rollback targeting 0010_store_settings
    const res2 = await rollbackMigration({
      db: testDb,
      target: "0010_store_settings",
      quiet: true,
    });
    expect(res2.rolledBack).toEqual([]);

    const applied = await getAppliedMigrations(testDb);
    expect(applied[applied.length - 1].tag).toBe("0010_store_settings");
  }, 20000);

  it("re-applies up after down successfully", async () => {
    await runMigrations({ db: testDb, quiet: true });

    // Rollback 1 step
    await rollbackMigration({ db: testDb, steps: 1, quiet: true });
    expect(await checkTableExists(testDb, "shipping_zones")).toBe(false);

    // Re-apply up
    const reapplyRes = await runMigrations({ db: testDb, quiet: true });
    expect(reapplyRes.applied).toEqual(["0011_shipping_zones_and_methods"]);

    // Schema restored
    expect(await checkTableExists(testDb, "shipping_zones")).toBe(true);
    expect(await checkTableExists(testDb, "shipping_methods")).toBe(true);

    const applied = await getAppliedMigrations(testDb);
    expect(applied[applied.length - 1].tag).toBe("0011_shipping_zones_and_methods");
  }, 20000);

  it("rolls back multiple migrations in correct reverse order", async () => {
    await runMigrations({ db: testDb, quiet: true });

    // Rollback 2 steps
    const res = await rollbackMigration({ db: testDb, steps: 2, quiet: true });
    expect(res.rolledBack).toEqual([
      "0011_shipping_zones_and_methods",
      "0010_store_settings",
    ]);

    // Both 0011 and 0010 dropped
    expect(await checkTableExists(testDb, "shipping_methods")).toBe(false);
    expect(await checkTableExists(testDb, "store_settings")).toBe(false);

    // 0009 is now the active head
    const applied = await getAppliedMigrations(testDb);
    expect(applied[applied.length - 1].tag).toBe("0009_staff_identity_revocation");
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
