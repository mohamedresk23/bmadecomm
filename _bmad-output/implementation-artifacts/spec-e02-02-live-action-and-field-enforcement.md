---
title: 'E02-02 — Live action and field permission enforcement'
type: feature
created: 2026-10-07
status: draft
route: dispatch
review_loop_iteration: 0
baseline_commit: 8179c2af8b19ae75aab2e500b86571fde1d47ff6
dependency_verified: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/e02-permission-matrix-proposal.md'
  - '{project-root}/_bmad-output/implementation-artifacts/e02-authentication-contract-proposal.md'
  - '{project-root}/_bmad-output/specs/spec-e02-02-permission-enforcement/SPEC.md'
---

<frozen-after-approval reason="explicit user approval of matrix v2/A1 and binding clarifications on 2026-10-07">

## Intent

Use the verified E02-01 staff authentication to enforce approved live action/resource/field permissions on every protected request, provision approved repeatable role grants, redact unknown/nested DTO fields before serialization and remove media mock-header authority. Do not start code before E02-01 verification; approval of matrix and contract is complete, no new approval checkpoint.

## Boundaries & Constraints

Always: DB-derived active staff/MFA session and current role/grant data; union of explicit grants; deny unknown permission/field by default; mandatory global secrets prohibition; committed revoke/disable prevents next request; no cross-request grant cache; refund requires current Owner or Manager AND orders.read AND orders.refund AND resource/domain checks AND password+MFA within last 15 minutes. Removing Manager from refund_operator holder denies next refund even if supplemental role remains. Account/role increases revoke all sessions; reductions remove only applicable live grants.

Never: new staff creation/role editor/last-Owner UI (E02-03), business refund/inventory endpoints, export feature, customer privilege changes, token/secret/error leaks, production reference availability, auth bypass in tests or in x-mock-user/authorization role claims, Owner wildcard bypass, unapproved production provider or unrelated storage refactor. Preserve nested error wrapper and existing media URLs.

## I/O & Edge-Case Matrix

| Scenario | State/input | Expected output | Failure |
|---|---|---|---|
| Allowed | Actual session/live action+resource grants | Explicit permitted DTO leaves only | Safe 200 |
| Revoked | Role/grant/enable state committed on another connection | Next request denied; no business effect | 401/403 |
| Supplemental refund | refund_operator without current Owner/Manager or orders.read/fresh MFA | No refund authorization | Generic 403 |
| Multiple roles | Warehouse+Manager then remove Manager | Manager field grants disappear; remaining legitimate grants persist | No snapshot cache |
| New fields | Unknown top-level/nested/object/array keys or secret keys | Omitted; classified scalars remain | Never serialize DB entities |
| Invalid session | Missing/customer/forged/expired/revoked cookies | No protected result | Generic 401 |
| Spoofed headers | x-mock-user claims Owner with absent/limited actual session | Header ignored; no privilege gain | 401/403 |
| Dependency failure | Authority/permission DB fails | Fail closed, no stale data | Safe sanitized 503/500 |
| Seed rerun | Existing explicit/revoked mappings, repeated seed | Preserve assignments, no duplicates/restored revoked grants | Rollback on failed initial seed |
| Production | Any query/header enabling reference | 404 before authentication/data lookup | Never override NODE_ENV |
| Media | Approved role+real cookie+CSRF/Origin, valid file/ID | Existing resource operation and explicit id/status/url response | Denial before body/file/business effect |

</frozen-after-approval>

## Code Map

- E02-01 staff-auth/session/config/cookie/CSRF services and actual HTTP login: reuse the verified interfaces, never issue test sessions through a mock header. Staff self-security flows are independent of business grant table availability.
- `src/db/schema.ts`: approved staff role definitions/memberships exist; add rolePermissions and an atomic versioned initial-seed marker/reconciliation record. Preserve existing MFA/session state and customer defaults.
- `src/shared/authz/policy.ts`, audit helpers, shared API/error/client: reuse primitives but production context originates solely from staff identity and live grants; generic denial avoids permission/key/value leakage.
- Existing `/api/media/upload`, `/api/media/publish`, `src/components/Upload.tsx`: remove x-mock-user producer/consumer; use actual staff cookie plus CSRF/Origin, preserving URL and MIME/body/media behavior. Tests currently clean whole media directories: isolate synthetic test artifacts, never wipe existing workspace media while adapting them.
- `/api/v1/admin/test-protected`: create only after prerequisite validation; same actual authorization as media, private/no-store. No other business endpoints currently exist, nor any exporter; do not add them.
- PGlite/colocated tests and local PostgreSQL verifier convention: test mocks may replace transport/clock/storage errors, not identity authorization. Live verification must exercise real cookie from password+MFA login, independent committed roles/grants and isolated data.

## Tasks & Acceptance

