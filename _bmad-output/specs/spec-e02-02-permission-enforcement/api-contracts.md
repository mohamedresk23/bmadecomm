# Authorization and API contracts

## Existing contracts and unresolved incompatibility

Production APIs use `/api/v1` (AD-10). Current media endpoints use `/api/media/*`; wire their existing consumers safely and decide versioned migration with the contract owner rather than silently renaming them. Keep the same policy on HTTP requests, server-rendered reads and direct application commands.

`src/shared/authz/policy.ts` currently exposes `requirePermission(context, permission)`, `requireOwnership(context, resourceOwnerId)` and `redactFields(object, allowedFields)`. Its context contains caller-provided roles and optional permissions. Preserve reusable enforcement/projection intent, but introduce a trusted server context populated from live identity persistence; production request headers cannot supply that context. The exact application port signature is an implementation decision, not an invented product endpoint.

AD-10 specifies exactly `code`, `message`, `details`, `request_id`. Existing `ApiError.toResponse`, `withErrorHandler` and `ClientApiError` use `{error: {...}}`, with optional details/request ID. On 2026-10-07 the user explicitly approved retaining this existing wrapper for compatibility and documenting the divergence without migrating consumers. Preserve the existing contract; use a safe generic denial and request correlation rather than inventing a new envelope.

## Proposed reference endpoint

The user approved `GET /api/v1/admin/test-protected` for development/test only, inaccessible in production. Use the actual session/live authorization mechanism as protected consumers and approved `admin.reference.read`. Matrix v2 and actual leaf mappings in the build spec are approved; unclassified fields are absent. No refund/inventory/staff/business effect. Production rejects before identity lookup regardless query/body/header flags.

| Contract aspect | Required behavior |
|---|---|
| Input | Staff session from E02-01's approved cookie/session contract; any fixture identifiers runtime-validated |
| Identity | Check active server session, expiry/revocation and account status; reject customer/guest contexts |
| Authorization | Current action/resource grants; unknown permission or absent grant denies |
| Success | 200 with explicitly allowed synthetic fields; restricted fields are omitted, including nested objects/arrays |
| Missing/invalid staff session | 401, safe approved error envelope; no resource details |
| Valid staff session without action permission | 403, safe approved error envelope; no business effect |
| Private resource whose existence must be hidden | 404 according to approved resource contract, after identity/scope checks |
| Malformed shape | 400 using safe field details under existing validation conventions |
| Authority/dependency unavailable | Fail closed; AD-10 specifies 503 for dependency failure; no privileged fallback |
| Internal error | Sanitized 500; no stack trace, DB/provider text or hidden fields |
| Caching | Private/no-store output and no cross-request permission cache |

A valid customer session is not a valid staff session. Its precise 401/403 choice must align with E02-01's authentication contract; existing drafts assert 403 without proving that contract. In all cases administrative data/effects are denied.

## Field and mutation contracts

Read permission for a resource does not imply read permission for every field. Project approved fields before serialization and before passing props to client components. Omitted fields must be absent, not renamed, nulled or leaked through error details, badges, counts or responsive alternatives. Domain contracts must name sensitive fields and allowed projections; cost, internal notes and payment information are examples, not a license to invent universal visibility rules.

For existing cookie-authenticated mutations, retain Origin/CSRF checks in addition to authorization. Reject unknown writable fields, forged actor/role/grant input and mass assignment. Later versioned mutations retain domain `expected_version`/idempotency rules; authorization does not replace financial, ownership, state or audit invariants. No role-management or refund API is introduced in this story. FR-07/45/58; AD-9/10/16.

## Edge cases

- Role removal after a permitted request: after the revocation commits, reuse the same session in the next request and deny. Request-local memoization must not survive into that request.
- Disable/revoke visible on one instance must also affect the next request on another; process-local grant stores cannot establish authority.
- Multiple roles: union current explicit approved grants; all global/account/resource restrictions win. Refund additionally needs current Owner/Manager, orders.read and fresh MFA, even when refund_operator/orders.refund remain after a role removal.
- Unknown permission, missing relation, forged header or untrusted DTO: never allow access.
- Projection through nested objects, arrays, alternate representations and failure responses: no unauthorized values cross the boundary.
- Database lookup fails after a previously successful request: fail closed rather than use the prior decision.
- In-flight revoke: no retroactive cancellation guarantee exists in the sources. Do not mislabel a sequential revoke-then-request test as proof of every concurrency ordering.
