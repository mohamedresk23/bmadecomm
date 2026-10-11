---
title: 'E03-03-01: Payment Method Schema, Admin API & Optimistic Concurrency'
type: 'feature'
created: '2026-10-11'
status: 'done'
baseline_commit: 'da677e9bc8245201dc06b8ddb4b8c1b7f34b2678'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-e03-03-payment-method-enablement/SPEC.md'
  - '{project-root}/_bmad-output/implementation-artifacts/tickets-e03-03.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The store lacks a dedicated database persistence model, optimistic concurrency controls, and secure Store Owner administration endpoints for payment method configurations (`cod` and `online_card`), risking race conditions and credential leaks.

**Approach:** Add additive migration `0012_payment_method_configs` with baseline seeds and rollback support, export strict Zod contracts and `PaymentSettingsService` with optimistic row locking (`expected_version`) and atomic audit trail, and expose authenticated Owner endpoints at `/api/v1/admin/settings/payments`.

## Boundaries & Constraints

**Always:**
- Persist configurations in `payment_method_configs` with strictly positive versions (`version > 0`) and check constraint `min <= max`.
- Require live Store Owner session (`requireOwnerSession`) plus CSRF and Origin checks on mutations; return 401 for anonymous and 403 for non-owners.
- Verify `expected_version` under row lock (`FOR UPDATE`); reject stale updates with 409 `STALE_PAYMENT_METHOD_CONFIG`.
- Write atomic append-only audit log (`payment_method_config.updated`) with actor, diff, and correlation ID within the same transaction; rollback changes if audit fails.
- Exclude all payment provider secrets, gateway credentials, and tokens from DTOs, schemas, audits, and logs.
- Return `Cache-Control: private, no-store` on all admin endpoints.

**Never:**
- Allow creating new payment method rows or deleting existing baseline rows (`cod` and `online_card` are immutable registry IDs).
- Allow modifying currency or scale (fixed to `EGP` with exponent 2).
- Trust client-provided `is_ready` or gateway credentials in request payloads (strict allowlist rejection with 422).
- Mutate historical order payment snapshots or alter pending payment attempts when configs are updated.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Owner lists payment methods | GET `/api/v1/admin/settings/payments` with valid Owner session | 200 OK with `{ success: true, methods: PaymentMethodConfig[], csrf }` | 401 Unauthorized if unauthenticated; 403 Forbidden if non-Owner |
| Owner updates method config | PUT `/api/v1/admin/settings/payments/cod` with valid CSRF & matching `expected_version` | 200 OK with updated method and `version = N + 1`; audit row recorded | 422 on invalid schema or empty edit |
| Stale update attempt | PUT with `expected_version: 1` when stored row is at `version: 2` | 409 Conflict with code `STALE_PAYMENT_METHOD_CONFIG` | Zero DB mutation or audit record |
| Subtotal bounds out of range | PUT with `min_order_subtotal_minor: "5000"`, `max_order_subtotal_minor: "1000"` | 422 Unprocessable Entity (`min <= max` violated) | Informative error details returned |
| Forbidden keys in payload | PUT containing `secret_key`, `apiKey`, or unknown fields | 422 Unprocessable Entity (strict allowlist rejection) | Prevent secret pollution |
| Both methods disabled | PUT toggling `is_enabled: false` on the second method | 200 OK with committed disabled state | Permitted by design; UI warns downstream |
| Rollback migration | Execute rollback of migration 0012 | Clean drop of `payment_method_configs` table | Restore previous schema state |

</frozen-after-approval>

## Code Map

