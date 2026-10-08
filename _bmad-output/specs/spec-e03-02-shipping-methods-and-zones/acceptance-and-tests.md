# Acceptance and verification

## Acceptance criteria

| ID | Expected result | Capability |
|---|---|---|
| AC-E03-02-01 | Owner zone/method create, edit, toggle and permitted deletion persist with atomic redacted audit and matching request ID; audit failure rolls back. | CAP-1/2 |
| AC-E03-02-02 | Active overlapping governorate rejected 422 GOVERNORATE_ALREADY_ASSIGNED; own-zone edits work, inactive overlaps allowed, activation revalidates; simultaneous claims cannot both commit. | CAP-1 |
| AC-E03-02-03 | Serviced EG destination returns only active methods in its active zone with exact EGP rate and estimates; a selected eligible ID validates while returned list retains all options. | CAP-3 |
| AC-E03-02-04 | Foreign/unknown/unserviced destination, inactive zone, zero active methods and wrong-zone/disabled/deleted selection return ineligible with localized reason and empty methods; direct checkout cannot bypass it. | CAP-3 |
| AC-E03-02-05 | Editing rate/name/coverage/status leaves every existing order address, shipping name/cost, totals and pending attempt snapshot unchanged. | CAP-1/2/3 |
| AC-E03-02-06 | No/invalid staff session 401, each valid non-Owner staff role 403; customer context cannot authorize admin; revoked role denied next request; invalid CSRF/Origin fails without effects. | CAP-1/2 |
| AC-E03-02-07 | Invalid names/codes/duplicates/country/rates/day bounds/unknown keys/empty edits rejected; one-sided partial day edit validated against persisted opposite bound. | CAP-1/2 |
| AC-E03-02-08 | Two edits of version N yield at most one success; stale update/delete 409 without mutation/audit. Child mutation invalidates a stale parent delete version. | CAP-1/2 |
| AC-E03-02-09 | Unreferenced zone deletion removes unreferenced methods atomically with auditable child effects; referenced resource returns 409 SHIPPING_RESOURCE_IN_USE and can be disabled; no order/quote cascade. | CAP-1/2 |
| AC-E03-02-10 | A-13 shipping UI supports all mutations by keyboard and at target widths; checklist annotation, free cost, modal focus, dirty/error/loading/empty/stale/session states and announced results match requirements. | CAP-1/2 |
| AC-E03-02-11 | Public eligibility is read-only, no-store and exposes no admin CSRF/private fields/address logs; dependency failure is distinct from business ineligibility. | CAP-3 |
| AC-E03-02-12 | Quote/submit revalidation under shared shipping guard cannot accept a concurrently disabled method or silently changed charge; committed orders stay immutable. | CAP-3 |
| AC-E03-02-13 | Exact decimal UI conversion and string target DTO preserve 0, 0.01, 50.10 and upper DB boundary without float rounding/overflow; compatibility upgrade retains existing resources/profile links. | CAP-2 |

AC-01..05 preserve the ticket's core outcomes, with safe deletion and concurrency refinements. AC-04/12 require checkout integration evidence when E10 exists; passing shipping-only tests cannot claim end-to-end AC-11 completion.

## Testing requirements

