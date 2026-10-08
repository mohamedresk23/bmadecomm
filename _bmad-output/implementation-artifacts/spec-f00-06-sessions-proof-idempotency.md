---
title: 'F00-06 — Idempotency keys, sessions and proof tokens'
type: feature
created: '2026-10-07'
status: done
route: dispatch
baseline_commit: d7fbdc3d53d2e447fba79ad05073233d287d7107
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** E02-01 cannot authenticate staff because the shared session/token foundation does not exist. Deliver F00-06 separately before customer identity/login and admin implementation.

**Approach:** Add transactional, reusable PostgreSQL primitives for idempotent local commands, scoped opaque sessions and single-use proof tokens. HTTP authentication screens and identity creation remain separate stories.

## Boundaries & Constraints

**Always:** Reuse Drizzle transaction context, existing migration path and ApiError conventions. Tokens are 32 cryptographically random bytes; persist SHA-256 hashes only. Scope customer/admin sessions and proof purpose/subject explicitly. Authentication/authorization must run before operation replay in consuming endpoints. No secret-bearing operation result is persisted. Consumers validate current identity/account/permissions; a session lookup is not authorization.

**Never:** Add customer/admin screens, default credentials, MFA provider, staff grants, public auth endpoints, unrelated outbox/media changes, automatic retention deletion or production migration execution. Never hold a DB transaction across provider/network calls; callbacks are local business work only.

**Decisions:** User delegated security choices and requested dependency stories separately. Adopt source session limits: admin 30-minute idle/12-hour absolute, customer seven-day absolute. Every successful admin session resolution counts as activity without extending absolute expiry. Reset proof is 30 minutes and verification proof 24 hours. Purpose identifiers are password_reset and email_verification; admin/customer scopes remain separate. These primitives are internal; account enablement, credential verification and HTTP CSRF are mandatory in later consumers.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Retry | Same actor/operation/key and canonical JSON payload | Execute local callback once; return committed stored JSON result on replay | Authorization is caller prerequisite |
| Changed retry | Same scope/key with different payload hash | No second callback or mutation | ApiError 409 |
| Callback failure | Callback writes then throws | Business writes and key/result roll back together; retry may execute | Propagate safe caller error |
| Concurrent retry | Parallel same scope/key on independent connections | One local effect, same committed result | No local in-memory lock |
| Session | Valid scope/token before idle/absolute deadline | Resolve subject; admin activity extends idle only to absolute cap | Wrong scope/expired/revoked returns no session |
| Rotation/revoke | Rotate current valid token, revoke current or subject's sessions | Old token rejected; subject-wide revocation includes both scopes | Idempotent revoke; failed transaction preserves old state |
| Proof | Valid subject/purpose/token before expiry | Atomic single consumption within caller transaction | Reused/forged/wrong-purpose/expired returns generic invalid result |
| Proof race | Two independent consumers of same token | One successful consumption only | Loser generic invalid result |

</frozen-after-approval>

## Code Map

- src/db/schema.ts: existing business-free foundation tables; extend without altering existing rows.
- src/db/index.ts: PGlite selected for NODE_ENV=test, postgres otherwise; add explicit isolated real-PostgreSQL test mode for concurrency evidence without exposing production DB.
- src/db/tx.ts: DbContext and withTransaction reusable; callback receives transaction so mutations and operation result are atomic.
- src/shared/api/errors.ts: existing 409/401 factories; retain envelope.
- src/test-utils/db.ts: migration/rollback helpers; rollback-only fixture visibility cannot prove independent-connection races.
- src/db/migrations/meta/_journal.json: latest 0004; generate next migration and snapshot, never edit applied SQL.
- package.json/.github/workflows/ci.yml: Vitest installed but no test script/job; typecheck failures currently masked.

## Tasks & Acceptance

**Execution:**