- [ ] `src/modules/identity/contracts/staff-permissions.ts`, application/infrastructure authorization modules: fixed approved registry with field/action keys, live DB grants, sensitive actions (refunds, role grants, secrets, factor/code changes) and freshness gate. Require refund's base role on every check, not only at supplemental assignment.
- [ ] `src/db/schema.ts`, next sequential migration/metadata, `scripts/seed-permissions.ts`: approved rolePermissions with FKs/unique pairs and transactional once-per-version bootstrap; reruns must not restore deleted role grants or assign user roles. Preserve existing explicit grant changes; no Owner credential output.
- [ ] Explicit typed DTO rules for reference and media, reusable safe nested projector in `src/shared/authz/`: enumerate actual leaf keys per schema, not category-wide true/object pass-through. New/inherited/malformed leaves and unsupported arrays cannot carry secrets. No generic toJSON/db-row serialization. Add serialization tests injecting new and secret fields into every nested position, error responses and preserved authorized fields.
- [ ] `src/app/api/v1/admin/test-protected/route.ts`: approved dev/test GET fixture, current reference.read permission and nested redaction. Proposed actual DTO leaves: reference.id/label; catalog.sku/name/sellingPriceMinor/costMinor; order.reference/state; order.prices.totalMinor/currency; order.payment_status; order.payment_details.method/amountMinor/reference; order.internal_notes; order.items[].sku/name/quantity; customer.name/email/phone/internal_notes; reports.financial.revenueMinor/currency and reports.marketing.visits/conversionRate. Root/container nodes are projected only from these leaves. Labels/public fixture identifiers are harmless synthetic constants; no actual customer/financial module is created. Field groups map exactly to the approved registry.
- [ ] Media HTTP routes/client/tests and optional protected implemented media page: require actual staff session/live media:upload, strict Origin+session CSRF, explicit upload id/status and publish id/url DTOs; absent/forged/limited sessions deny even with x-mock-user. Keep existing image validation and URLs. Client fetches current CSRF/session, removes all mock roles, displays safe deny/expiry/read failure without new global interceptor.
- [ ] E02-01 shell navigation: consume current live grants now, display only existing permitted destinations; security self-service still requires actual staff identity and its own fresh proofs. No inaccessible domain screen or financial placeholder metrics.
- [ ] Colocated policy/seed/persistence/reference/API/client tests and `scripts/verify-local-permissions.ts`: all matrix rows, every approved role, union/removal, refund_operator Manager removal, freshness, known/unknown nested keys, no denied business/file/outbox effects, actual credentials/OTP/cookie, expired/customer/bad cookie, dependency failure, seed replay/rollback, production 404 regardless flags. Verify grant revocation through a second actual PostgreSQL connection and browser/client-media integration where applicable; no public data/credential destruction.
- [ ] `docs/staff-permissions.md`: exact field lists, grants and refund/reauth invariants, seed/migration rollback, no exporter in scope, AC-to-test evidence, production configuration and remaining dependencies.

Acceptance:
- Given committed role/grant revocation/disable, when next protected request uses an old cookie on another app context, then access reflects current state with no business side effect (FR-06/07, AC-13).
- Given refund_operator without current Owner/Manager, when refund permission is checked, then it is denied even if a stored orders.refund grant remains.
- Given approved role combinations, when granting/removing roles, then the union is recalculated and removed field grants never leak through JSON/errors/UI.
- Given a resource with unknown/new or sensitive nested leaves, when serialized, then only explicitly classified authorized scalar leaves/array members are returned, including Owner.
- Given a forged mock header, when media requests run without a real allowed cookie/CSRF, then access fails and nothing is uploaded/published.
- Given production environment, when reference is called with any override flags and otherwise valid authentication, then it is unavailable before data access.
- Given a seed run/replay/failure, when committed/rolled back, then definitions are consistent, existing customer/user-role data preserved and revoked/explicit links not overwritten.

## Implementation Notes

Not dispatched until parent records E02-01 verified. User approval supersedes earlier open policy questions, including stricter refund_operator eligibility and cumulative MFA limits. Parent updates Code Map to final prerequisite symbols before dispatch if needed; no frozen intent change without explicit user renegotiation.

## Spec Change Log

- User-approved continuation resolves all prior questions. KEEP: applied staff history, same nested API envelope and existing media contracts. Avoid known bad: stale role snapshots, unrestricted object projection, recreated MFA budget, Owner secrets DTO, synthetic authentication bypass, supplemental refund without a current qualifying base role.

## Review Triage Log

## Verification

Affected and full Vitest; lint; typecheck; Next production build; actual PostgreSQL migrations/isolated live verification and installed headless browser integration. Review all changed code with workflow reviewers and fix verified findings. Record fresh executed results and every matrix/AC; no claim based solely on previous foundation tests. No commit/push/deploy required.