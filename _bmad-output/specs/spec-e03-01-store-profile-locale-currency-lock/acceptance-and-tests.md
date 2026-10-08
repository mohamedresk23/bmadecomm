# Acceptance, tests and PRD traceability

## Acceptance criteria

| ID | Observable result | Capability |
|---|---|---|
| AC-E03-01-01 | Owner PUT of valid profile persists all supplied writable fields; GET/reload agrees; one accepted mutation increments version and commits a matching redacted audit with actor/action/resource/time/diff/request ID. Audit failure rolls the mutation back. | CAP-1 |
| AC-E03-01-02 | With at least one order of any status, a differently requested currency returns 409 `CURRENCY_LOCKED_ORDERS_EXIST`; profile, version, orders and successful-settings audit count remain unchanged. Same-currency edits succeed. | CAP-3 |
| AC-E03-01-03 | With no orders, launch form offers EGP only; EGP edits succeed and non-EGP returns 422 with no state change. This replaces tickets-e03's alternate-currency success AC-03 per user decision. | CAP-3 |
| AC-E03-01-04 | Owner uploads/references a validated authorized JPEG/PNG/WebP logo and saves its reference; public GET resolves it. Unknown ID returns 404; invalid content/oversize/unauthorized assets are rejected without publishing a new store logo. Null clears it; old asset is not deleted by replacement. | CAP-2 |
| AC-E03-01-05 | No/expired/invalid staff session returns 401; valid Manager/Warehouse/Support/Marketing staff returns 403. Customer credentials never grant staff access. Missing/bad CSRF or disallowed Origin rejects mutations with no effects. Role revocation prevents the next request. | CAP-1/2 |
| AC-E03-01-06 | Unauthenticated public GET returns exactly the documented safe keys, including null logo and compatibility payment array; no actor, legal internals, media ID, CSRF or secrets. | CAP-4 |
| AC-E03-01-07 | Unknown writable keys, invalid timezone, malformed enum/contact/prefix and boundary violations fail safely; omitted full-update fields cannot silently reset persisted locale/currency settings. | CAP-1/3 |
| AC-E03-01-08 | Two Owners editing version N cannot both succeed; first accepted update returns N+1, second receives 409 `STALE_STORE_SETTINGS` without audit/profile change. | CAP-1 |
| AC-E03-01-09 | Profile settings edits do not mutate existing order numbers, money, addresses, policy references, payments or pending attempts. UTC instants stay unchanged across timezone/DST display changes. | CAP-1/3 |
| AC-E03-01-10 | Coordinated first-order/settings concurrency cannot insert an order using configuration that violates the currency guard. Documented shared lock protocol is used by the orders writer; test both interleavings when orders ships. | CAP-3 |
| AC-E03-01-11 | A-13 is usable at 320/768/1024/1440px and by keyboard; loading, dirty state, optional empties, upload/save failure, lock explanation, stale conflict and session expiry follow requirements.md with readable labels/errors and announced results. | CAP-1/2 |
| AC-E03-01-12 | GET cannot seed/mutate missing settings. Missing singleton is an actionable configuration failure. Save timeout is reconciled using GET before retry; no false success. | CAP-1/4 |
| AC-E03-01-13 | Upgrade preserves existing profile, shipping, public DTO and media references; runtime cannot trust `x-mock-user` to authorize upload; rollback retains data/audit. | CAP-2/4 |

## Testing requirements

