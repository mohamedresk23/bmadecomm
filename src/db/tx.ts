import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import type { PgliteQueryResultHKT } from "drizzle-orm/pglite";
import * as schema from "./schema";
import { db } from "./index";

// A unified transaction context that allows passing either the root `db` instance
// or an active transaction to functions that execute queries.
export type DbContext =
  | typeof db
  | PgTransaction<PostgresJsQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>
  | PgTransaction<PgliteQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>;

/**
 * Execute a unit of work inside a transaction.
 * If the context is already a transaction, it uses savepoints (nested transactions).
 * If the context is the root db, it starts a new transaction.
 */
export async function withTransaction<T>(
  context: DbContext,
  callback: (tx: DbContext) => Promise<T>
): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return context.transaction(callback as any);
}
