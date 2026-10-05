# F00-02 DB migrations, transaction context and test DB harness

## Outcome
Successfully implemented story F00-02 using Drizzle ORM and Postgres, with a PGLite test harness that does not require Docker. Tests assert migrations and transactional context isolation.

## Changed Files
- `package.json`: Added `drizzle-orm`, `postgres`, `dotenv`, `drizzle-kit`, `vitest`, `tsx`, `@electric-sql/pglite`. Added `test` script.
- `drizzle.config.ts`: Configured drizzle-kit for PostgreSQL dialect.
- `src/db/schema.ts`: Created `_migrations_test` table to verify Drizzle runner without polluting business logic.
- `src/db/index.ts`: Configured database connection using standard `postgres` in production/dev and `PGLite` in test mode for perfect isolation.
- `src/db/tx.ts`: Created unified `DbContext` and `withTransaction` helper.
- `src/db/migrate.ts`: Built a flexible migration runner script utilizing `migratePg` and `migratePglite`.
- `src/test-utils/db.ts`: Test utilities containing `setupTestDb` (initializes migrations), `withIsolatedTx` (runs callback inside a transaction then throws a `TestRollbackError` for guaranteed rollback isolation), and `seedFixture` helper.
- `src/db/migrate.test.ts`: Verifies migration runner idempotency.
- `src/db/tx.test.ts`: Verifies transactional rollbacks and commits.
- `src/test-utils/db.test.ts`: Verifies complete parallel test isolation.
- `src/db/migrations/*`: Drizzle-kit generated initial SQL migrations file.

## Verification
- **Tests**: `npm test` passed for all 5 tests (migration up/down, tx rollback, parallel isolation).
- **Lint**: `npm run lint` reported 0 errors.
- **Typecheck**: `npm run typecheck` passed.
- **Build**: No changes made to Next.js frontend code; build stays green.

## Remaining Risks / Follow-ups
- Currently relying on `PGLite` for test mode database. This allows fast, memory-based standard PostgreSQL testing without external containers. Ensure `DATABASE_URL` is set before doing any `npm run dev` or production deployments so the `postgres` driver connects appropriately.
