---
title: 'E01-01 — Customer registration with verification email'
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

**Problem:** Visitors have no registration surface, account persistence, or verification-email issuance. E01-01 requires a registration form and backend that create an unverified customer and enqueue a verification email atomically.

**Approach:** Reuse the database transactions, validated API DTOs, safe error envelope, durable outbox, and email adapter. Add identity-owned registration persistence and application logic, a versioned HTTP adapter, and an accessible form after the prerequisite proof/security contracts are resolved.

## Boundaries & Constraints

**Always:** Require name, normalized email, phone, and password; enforce email uniqueness in the database; assign only the customer role; return the same public response for new and existing email; commit user, verification proof, and email event together; use an approved password hash and purpose-scoped, expiring proof; follow installed Next.js guides and colocated-test conventions.

**Never:** Infer policy approval from an implementation request; grant staff privileges from input; call an email provider inside a transaction; log credentials or verification secrets; implement verification consumption, login, reset, guest-order claiming, or other stories.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| New registration | Valid required fields; unused normalized email | One unverified customer, hashed password, verification proof, and email outbox event | Generic completion response |
| Duplicate or concurrent registration | Same normalized email | No second user or initial email event; unchanged public completion response | No account enumeration |
| Invalid input | Missing/invalid required fields or privileged fields | Safe field feedback; no identity writes | Existing API validation envelope |
| Transaction failure | Proof or email enqueue fails | No user, proof, or email event committed | Safe recoverable error |
| Form submission | Valid data submitted in browser | Disabled pending submission; generic completion or recoverable errors; preserve non-sensitive fields | Accessible feedback |

</intent-contract>

## Code Map

- `src/db/schema.ts` — contains audit, outbox, job attempts, notification deliveries, and media; no users, sessions, or proof_tokens.
- `src/db/tx.ts` — `DbContext` and `withTransaction` support shared transactions/savepoints.
- `src/db/migrations/meta/_journal.json` — existing migrations stop at 0004; no identity migration.
- `src/shared/api/validation.ts` — `validateRequest` maps Zod errors to field details.
- `src/shared/api/errors.ts`, `error-handler.ts`, `client.ts` — existing API envelope and client field-error mapping. The generic error handler logs unknown exceptions; identity adapters must avoid exposing secrets through logs.
- `src/shared/outbox/enqueue.ts` — transactional enqueue with durable deduplication key.
- `src/shared/outbox/worker.ts` — leased processing and bounded retries.
- `src/shared/email/send-handler.ts`, `adapter.ts` — idempotent email delivery; sandbox is the only implemented provider.
- `src/test-utils/db.ts` — migrations and isolated transaction test helpers; NODE_ENV=test uses PGlite rather than external PostgreSQL.
- `src/components/Upload.test.tsx` — colocated jsdom/Testing Library convention; no reusable account form exists.
- `package.json` — Zod/Drizzle/Postgres/Vitest installed; no identity/password-hashing library and no test script.
- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`, `05-server-and-client-components.md` — read for route placement and server/client boundary.
- `_bmad-output/implementation-artifacts/spec-f00-06-idempotency-keys-sessions-and-proof-tokens-2.md` — prerequisite is blocked on security/retention contracts; no proof primitives implemented.

## Tasks & Acceptance

**Execution:** Proposed file map; not ready for development until the gates below close.
- `src/db/schema.ts`, `src/db/migrations/0005_customer_registration.sql`, migration metadata — add normalized-email uniqueness, customer state, approved credential storage, and agreed proof representation.
- `src/modules/identity/contracts/registration.ts` — strict shared DTO for the four required fields and approved limits.
- `src/modules/identity/application/register.ts` — define registration use case against identity/password/proof/email ports.
- `src/modules/identity/infrastructure/registration.ts` — compose approved hashing/proof primitives with transactional persistence and existing enqueue helper.
- `src/app/api/v1/auth/register/route.ts` — validated, bounded, rate-limited HTTP adapter with generic new/duplicate response and private cache behavior.
- `src/components/RegistrationForm.tsx`, `src/app/register/page.tsx` — labeled fields, pending state, field feedback, generic completion, and recoverable failure handling through ApiClient.
- Colocated registration application/API/form `.test.ts` and `.test.tsx` files — verify the matrix, privilege rejection, rollback, and frontend/backend contract; real PostgreSQL concurrency verification is required in addition to the existing PGlite harness.

**Acceptance Criteria:**
- Given valid registration data, when the endpoint succeeds, then exactly one unverified customer with customer role only and an approved password hash is stored.
- Given an existing normalized email, when registration repeats or races, then the public response matches success and no second account is created.
- Given a new account transaction, when it commits, then the verification email is enqueued in that same transaction; a failure rolls back the account and proof too.
- Given the registration page, when input is invalid or submission fails, then accessible field/error feedback appears and no false success is shown.

## Spec Change Log

## Review Triage Log

## Verification

- `node node_modules/vitest/vitest.mjs run <registration test paths>` — relevant API/application/form tests pass.
- `npm run lint`, `npm run typecheck`, `npm run build` — successful checks after implementation.
- Real PostgreSQL concurrent registrations and rollback assertions — normalized-email constraint and transaction correctness.
- Frontend calls the actual registration endpoint and worker dispatches the resulting verification email through the configured adapter.

## Auto Run Result

Status: blocked
Blocking condition: intent gap / unresolved identity security contracts and missing F00-06 dependency.

Git was clean and index refresh succeeded using official escalation. Cached Epic 1 context is newer than planning sources. Current code and E01-01 acceptance criteria were inspected. No previous E01 story exists for continuity.

The story explicitly requires an approved hash and lists F00-06 as a prerequisite. SOLUTION-DESIGN §5 requires identity-library selection and authentication/proof/rate-limit contracts before identity stories. PRD §8.2 labels password length and verification lifetime A-09 assumptions; §13 keeps OQ-06 unresolved. The P0 dependency spec retains OQ-06 as a cross-cutting-auth/readiness gate. No adoption record was found. F00-06 remains blocked and its proof-token implementation is absent. Sandbox email infrastructure is reusable, but real delivery still needs an approved/configured provider. OQ-05 governs production retention/residency; no production-readiness claim is possible while it remains open.

Unresolved inputs: approved password-hashing/identity approach, password limits, proof issuance/security/expiry contract, shared rate-limit policy, and completion or explicit scoped replacement of the F00-06 proof prerequisite. The S-09/S-10 numbering conflict is outside E01-01; use S-08 registration and flow names without extending this story.

The skill's planning instruction requires HALT on an intent gap. No application code or package dependencies were changed. Tests, lint, typecheck, build, acceptance execution, and frontend/backend integration verification were not run; all acceptance criteria remain unverified. Only this planning/HALT spec was added and the existing E01-01 run-result report was updated.
