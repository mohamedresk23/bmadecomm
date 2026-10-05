import { describe, it, expect, beforeAll } from "vitest";
import { setupTestDb, withIsolatedTx } from "../test-utils/db";
import { withTransaction } from "./tx";
import { migrationsTest } from "./schema";

beforeAll(async () => {
  await setupTestDb();
});

describe("Transaction Helper", () => {
  it("rolls back partial writes when an error is thrown", async () => {
    await withIsolatedTx(async (testTx) => {
      // Create a unique ID for this test case
      const testId = "rollback-test-id";
      
      const failingOp = async () => {
        await withTransaction(testTx, async (tx) => {
          await tx.insert(migrationsTest).values({ id: testId });
          throw new Error("Business logic error");
        });
      };

      await expect(failingOp()).rejects.toThrow("Business logic error");

      // Verify it was rolled back by checking count
      const rows = await testTx.select().from(migrationsTest);
      expect(rows.length).toBe(0);
    });
  });

  it("commits writes on success", async () => {
    await withIsolatedTx(async (testTx) => {
      const testId = "commit-test-id";
      
      await withTransaction(testTx, async (tx) => {
        await tx.insert(migrationsTest).values({ id: testId });
      });

      // Verify it was committed inside the test context
      const rows = await testTx.select().from(migrationsTest);
      expect(rows.length).toBe(1);
      expect(rows[0].id).toBe(testId);
    });
  });
});
