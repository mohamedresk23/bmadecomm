# F00-06 implementation and verification

Date: 2026-10-07. Scope: approved F00-06 prerequisite only. E02-01 admin login and the E01-01/E01-03 account stories are not implemented in this change.

## Result

Added scoped idempotent local commands, opaque admin/customer sessions with rotation and revocation, and transaction-bound single-use proof tokens. PostgreSQL stores token hashes only. Migration 0005 adds three tables, checks and indexes without modifying applied migrations or creating accounts. CI now runs tests, uses a disposable PostgreSQL service and fails on typecheck errors.

Three independent review lenses returned fourteen findings. Verified defects and regression gaps were patched; two claims were rejected against the explicit bearer/single-use contracts. No unresolved finding or deferred code defect remains. Caller identity-row serialization for future credential changes, session issuance and proof resend is documented.

## Final verification

| Check | Result |
|---|---|
| npm.cmd run test | PASS: 14 files, 50 tests |
| npm.cmd run test:postgres | PASS: 1 file, 7 tests on disposable PostgreSQL 18.4, independent connections |
| npm.cmd run lint | PASS: no errors; three baseline warnings in Upload.tsx, audit.test.ts and policy.test.ts |
| npm.cmd run typecheck | PASS |
| npm.cmd run build | PASS; network access needed for the existing Google Fonts imports |
| git diff --check | PASS |
| Generated metadata compatibility | Prior snapshot's existing table definitions preserved; 0005 prevId matches 0004 id |

PostgreSQL ran only on 127.0.0.1:55432 in a temporary cluster and a dedicated bmadecomm_f0006_test database. It was stopped after verification. No production database was connected or migrated. Portable binary provenance: [embedded-postgres project](https://github.com/leinelissen/embedded-postgres); no new application dependency was added.

The expired-while-waiting regressions for resolve, rotate and proof consumption failed against the pre-fix implementation, then all passed after locking the matching row before evaluating server expiry. The migration regression populated all existing foundation tables before 0005 and verified unchanged data and append-only audit enforcement afterward.

## Acceptance evidence

| Approved criterion | Evidence |
|---|---|
| Compatible additive migration, safe rerun, no default identity | Migration suite; PostgreSQL populated 0000–0004 -> 0005 upgrade and audit-constraint regression; existing snapshot comparison |
| Only token hashes persisted, safe errors | Identity tests inspect persisted rows; canonical token validation; services contain no token logging |
| Future cookie/CSRF/authority contract | docs/identity-foundation.md states Secure/HttpOnly/host-only/SameSite, independent Origin/CSRF, current account/grants and identity-row locks; public HTTP integration belongs to later consumers |
| Independent committed concurrency | PostgreSQL duplicate-command, single proof-consumption and simultaneous-rotation tests |
| Required failures block CI | Unmasked typecheck, unit and PostgreSQL steps; no continue-on-error or failure fallback |

## Matrix coverage

| Scenario | Passing coverage |
|---|---|
| Retry and changed retry | execute.test.ts canonical replay/scope/mismatch; PostgreSQL duplicate-command test |
| Callback failure | execute.test.ts mutation/key rollback, retry and unsupported-result rollback |
| Concurrent retry | concurrency.postgres.test.ts independent connections commit one effect |
| Session scope and expiry | identity.test.ts policy/scope/boundary; PostgreSQL unchanged-row wait rejection |
| Rotation and revocation | identity.test.ts failed-transaction rotation/current/all revoke; PostgreSQL one rotation winner and preserved absolute deadline |
| Matching single-use proof | identity.test.ts wrong subject/purpose, forged/expired/reused, invalidation and business rollback |
| Proof race | PostgreSQL independent proof consumers produce one winner; expired-lock-wait consumption fails |
| Input and test-destination guards | index.test.ts forbidden destinations; execute.test.ts UTF-8 bounds and strict PostgreSQL-compatible JSON |

## Changed files

- .github/workflows/ci.yml
- package.json
- src/db/index.ts
- src/db/index.test.ts
- src/db/migrate.ts
- src/db/schema.ts
- src/db/tx.ts
- src/db/migrations/0005_sessions_proof_idempotency.sql
- src/db/migrations/meta/0005_snapshot.json
- src/db/migrations/meta/_journal.json
- src/test-utils/db.ts
- src/shared/identity/tokens.ts
- src/shared/identity/sessions.ts
- src/shared/identity/proof-tokens.ts
- src/shared/identity/identity.test.ts
- src/shared/idempotency/execute.ts
- src/shared/idempotency/execute.test.ts
- src/shared/idempotency/concurrency.postgres.test.ts
- vitest.config.ts
- vitest.postgres.config.ts
- docs/identity-foundation.md
- _bmad-output/implementation-artifacts/spec-f00-06-sessions-proof-idempotency.md
- _bmad-output/implementation-artifacts/verification-f00-06.md

No frontend was added, so browser/frontend-backend journey verification is not applicable to this internal foundation. Existing production routes built successfully.

## Follow-up boundaries

E01-01 identity/password registration and E01-03 customer login remain prerequisites for E02-01. Consumers must add identity integrity linkage, current enabled/grant checks, cookie/CSRF enforcement and shared identity-row locks. The idempotency consumer must exclude semantic secrets from results and authorize before replay; JSON validation cannot infer secret meaning. Test isolation cannot prove arbitrary remote DNS aliases are distinct; use a physically disposable DB.

The pre-existing zero-byte outbox test scaffold is excluded only while its size is zero; actual tests in that file will be discovered once populated. Outbox/media behavior was not changed. The three existing lint warnings and non-blocking Vite configuration-format warning remain.

Drizzle generation initially hit a Windows user-information error; the implementing agent used a temporary username-only telemetry stub and removed it. Generated DDL and metadata were subsequently verified by actual migration application and populated-upgrade tests.