- `src/db/migrations/0012_payment_method_configs.sql` -- Additive schema definition and baseline seeds for `cod` and `online_card`
- `src/db/migrations/0012_payment_method_configs.down.sql` -- Idempotent drop table rollback script
- `src/db/migrations/meta/_journal.json` -- Migration journal index 12 registration
- `src/db/schema.ts` -- Drizzle ORM table definition for `paymentMethodConfigs`
- `src/modules/content/settings/contracts/payment-settings.ts` -- Zod schemas for DTOs, input validation, and readiness mapping
- `src/modules/content/settings/contracts/payment-settings.test.ts` -- Unit tests for validation rules and allowlist guards
- `src/modules/content/settings/application/payment-settings.ts` -- Application service implementing `listConfiguredMethods` and `updatePaymentMethodConfig` with `FOR UPDATE` lock and audit logging
- `src/app/api/v1/admin/settings/payments/route.ts` -- GET endpoint returning payment configs and CSRF token
- `src/app/api/v1/admin/settings/payments/[id]/route.ts` -- PUT endpoint handling validated updates with optimistic concurrency
- `src/app/api/v1/admin/settings/payments/route.test.ts` -- Route integration tests covering RBAC, CSRF, validation, optimistic locking, and secret exclusion
- `src/db/migrate.test.ts` -- Migration up/down integration tests updated to include 0012

## Tasks & Acceptance

**Execution:**
- [x] `src/db/migrations/0012_payment_method_configs.sql` -- Create migration with table definition and seed rows -- Deliver persistence model
- [x] `src/db/migrations/0012_payment_method_configs.down.sql` -- Create rollback script -- Support safe down migrations
- [x] `src/db/migrations/meta/_journal.json` -- Register index 12 entry -- Ensure migration runner tracks 0012
- [x] `src/db/schema.ts` -- Add `paymentMethodConfigs` table definition -- Provide typed Drizzle access
- [x] `src/modules/content/settings/contracts/payment-settings.ts` -- Define Zod schemas and DTO types -- Enforce strict validation and allowlists
- [x] `src/modules/content/settings/contracts/payment-settings.test.ts` -- Add comprehensive contract unit tests -- Verify bound checking and secret rejection
- [x] `src/modules/content/settings/application/payment-settings.ts` -- Implement `PaymentSettingsService` -- Provide business logic, row locking, and atomic audit
- [x] `src/app/api/v1/admin/settings/payments/route.ts` -- Implement GET route handler -- Serve Owner payment configs and CSRF token
- [x] `src/app/api/v1/admin/settings/payments/[id]/route.ts` -- Implement PUT route handler -- Execute authenticated update with concurrency guard
- [x] `src/app/api/v1/admin/settings/payments/route.test.ts` -- Create integration test suite -- Verify RBAC, 409 conflict, 422 validation, and security invariants
- [x] `src/db/migrate.test.ts` -- Update migration test suite -- Verify up/down idempotency including migration 0012

**Acceptance Criteria:**
- Given migration 0012 is registered, when `runMigrations()` is called on a clean database, then `payment_method_configs` exists and contains seeded `cod` and `online_card` records with `version = 1`.
- Given migration 0012 has been applied, when `rollbackMigration({ steps: 1 })` is executed, then `payment_method_configs` is safely dropped without affecting prior tables.
- Given an authenticated Store Owner, when GET `/api/v1/admin/settings/payments` is requested, then 200 OK is returned with exactly 2 methods and a valid CSRF token, with no secrets leaked.
- Given non-Owner staff or unauthenticated requests, when payment settings endpoints are queried, then 403 Forbidden or 401 Unauthorized is returned.
- Given a valid PUT payload with matching `expected_version`, when updating a payment method config, then the record is updated, `version` increments to $N+1$, and an audit event is atomically recorded.
- Given a PUT payload with a mismatched `expected_version`, when attempting an update, then 409 Conflict with error code `STALE_PAYMENT_METHOD_CONFIG` is returned and no DB changes occur.
- Given an invalid PUT payload (e.g. unknown keys, invalid bounds `min > max`, credentials), then 422 Unprocessable Entity is returned.

## Implementation Notes

