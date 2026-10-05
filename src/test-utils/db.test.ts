import { describe, it, expect, beforeAll } from "vitest";
import { setupTestDb, withIsolatedTx } from "./db";
import { migrationsTest } from "../db/schema";

beforeAll(async () => {
  await setupTestDb();
});

describe("Test Database Isolation Harness", () => {
  it("isolates test A", async () => {
    await withIsolatedTx(async (tx) => {
      // Test A inserts
      await tx.insert(migrationsTest).values({ id: "isolated-A" });
      
      const rows = await tx.select().from(migrationsTest);
      expect(rows.some(r => r.id === "isolated-A")).toBe(true);
      expect(rows.some(r => r.id === "isolated-B")).toBe(false);
    });
  });

  it("isolates test B", async () => {
    await withIsolatedTx(async (tx) => {
      // Test B inserts
      await tx.insert(migrationsTest).values({ id: "isolated-B" });
      
      const rows = await tx.select().from(migrationsTest);
      expect(rows.some(r => r.id === "isolated-B")).toBe(true);
      expect(rows.some(r => r.id === "isolated-A")).toBe(false);
    });
  });
});
