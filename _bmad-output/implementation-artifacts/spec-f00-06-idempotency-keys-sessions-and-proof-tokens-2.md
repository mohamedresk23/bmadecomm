---
title: 'F00-06 — Idempotency keys, sessions and proof tokens'
type: feature
created: 2026-10-06
status: blocked
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** The database and API foundations exist, but shared safe-retry, session and proof-token primitives are missing. F00-06 is BE/DB foundation work, not registration, login, checkout or guest-tracking UI.

**Approach:** Add transactional actor/operation-scoped idempotency with canonical request hashes and stored results; opaque hashed sessions with secure host-only cookies, rotation and revoke-all; hashed purpose/subject-scoped single-use expiring proofs. Reuse existing transaction, error and audit helpers.

## Boundaries & Constraints

**Always:** Follow AD-1/2/3/5/9/10/15/17/18; validate authorization before replay; serialize execution in PostgreSQL; store token hashes only; separate customer/admin contexts; use generic proof failures. Follow the repository's colocated-test convention and local Next.js cookie guide.

**Never:** Invent approval of A-09/A-10/OQ-06, token policy or operation-key retention; install an unapproved auth library; add unrelated endpoints or business UI; change ACLs; create `tests` or `scripts` just to satisfy a search. Stop on command failure as requested.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Replay | Same actor, operation, key and canonical payload | Stored result, one committed execution | No error |
| Changed payload | Same scoped key, different payload hash | No second execution | Conflict via ApiError |
| Parallel replay | Concurrent requests with same scoped key | One execution; identical stored results | Transactional guard |
| Proof consumption | Correct purpose and subject, unused and unexpired token | One successful consumption | Other cases share a generic failure |
| Session rotation | Active scoped session | Replacement active; old token invalid | Invalid/expired session rejected |
| Revoke-all | Multiple sessions for one subject | Existing sessions rejected afterward | No secret in audit/logs |

</intent-contract>

## Code Map

- `src/db/schema.ts` — Drizzle schema; no operation_keys, sessions or proof_tokens yet.
- `src/db/tx.ts` — `DbContext` and `withTransaction`; shared transaction/savepoint support.
- `src/db/index.ts` — PostgreSQL adapter; NODE_ENV=test selects PGlite. PGlite alone does not prove independent-connection PostgreSQL lock behavior.
- `src/db/migrate.ts` and `drizzle.config.ts` — migration folder and generation conventions.
- `src/test-utils/db.ts` — `setupTestDb`, `withIsolatedTx`, `seedFixture`.
- `src/shared/api/errors.ts` — `ApiError.conflict`, unauthorized and safe envelope.
- `src/shared/authz/policy.ts` — existing ownership and permission checks; no session-backed account store yet.
- `src/shared/authz/audit.ts` — `writeAudit` accepts the business transaction.
- `src/db/tx.test.ts`, `src/shared/api/validation.test.ts` — colocated Vitest conventions.
- `package.json` — existing Drizzle/Postgres/Zod/Vitest dependencies; lint/typecheck/build scripts, no test script.
- `.github/workflows/ci.yml` — no test step; typecheck currently masks failure. Relevant CI integration needs explicit verification ownership.
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md` — async cookies API; writes only in Server Functions/Route Handlers.

## Tasks & Acceptance

The following is a proposed implementation map, not authorization to resolve the open policy gates.

**Execution:**
- `src/db/schema.ts`, `src/db/migrations/0005_identity_primitives.sql`, migration metadata — define the three tables with scope/uniqueness/expiry constraints after contracts are fixed.
- `src/shared/idempotency/operation.ts` — canonical request hashing, atomic execution and stored-result replay within the caller's transaction.
- `src/modules/identity/application/sessions.ts`, `src/modules/identity/application/proof-tokens.ts` — token issuance, lookup, rotation/revocation and atomic proof consumption, keeping identity ownership.
- `src/modules/identity/infrastructure/session-cookies.ts` — secure HttpOnly host-only cookies with separate contexts.
- Colocated `.test.ts` files for these primitives — hashing, rollback, scope, expiry and single-use tests; concurrency evidence against real PostgreSQL for locking.
- `package.json`, `.github/workflows/ci.yml` — wire relevant tests and verification without masking failures, if required by the final spec.

**Acceptance Criteria:**
- Given the same actor/operation/key and payload, when requests repeat or race, then one execution commits and every successful request receives the stored result.
- Given a stored scoped key, when another payload uses that key, then conflict occurs without new side effects.
- Given an issued session or proof, when its database row is inspected, then no raw token is stored.
- Given a valid scoped proof, when concurrent consumers attempt it, then exactly one succeeds; reused, expired, forged and wrong-scope proofs fail generically.
- Given an active session, when rotation or revoke-all commits, then the old applicable sessions are rejected.
- Given a session cookie, when issued through the HTTP adapter, then Secure/HttpOnly and host-only restrictions apply with separate customer/admin contexts.

## Spec Change Log

## Review Triage Log

## Verification

- `npm run lint` — no lint errors.
- `npm run typecheck` — no TypeScript errors.
- `npm run build` — production build succeeds if implementation proceeds.
- Local installed Vitest runner (`node node_modules/vitest/vitest.mjs run <actual colocated paths>`) — relevant unit/integration tests pass. No `npm test` script exists.
- Independent PostgreSQL connections — concurrency/rollback assertions required by AD-17, beyond PGlite-only evidence.
- No frontend feature is in this story; verify the cookie HTTP adapter, not unrelated account screens.

## Auto Run Result

Status: blocked
Blocking condition: intent gap / unresolved security and retention contracts.

Corrected `rg --files src` succeeded; no assumed folders were created. The previous HALT record was verified as the only Git change, saved alone in commit `cb9ab980c58127bdbe5ec7b86d329bdf15152e2b` (`docs: record F00-06 investigation halt`), and the working tree was clean. The approved render entrypoint and escalated `git add --refresh -- .` both succeeded. No ACLs changed.

Planning investigation found these gates:

1. PRD §8.2 marks session/proof lifetimes A-09/A-10 as proposed. PRD §13 says OQ-06 must be approved before cross-cutting stories. SOLUTION-DESIGN §9 explicitly includes session/proof/auth library and prohibits readiness when an unresolved gate affects the result.
2. AD-5 requires operation-key retention to cover the approved retry/reconciliation window and be fixed before stories; no approved duration/retention contract was supplied.
3. AD-9 defers token lengths/lifetimes and identity choices. SOLUTION-DESIGN §5 requires the technical auth choice before identity stories; the installed stack has no established session/auth library choice.

Required explicit expiry parameters can avoid hardcoded lifetimes, but do not themselves approve the security/retention contract or waive the explicit architecture gate. No approval was inferred from the request to implement.

Unresolved decisions: approved session/proof security policy and identity-library approach; approved operation-key retention/retry window; whether an explicitly policy-injected, unexposed foundation is authorized before those gates are closed. The unattended planning skill requires HALT rather than selecting among observably different policies.

No implementation or migration was written. No tests, lint, typecheck or build ran. The story acceptance criteria remain unverified. Only this new planning/HALT document changed during the restarted workflow.
