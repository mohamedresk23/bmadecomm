import { db } from "../db";
import { DbContext, TransactionContext } from "../db/tx";
import { runMigrations } from "../db/migrate";
import postgres from "postgres";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

export class TestRollbackError extends Error {
  constructor() {
    super("ROLLBACK_TEST_TX");
    this.name = "TestRollbackError";
  }
}

export class Barrier {
  private count = 0;
  private waiters: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];
  private timeoutId?: NodeJS.Timeout;

  constructor(
    private readonly participants: number,
    private readonly timeoutMs: number = 5000
  ) {}

  async wait(): Promise<void> {
    this.count++;
    if (this.count === this.participants) {
      if (this.timeoutId) clearTimeout(this.timeoutId);
      const toNotify = [...this.waiters];
      this.waiters = [];
      toNotify.forEach((w) => w.resolve());
      return;
    }

    return new Promise<void>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      if (!this.timeoutId) {
        this.timeoutId = setTimeout(() => {
          const err = new Error(
            `Barrier timed out after ${this.timeoutMs}ms waiting for ${this.participants} participants`
          );
          const toNotify = [...this.waiters];
          this.waiters = [];
          toNotify.forEach((w) => w.reject(err));
        }, this.timeoutMs);
      }
    });
  }
}

/**
 * Runs a test inside a database transaction and immediately rolls it back.
 * This guarantees complete isolation between tests and leaves the DB clean.
 */
export async function withIsolatedTx(
  callback: (tx: DbContext) => Promise<void>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  targetDb: any = db
) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await targetDb.transaction(async (tx: any) => {
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
  await runMigrations({ db, quiet: true });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function setupCustomTestDb(targetDb: any) {
  await runMigrations({ db: targetDb, quiet: true });
}

/**
 * Returns a pooled Postgres instance with a configured number of max connections.
 * Allows true concurrent transaction isolation testing across independent connections.
 */
export function getTestPoolDb(max = 5) {
  const connectionString =
    process.env.DATABASE_URL ||
    "postgresql://bmadecomm_dev:4TIismGz0_s3Zj2PsT4P6lhT2AL2Vt1W6pWtLbhp5lo@127.0.0.1:5432/bmadecomm_dev";
  const client = postgres(connectionString, { max });
  const poolDb = drizzlePg(client, { schema });
  return { poolDb, client };
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
