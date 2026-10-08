import { describe, it, expect, beforeAll } from "vitest";
import { setupTestDb, setupCustomTestDb, withIsolatedTx, getTestPoolDb, Barrier } from "./db";
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
      expect(rows.some((r) => r.id === "isolated-A")).toBe(true);
      expect(rows.some((r) => r.id === "isolated-B")).toBe(false);
    });
  });

  it("isolates test B", async () => {
    await withIsolatedTx(async (tx) => {
      // Test B inserts
      await tx.insert(migrationsTest).values({ id: "isolated-B" });

      const rows = await tx.select().from(migrationsTest);
      expect(rows.some((r) => r.id === "isolated-B")).toBe(true);
      expect(rows.some((r) => r.id === "isolated-A")).toBe(false);
    });
  });

  it("isolates concurrent transactions across independent pool connections with barrier synchronization", async () => {
    const { poolDb, client } = getTestPoolDb(5);

    try {
      // Ensure schema is set up on poolDb as well
      await setupCustomTestDb(poolDb);

      const uniqueIdA = `concurrent-A-${Date.now()}`;
      const uniqueIdB = `concurrent-B-${Date.now()}`;

      const insertBarrier = new Barrier(2, 5000);
      const readBarrier = new Barrier(2, 5000);

      let txARows: Array<{ id: string }> = [];
      let txBRows: Array<{ id: string }> = [];

      // Run two parallel transactions using withIsolatedTx on poolDb
      const taskA = withIsolatedTx(async (tx) => {
        // Step A1: Insert distinctive row
        await tx.insert(migrationsTest).values({ id: uniqueIdA });

        // Step A2: Wait for both transactions to complete insert
        await insertBarrier.wait();

        // Step A3: Query uncommitted state while both transactions are actively open
        txARows = await tx.select().from(migrationsTest);

        // Step A4: Wait for both transactions to complete read before exiting/rolling back
        await readBarrier.wait();
      }, poolDb);

      const taskB = withIsolatedTx(async (tx) => {
        // Step B1: Insert distinctive row
        await tx.insert(migrationsTest).values({ id: uniqueIdB });

        // Step B2: Wait for both transactions to complete insert
        await insertBarrier.wait();

        // Step B3: Query uncommitted state while both transactions are actively open
        txBRows = await tx.select().from(migrationsTest);

        // Step B4: Wait for both transactions to complete read before exiting/rolling back
        await readBarrier.wait();
      }, poolDb);

      // Execute both transactions concurrently
      await Promise.all([taskA, taskB]);

      // Assertions: Transaction A sees its own write, but cannot see uncommitted write of B
      expect(txARows.some((r) => r.id === uniqueIdA)).toBe(true);
      expect(txARows.some((r) => r.id === uniqueIdB)).toBe(false);

      // Assertions: Transaction B sees its own write, but cannot see uncommitted write of A
      expect(txBRows.some((r) => r.id === uniqueIdB)).toBe(true);
      expect(txBRows.some((r) => r.id === uniqueIdA)).toBe(false);

      // Verify no row leakage onto clean connection after both transactions roll back
      const cleanRows = await client.unsafe(
        `SELECT id FROM _migrations_test WHERE id IN ('${uniqueIdA}', '${uniqueIdB}')`
      );
      expect(cleanRows.length).toBe(0);
    } finally {
      await client.end();
    }
  }, 10000);
});