- [x] src/db/schema.ts and src/db/migrations/: add operation_keys scoped unique actor/operation/key, payload hash and JSON result; sessions hash/scope/subject/idle/absolute/revoked timestamps; proof_tokens hash/purpose/subject/expiry/consumed. UTC timestamptz, checks and lookup indexes. Subject references stay opaque internal IDs until the separately implemented identity schema adds integrity linkage.
- [x] src/shared/identity/tokens.ts: secure generation/hash and strict token input handling without secret logging.
- [x] src/shared/identity/sessions.ts: create/resolve/rotate/revoke/revokeAll with transactional expiry guards and explicit approved scope policies; return safe metadata, token only from creation/rotation.
- [x] src/shared/identity/proof-tokens.ts: issue/consume/invalidate purpose-scoped proof using an atomic conditional update inside provided transaction.
- [x] src/shared/idempotency/execute.ts: canonical JSON hashing, scoped conflict-safe insert/lock, transactional callback/result and replay; allow only safe JSON results, document prohibited secrets and external I/O.
- [x] src/db/index.ts, package.json and test configuration: isolated real-PostgreSQL mode and repeatable Vitest commands.
- [x] src/shared/identity/*.test.ts and src/shared/idempotency/*.test.ts: cover every matrix row, scope isolation, server-time boundaries, secure hash persistence, rollback and independent-connection races.
- [x] .github/workflows/ci.yml: PostgreSQL test service, run tests and fail typecheck correctly; preserve existing build/lint.
- [x] docs/identity-foundation.md: internal service/cookie consumption contracts, revocation ownership, replay-before-auth prohibition and migration compatibility; no public auth contract changes.

**Acceptance Criteria:**

- Given migrations from existing foundation, when applied and rerun, then schema/data remain compatible and no identity/default credentials are created.
- Given a valid server-issued bearer token, when DB rows/logs/errors are inspected, then only its hash is persisted and no secret is logged.
- Given future HTTP consumers, when applying the documented session contract, then production cookies require Secure/HttpOnly/host-only/SameSite and independent Origin/CSRF validation; opaque service metadata is not an authorization grant.
- Given test-only PostgreSQL configuration, when concurrency tests run, then independent committed connections prove the matrix's single-effect guarantees.
- Given any required lint/typecheck/build/test failure, when CI runs, then the job fails rather than masking it.

## Implementation Notes
- Implemented the three additive tables and transactional services; no accounts, auth endpoints, MFA or production data changes.
- Verification: 45 local tests and two independent-connection PostgreSQL tests passed on disposable PostgreSQL 18.4. Lint/typecheck passed; lint retains three baseline warnings. Production build passed with network access for existing Geist fonts.
- Vitest conditionally excludes only the pre-existing zero-byte outbox scaffold; filling it makes it discoverable again. No executable test was excluded.
- Drizzle generation encountered Windows uv_os_get_passwd failure; implementing agent generated metadata with a temporary username-only telemetry stub, then removed temporary files. Generated SQL was applied/rerun in both test backends.

- Final review patches verified: 50 local tests and 7 native PostgreSQL tests passed; lint/typecheck/build passed. Expiry-after-lock regressions demonstrated failure before correction and success afterward. See [verification report](verification-f00-06.md) for complete acceptance evidence and changed files.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence / disposition |
|---|---|---|
| Blind-1 test destination URL comparison | high | Raw strings differing in credentials/protocol/query can target the same DB; normalize effective destination and test rejection. Patch; grouped with Edge-1. |
| Blind-2 revoke old bearer after rotation | false | Rotation deliberately invalidates the old token. Current revokeSession contract targets a currently matching bearer; an invalidated token is not authority to revoke its replacement. Future logout/account consumers must serialize authenticated transitions. |
| Blind-3 revoke-all versus new issuance | low | Foundation revokeAll invalidates current matching rows, not future authentication. Account/credential validation belongs to later consumers; document caller identity-row serialization rather than inventing identity ownership or a new locking API. Documentation patch. |
| Blind-4 concurrent proof replacement | false | This foundation promises single-use for each issued token, not one live token per purpose. Replacement is a later consumer operation; document its mandatory identity-row serialization without adding an unrelated resend endpoint. |
| Blind-5 unbounded idempotency strings | medium | Arbitrary actor/operation/key strings can exceed unique B-tree entry limits. Reject empty/over-128-byte components before insertion; add boundary coverage. Patch. |
| Blind-6 PostgreSQL-incompatible JSON strings | medium | NUL/unpaired surrogate data passes JS canonicalization but fails jsonb persistence. Reject safely before storage; verify callback result failure rolls back writes. Patch. |
| Blind-7 hidden array properties | low | Non-enumerable extra array properties were silently omitted despite strict-JSON intent. Direct own-property validation correction plus regression. Patch. |
| Blind-8 populated upgrade coverage | medium | Clean migration/rerun does not prove pre-0005 row/constraint preservation. Add isolated populated upgrade regression; generated snapshot comparison already confirms existing metadata unchanged. Test patch. |
| Blind-9 session races coverage | medium | Local rollback/expiry assertions do not exercise independent row-lock waits. Add rotation/expiry-lock PostgreSQL regressions. Test patch; grouped with Edge-2. |
| Edge-1 same destination with distinct URL syntax | high | Same verified raw-string guard defect as Blind-1. Normalize/reject ambiguous test destinations and add negative tests. Patch. |
| Edge-2 session expiry during unchanged-row lock wait | high | Expiry predicate can execute before waiting without a changed tuple to force re-evaluation. Acquire matching row lock first, then check current server time; demonstrate red/green PostgreSQL regression. Patch. |
| Edge-3 proof expiry during unchanged-row lock wait | high | Same timing problem for conditional proof consumption. Lock proof before evaluating expiry inside caller transaction; demonstrate red/green regression. Patch. |
| Verification-1 rotation absolute deadline coverage | medium | Existing rotation assertions permit an accidental absolute-lifetime reset. Add near-deadline unchanged-absolute/capped-idle regression. Test patch. |
| Verification-2 test database guard coverage | medium | Negative configuration branches have no assertions. Test missing/bad protocol/non-test/same destination/valid explicit destination before connections. Test patch. |

No finding requires changed product intent or a new public API. Grouped patches preserve the frozen contract and remain within F00-06 services/test infrastructure.


## Design Notes

F00-06 delivers shared persistence primitives without inventing customer/admin account screens. Proof consumption takes the business transaction so a failed password-reset mutation cannot consume its proof. Idempotency stores only non-secret local results; bearer-producing login/session operations must not replay secrets through operation_keys. Session consumers remain responsible for current account state and actor authority.

## Verification

**Commands:**

- npm.cmd run lint — required; distinguish existing baseline failures from new ones.
- npm.cmd run typecheck — required after framework-generated types are available.
- npm.cmd run build — required; production build must not need a live test DB.
- npm.cmd run test — foundation regression and all local matrix tests.
- npm.cmd run test:postgres — dedicated disposable DB, independent-connection concurrency and migration evidence.

Verify real PostgreSQL availability before running its suite; missing service is a reported verification blocker, never substitute PGlite results for production concurrency proof.