- Unit/schema: all 27 canonical codes/aliases, Arabic/English matching, trim/case behavior, unsupported country, duplicate/empty/max memberships, name bounds, strict keys, explicit booleans, partial merged ranges, empty edits, invalid IDs and versions. Exact decimal conversion cases include 0.01/50.10, extra fractional digits, exponents, negatives and overflow.
- Real PostgreSQL integration: CHECK/FK/guard/version constraints, transaction audit rollback, concurrent create/activation claiming same governorate, toggle/edit interleavings, stale update/delete, parent-delete vs method-create/update, inactive-overlap activation, referenced deletion, upgrade/backfill. Mock DB or PGlite alone does not prove PostgreSQL locking.
- Eligibility matrix: EG vs foreign with identical governorate, aliases/unknown location, inactive zone, no methods, disabled/wrong-zone/missing selected method, free rate, correct deterministic list and selected method price. Consistent-view test rejects ambiguous active coverage as configuration failure rather than selecting arbitrary first zone if corrupt legacy data remains.
- API/security: Owner and each other staff role, unauthenticated/customer/revoked/expired session, CSRF/provenance failures, DTO/key allowlist, no-store, correlation, body limits, malformed JSON, safe errors. Negative mutation tests assert no state/version/audit changes.
- Component/browser: create/edit/toggle/delete flows, conflict explanation and retained edits, governorate checklist for active vs inactive draft, exact money input, empty-zone/method CTA, load retry vs empty, timeout reconciliation, session expiry, accessible error summary/live status and modal focus restoration. Mobile/RTL mixed-direction text and manual keyboard checks complement automated a11y.
- Downstream integration: seed historical order/attempt snapshots, change all shipping fields and assert unchanged history; final quote/order submit vs disable/rate change and referenced-delete races, with explicit changed-price review and no accepted ineligible order. Requires actual checkout-owned transaction/reference protocol.
- Migration/compatibility: populated upgrade retains IDs/rates/flags, invalid legacy data blocks tightening, all guarded callers participate, numeric adapter compatibility until string migration, missing/stale preconditions reject after rollout, rollback retains audit/data and safe writers.

Implementation should run repository lint/typecheck, relevant Vitest suites and real PostgreSQL/browser checks, recording commands/results and AC mapping. No tests run or application pass claimed during this specification-only task.

## PRD and architecture mapping

| Source | Coverage | Acceptance |
|---|---|---|
| FR-22; AC-11 | Server coverage/selected-method eligibility and no accepted order for unsupported destination/disabled method. | 03, 04, 12 |
| FR-21 | Repair messages preserve checkout inputs; this story owns eligibility query, not full address/checkout validation. | 04, 10, 12 |
| FR-23 | Final authoritative shipping check and snapshot handoff to checkout. | 12 |
| FR-19; AC-05/10 | Exact base shipping amount to pricing; explicit changed-quote review; no client total trust. Tax/allocation calculation remains pricing-owned. | 03, 12, 13 |
| FR-42 | Owner shipping zone/method administration; other profile/payment/policy fields excluded. | 01, 02, 07, 10 |
| FR-06/07; AC-13 | Live Owner permission, no default grants, zero unauthorized effects. | 06 |
| FR-45 | Atomic append-only audited mutations and deletion impacts. | 01, 08, 09 |
| FR-55; AC-19 historical portion | Shipping/address/order/payment snapshot preservation and reference-safe removal. | 05, 09, 12 |
| FR-57 | Consistent money/UTC time and constrained durable configuration. | 02, 07, 08, 13 |
| FR-58 | Strict contracts, stale errors, list/permissions/amount/time semantics and compatibility plan. | 07, 08, 11, 13 |
| PRD §4.4 A-01/A-02; OQ-02/04 | Domestic flat-zone model, inherited EGP launch, manual carrier operation and explicit production coverage gate. | 03, 04 |
| NFR-08/09; §9 | Accessible RTL/responsive forms, states and keyboard/dialog behavior. | 10 |
| NFR-12/13/14 | Auth/CSRF, safe DTO/logs, environment-specific configuration and additive rollback. | 06, 11, 13 |

AD-1/2 govern settings ownership and application contracts; AD-3 integration lock order; AD-4 snapshots/exact string money; AD-9 authorization; AD-10 validation/stale/error conventions; AD-11/12 UI/cache; AD-15 audit/correlation; AD-16 rollout/security; AD-17 real concurrency evidence; AD-18 unresolved business gates. Mutable-resource version convention binds update/delete.

UX references: EXPERIENCE A-13/field matrix and State Patterns, UX-01/06/07/08/09/10; DESIGN admin edit/forms/navigation/status patterns. Current project's epic-3-context and tickets-e03 define governorate checklist and method builder. No P1 or carrier UI introduced. Upstream process wrappers/review ceremony excluded; relevant business claims are preserved in these four companions and adopted source documents.
