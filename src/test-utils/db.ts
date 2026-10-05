import { db } from "../db";
import { DbContext } from "../db/tx";
import { runMigrations } from "../db/migrate";

export class TestRollbackError extends Error {
  constructor() {
    super("ROLLBACK_TEST_TX");
    this.name = "TestRollbackError";
  }
}

/**
 * Runs a test inside a database transaction and immediately rolls it back.
 * This guarantees complete isolation between tests and leaves the DB clean.
 */
export async function withIsolatedTx(callback: (tx: DbContext) => Promise<void>) {
  try {
    await db.transaction(async (tx) => {
      await callback(tx as DbContext);
      throw new TestRollbackError();
    });
  } catch (err: unknown) {
    if (!(err instanceof TestRollbackError)) {
      throw err;
    }
  }
}

// Ensure the schema is ready before any DB tests run
export async function setupTestDb() {
  await runMigrations();
}

/**
 * Seed fixture helper for testing.
 * Inserts rows into the given table and returns them.
 */
export async function seedFixture<TTable>(
  tx: DbContext,
  table: TTable,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: any[]
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tx as any).insert(table).values(rows).returning();
}