- Added migration `0012_payment_method_configs.sql` with table check constraints for IDs (`cod`, `online_card`), non-negative minor subtotals, min <= max, positive version, and title/instructions length bounds. Seeded default rows for COD and Online Card.
- Added companion rollback script `0012_payment_method_configs.down.sql` dropping table cleanly.
- Updated `src/db/migrations/meta/_journal.json` registering index 12.
- Added typed Drizzle schema `paymentMethodConfigs` in `src/db/schema.ts`.
- Created Zod validation contracts in `src/modules/content/settings/contracts/payment-settings.ts`.
- Implemented `PaymentSettingsService` in `src/modules/content/settings/application/payment-settings.ts` supporting `listConfiguredMethods` and `updatePaymentMethodConfig` with `SELECT ... FOR UPDATE` row locks, version increments, and atomic append-only audit logging.
- Created Next.js route handlers `src/app/api/v1/admin/settings/payments/route.ts` and `[id]/route.ts` with Owner authentication (`requireOwnerSession`), Origin, and CSRF protection.
- Updated `src/db/migrate.test.ts` to test up/down migration idempotency and rollback for 0012.
- Updated `src/test-utils/db.test.ts` to skip pool connection isolation tests when running in PGlite mode (`it.skipIf(!isPostgresTest)`).

## Spec Change Log

## Review Triage Log

- `patch` | Verification Gap: Missing integration test verifying transactional rollback when writeAudit fails during update. Added route test mocking writeAudit error and asserting row and version remain unchanged in DB.
- `patch` | Verification Gap: Missing route integration test for clearing subtotal bounds to null and persisting "0". Added route test updating existing bounds to null and updating to "0", verifying persistence and distinct formatting.
- `patch` | Blind Hunter: Empty update payload refinement has no path on issue. Added path: ["payload"] to the Zod refinement for empty updates.
- `patch` | Blind Hunter: row.updatedAt.toISOString() assumes Date instance. Updated mapPaymentMethodConfigDto to use new Date(row.updatedAt).toISOString() defensively.
- `patch` | Blind Hunter: Missing length check constraints on titles and instructions in DB schema. Added check constraints: length(title_ar) >= 2 AND length(title_ar) <= 100, length(title_en) >= 2 AND length(title_en) <= 100, length(instructions_ar) <= 2000, length(instructions_en) <= 2000 in migration 0012 and schema.ts.
- `false` | Blind Hunter: Empty zero-byte diff file committed to git. Diff was never committed and is 95KB.
- `false` | Blind Hunter: Route handlers use defaultReadinessProvider which hardcodes online_card to is_ready: false. Explicit requirement per AD-16 / OQ-PAY-01 that seeds alone do not authorize production payment acceptance until gateway operations are approved.
- `false` | Blind Hunter: Neither GET nor PUT includes x-correlation-id header on success (200 OK). Consistent with existing project routes (correlation ID is passed in error envelopes via withErrorHandler).
- `false` | Blind Hunter: Empty required documentation sections in spec file. Populated during step-04 and step-05 per workflow lifecycle.
- `false` | Blind Hunter: deferred-work.md entries list source_spec: none. Prescribed format by step-01 template.
- `false` | Blind Hunter: writeAudit diff serializes entire entity snapshots before/after. Follows existing project audit conventions established in store-settings.ts.
- `false` | Blind Hunter: requireOwnerSession passes when Origin header is null. Standard CSRF protection in admin-auth.ts from E03-01; Origin validated if present, and CSRF token checked unconditionally.
- `false` | Blind Hunter: Duplicated validation of payment method identifiers. Defensive check at both route and service boundaries.

## Verification

**Commands:**
- `npm test src/modules/content/settings/contracts/payment-settings.test.ts` -- expected: All contract unit tests pass
- `npm test src/app/api/v1/admin/settings/payments/route.test.ts` -- expected: All route integration tests pass
- `npm test src/db/migrate.test.ts` -- expected: Migration up/down tests pass including 0012
- `npm run lint` -- expected: Zero lint errors
- `npm run typecheck` -- expected: Zero TypeScript errors
- `npm run build` -- expected: Clean production build