- **Unit/boundary:** current `store-profile.test.ts` plus schema cases for min/max/one-over lengths, trim/null/empty normalization, Egyptian phone branches, email, prefix, every enum, invalid IANA zone, unknown fields, read-only key injection, missing full-update fields and version bounds. Verify currency domain precedence with 0/1 order and unchanged EGP; schema tests alone cannot prove post-order 409.
- **Real PostgreSQL integration:** singleton/FK/version constraints, transaction rollback on audit failure, 0/1/cancelled order guard, matching before/after audit and request correlation, concurrent stale version writes, populated migration upgrade. PGlite or DB mocks do not count as lock/concurrency evidence. Add shared first-order interleaving test with checkout before the combined feature releases.
- **API/auth integration:** profile GET/PUT and public GET DTO shapes; Owner vs each other role; no/expired/revoked staff session, customer context, bad CSRF/Origin, safe errors, body limits, no-store headers, consistent correlation. Negative requests assert zero profile/audit effects, not just status codes.
- **Media contract/security:** spoofed MIME, corrupt bytes, SVG/HTML, >5MB, missing/unauthorized ID, staged asset, publication/storage failure, replacement and removal. Forged `x-mock-user` alone cannot upload. Failed save preserves prior logo; no storage network operation occurs while settings DB lock is held.
- **Component/browser:** existing profile form tests extended for dirty/save reset, initial failure/retry, busy submission/upload, inline/summary errors, keyboard/touch lock explanation, live announcement, stale refresh and timeout reconciliation. End-to-end Owner save/reload/public read, non-Owner denial, logo replace/clear and expired session.
- **Historical regression:** snapshot existing order/attempt rows and UTC instants, update every applicable setting, assert byte/value preservation; DST boundary formatting test for Cairo and supported zones. Keep existing shipping tests and links passing.
- **Accessibility/manual:** keyboard order, visible focus, label/error associations, RTL with mixed-direction email/phone, no hover-only notice, responsive widths and applicable WCAG 2.2 AA checks. Automated scan alone does not establish acceptance.

During implementation run repository lint/typecheck, relevant Vitest suites and required real PostgreSQL/browser evidence. Record commands, environment, results and AC IDs. No tests were executed or claimed green by this documentation-only run. Pending source/rollout gates preclude claiming implementation or release readiness.

## PRD mapping and source reconciliation

| PRD requirement | Spec coverage | Acceptance |
|---|---|---|
| FR-42 settings | Identity/support/logo/address, language/currency/timezone/date format and future prefix; other FR-42 operational fields owned by E03-02/03/04. | 01–04, 07, 09–11 |
| FR-06; FR-07; §8.1 | Separate staff session, Owner-only settings, live revocation and deny-by-default. | 05, 13 |
| FR-45 | Atomic, append-only, redacted settings audit. | 01, 02, 08 |
| FR-55 | Historical order/payment/snapshot preservation. | 02, 09, 10 |
| FR-57 | Currency scale consistency, UTC instants and durable singleton/version/FK constraints. | 03, 08–10 |
| FR-58 | Strict typed DTOs, validation, safe errors, version guards and API contracts. | 06–08, 12 |
| FR-56; AC-20 | Actual image validation, controlled publication and safe logs. | 04, 13 |
| FR-59 | No provider credentials in settings UI/DTOs; media adapter boundary. | 04, 06, 13 |
| PRD §4.4 A-01; OQ-01 | EGP launch confirmed by user; Arabic/Cairo defaults and remaining locale gates explicitly retained. | 03, 09, 11 |
| NFR-08/09; §9 shared UI | Accessible responsive RTL forms and all meaningful states. | 11, 12 |
| NFR-12/13 | Trusted session/CSRF/Origin, sanitized telemetry, no forged upload identity. | 05, 06, 13 |
| NFR-14 | Additive migration, environment-specific seeds and compatible rollback. | 13 |
| AC-19 | Historical immutability and deferred-control scope only; AC-19 is not a currency-specific PRD acceptance criterion. | 09, 11, 13 |

Architecture bindings: AD-1/2 module ownership; AD-4 snapshots; AD-9 live authorization; AD-10 validation/errors; AD-11 UX; AD-12 caching; AD-14 media; AD-15 audit; AD-16 CSRF/rollout; AD-17 real concurrency tests; consistency convention `expected_version` for shared mutable resources.

UX bindings: EXPERIENCE A-13 and its field matrix, UX-01/06/07/08/09/10/11, State Patterns and form accessibility; DESIGN admin edit/navigation/forms/states. Tax, shipping eligibility and policy histories from wider Epic 03 remain out of this story rather than being attributed to FR-42 profile coverage.

Source precedence: user EGP-only decision supersedes pre-order alternate-currency ticket AC-03 and current six-currency write enum. Current paths supersede nonexistent proposed ticket paths for compatibility. Existing AD-9/API session semantics resolve guest/customer 401 versus the ticket's blanket 403. Shared mutable-resource version protection is a target architectural requirement missing from current implementation. Upstream documents are not edited in this run; consumers must follow these reconciliations when implementing E03-01.
