import { db } from "../db";
import { DbContext } from "../db/tx";
import { runMigrations } from "../db/migrate";
import postgres from "postgres";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureTestSchemaCompat(targetDb: any) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS "operation_keys" (
      "id" text PRIMARY KEY NOT NULL,
      "actor" text NOT NULL,
      "operation" text NOT NULL,
      "key" text NOT NULL,
      "payload_hash" text NOT NULL,
      "result" jsonb,
      "completed_at" timestamp with time zone,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "operation_keys_hash_check" CHECK ("operation_keys"."payload_hash" ~ '^[0-9a-f]{64}$'),
      CONSTRAINT "operation_keys_completion_check" CHECK ("operation_keys"."completed_at" IS NOT NULL OR "operation_keys"."result" IS NULL)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "operation_keys_scope_uq" ON "operation_keys" USING btree ("actor","operation","key")`,
    `ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "scope" text`,
    `ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "subject" text`,
    `ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "absolute_expires_at" timestamp with time zone`,
    `ALTER TABLE "sessions" ALTER COLUMN "user_id" DROP NOT NULL`,
    `ALTER TABLE "sessions" ALTER COLUMN "context" DROP NOT NULL`,
    `ALTER TABLE "sessions" ALTER COLUMN "expires_at" DROP NOT NULL`,
    `ALTER TABLE "sessions" ALTER COLUMN "last_seen_at" DROP NOT NULL`,
    `ALTER TABLE "proof_tokens" ADD COLUMN IF NOT EXISTS "subject" text`,
    `ALTER TABLE "proof_tokens" ALTER COLUMN "user_id" DROP NOT NULL`,
  ];
  for (const stmt of statements) {
    await targetDb.execute(sql.raw(stmt));
  }
}

// Ensure the schema is ready before any DB tests run
export async function setupTestDb() {
  await runMigrations({ db, quiet: true });
  await ensureTestSchemaCompat(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function setupCustomTestDb(targetDb: any) {
  await runMigrations({ db: targetDb, quiet: true });
  await ensureTestSchemaCompat(targetDb);
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
