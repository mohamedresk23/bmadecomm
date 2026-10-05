---
title: 'F00-02 — DB migrations, transaction context and test DB harness'
type: 'feature'
created: '2026-10-05'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
baseline_revision: 'bffc96921b7ea8cb93a600fef4f9b13b8717eb0c'
---

<intent-contract>

## Intent

**Problem:** We need a safe, repeatable way to evolve our database schema, execute transactional units of work without partial writes, and run tests in isolated database contexts. The project currently has no database ORM or query builder.

**Approach:** Introduce Drizzle ORM and `postgres` driver for PostgreSQL. Implement a migration runner, a transaction context type/helper to pass transactions across functions, and a test harness using rollback-transactions (or schema isolation) for isolated integration testing along with a seed fixture helper.

## Boundaries & Constraints

**Always:**
- Use Drizzle ORM for schema definition and migrations.
- Support `FOR UPDATE` row locks (supported natively by Drizzle).
- Define a shared database context type so functions can accept either the main DB instance or a transaction instance.
- Ensure the test DB harness provides complete isolation between parallel tests (e.g. via rollback transactions).
- Store monetary values with precision (e.g., integer minor units).

**Never:**
- Do not create any business tables in this story (e.g., users, orders).
- Do not use global mutable state for transactions.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Migration apply | Pending migrations exist | Migrations are applied idempotently | Fails and logs error if SQL is invalid |
| Transaction success | Valid operations inside `db.transaction` | All operations commit successfully | N/A |
| Transaction rollback | Error thrown inside `db.transaction` | All operations are rolled back | Error propagates to caller |
| Test isolation | Two parallel tests writing to the same table | Neither test sees the other's data (via rollback or schema) | N/A |

</intent-contract>

## Code Map

- `package.json` -- Add `drizzle-orm`, `postgres`, `drizzle-kit`, and `dotenv`.
- `src/db/index.ts` -- Database connection and exported `db` instance.
- `src/db/schema.ts` -- Empty schema file to be extended in future stories.
- `src/db/migrate.ts` -- Migration runner script.
- `src/db/tx.ts` -- Transaction context type and helpers.
- `src/test-utils/db.ts` -- Test harness for isolated DB contexts (rollback wrapper) and seed helper.
- `src/db/migrate.test.ts` -- Migration up/down idempotency test.
- `src/db/tx.test.ts` -- Transaction rollback test.
- `src/test-utils/db.test.ts` -- Parallel test isolation check.
- `drizzle.config.ts` -- Drizzle kit configuration.

## Tasks & Acceptance

**Execution:**
- `package.json` -- Install Drizzle ORM, Drizzle kit, and postgres driver -- Required for DB access and migrations.
- `drizzle.config.ts` -- Configure Drizzle kit -- Required for generating migrations.
- `src/db/index.ts` -- Setup PostgreSQL connection and Drizzle instance -- Centralized DB access.
- `src/db/schema.ts` -- Create a dummy table (e.g. `_migrations_test`) for testing migrations in this story -- Needed since we can't create business tables.
- `src/db/migrate.ts` -- Write a script to run Drizzle migrations -- Required for deployment and testing.
- `src/db/tx.ts` -- Export a `DbContext` type (union of DB and TX) and any helpers -- Required to pass transaction context cleanly.
- `src/test-utils/db.ts` -- Implement `withIsolatedTx` (throws rollback error) and a seed fixture helper -- Required for F00-02 test isolation requirements.
- `src/db/*.test.ts` -- Write tests for migration idempotency, transaction rollback, and parallel test isolation -- Fulfills acceptance criteria.

**Acceptance Criteria:**
- Given a pending migration, when the migration runner runs, then the schema is updated and running it again is a no-op.
- Given a transaction context, when an error is thrown, then no partial writes remain in the database.
- Given two parallel tests using the test harness, when they insert data, then they cannot see each other's writes.

## Design Notes

We will use Drizzle's native transaction capabilities. To allow functions to accept either the main DB or a transaction, we define a unified type:
```typescript
import { ExtractTablesWithRelations } from "drizzle-orm";
import { PgTransaction } from "drizzle-orm/pg-core";
import { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import { db } from "./index";

export type DbContext = typeof db | PgTransaction<PostgresJsQueryResultHKT, Record<string, never>, ExtractTablesWithRelations<Record<string, never>>>;
```
For test isolation, a rollback transaction is highly efficient:
```typescript
export async function withIsolatedTx(callback: (tx: DbContext) => Promise<void>) {
  try {
    await db.transaction(async (tx) => {
      await callback(tx);
      throw new Error('ROLLBACK_TEST_TX');
    });
  } catch (err: any) {
    if (err.message !== 'ROLLBACK_TEST_TX') throw err;
  }
}
```

## Verification

**Commands:**
- `npm run lint` -- expected: completes without errors.
- `npm run typecheck` -- expected: completes without errors.
- `npm test` -- expected: transaction, migration, and test-isolation tests pass.
