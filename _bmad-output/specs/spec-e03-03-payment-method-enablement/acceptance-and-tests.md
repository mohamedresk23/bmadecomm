# Acceptance, testing and PRD traceability

## Acceptance criteria

| ID | Observable result | Capability |
|---|---|---|
| AC-E03-03-01 | Owner toggle persists configured is_enabled, increments version and writes actor/action/resource/time/safe diff/request ID in same transaction; audit failure rolls update back. | CAP-1 |
| AC-E03-03-02 | Valid localized copy and nullable subtotal bounds persist; min/max inclusive and merged partial validation correct; null and zero remain distinct. | CAP-1/2 |
| AC-E03-03-03 | Allowlisted admin/public/checkout DTOs, errors, audit/logs and client bundle contain no provider/session credentials or private tokens; credential field injection rejected without raw-body logging. | CAP-3 |
| AC-E03-03-04 | Valid non-Owner staff receives 403; no/expired/invalid staff context 401; customers cannot authorize admin. Bad CSRF/Origin and revoked role reject next mutation with zero effects. | CAP-1 |
| AC-E03-03-05 | Disabled or unready method excluded from effective public/checkout options; configured-enabled online without approved provider remains not ready and cannot accept new orders. | CAP-2 |
| AC-E03-03-06 | Lower/upper subtotal equality allowed; one minor unit outside bound rejected. Compare pricing Subtotal, not discounted total/shipping or client-submitted value; EGP scale mismatch rejected. | CAP-2 |
| AC-E03-03-07 | Two writes based on version N yield at most one success; second 409 STALE_PAYMENT_METHOD_CONFIG with no change/audit. Missing version and unknown/empty/read-only fields 422. | CAP-1 |
| AC-E03-03-08 | Concurrent disable/bound edit vs new order submit serializes selected-method eligibility through snapshot: old valid commit or rejected new selection, never accepted disabled selection after winning disable. | CAP-2 |
| AC-E03-03-09 | Updating any config does not change prior order/attempt snapshots or stop pending status/webhook/reconciliation. Same-operation replay returns original result without new charge; new-attempt retry policy remains explicit gate. | CAP-3 |
| AC-E03-03-10 | Both-disabled save allowed with warning; shopper sees no eligible choices rather than a forced method. Genuine empty result differs from DB outage/missing registry. | CAP-1/2 |
| AC-E03-03-11 | Payments tab/cards support Arabic RTL, keyboard and target mobile widths, clear readiness/secret notice, exact price entry, dirty/loading/validation/stale/timeout/session states and announced server-confirmed success. | CAP-1 |
| AC-E03-03-12 | Public settings retains existing profile keys and id/title/optional-instructions payment metadata shape, maps locale safely, returns no-store and exposes no admin fields/basket authorization. | CAP-2/3 |
| AC-E03-03-13 | Registered additive migration provisions two rows without altering profile/shipping/audit, seed rerun does not overwrite Owner edits, compatible rollback preserves all config/financial data. | CAP-1/3 |

AC-01..04 preserve authored tickets; AC-05/08/09 need downstream checkout/payment evidence before combined acceptance. No E03-03-only test may claim full FR-25 payment execution or refund behavior.

## Testing requirements

- **Unit/schema:** fixed IDs; title/instruction min/max/one-over; whitespace/empty instructions; null vs zero bounds; strict unknown/credential/read-only rejection; partial min/max merged against persisted values; equal bounds; positive versions. Exact EGP input conversion cases 0, 0.01, 50.10, upper integer range; reject exponent/extra fraction/negative/overflow and numeric JSON for bounds.
- **Eligibility matrix:** enabled × readiness × inclusive subtotal range × EGP scale; pricing subtotal unaffected by coupon/shipping; unknown ID, empty effective list, Arabic/English/fallback text, public no-context metadata versus full quote eligibility. Unconfigured is a safe state; dependency outage is an error.
- **Real PostgreSQL:** table PK/enum/nonnegative/range/version constraints; atomic audit rollback; stale concurrent update; serialization of selected config and snapshot creation; repeated migrations/provisioning and populated upgrade. Mock DB/PGlite alone does not prove locks. Use synthetic isolated order fixtures only as tests until actual checkout schema exists; combined evidence must use real downstream writer.
- **API/auth:** Owner and each non-Owner role, absent/customer/expired/revoked staff context, missing/bad CSRF/provenance, malformed/oversize bodies, 404 unknown ID, safe 409/422/errors, no-store, correlation continuity and exact DTO allowlist. Negative mutations assert zero config/version/audit effects.
- **Security sentinel:** inject fake credential fields/sensitive row properties/readiness debug values and verify DTO projection/error/audit/log output excludes them; rejected secret-key payload not logged raw. Inspect client imports/build artifacts for server secret dependencies. Copy renders as escaped text, never executable markup.
- **UI/browser:** toggle draft then save, copy/bounds errors, clear bound versus zero, both-disabled warning, not-ready notice, dirty navigation, fetch failure/retry, missing registry, stale refresh/reapply, timeout GET reconciliation and session expiry. Manual keyboard/RTL/dialog/focus/labels/status checks at 320/768/1024/1440 widths complement automated a11y.
- **Downstream integration:** direct new submit with disabled/unready/out-of-range method rejects before durable order/reservation/attempt; quote options change with config; disable/submit interleavings; prior snapshots byte/value preservation; reconciliation and idempotent replay continue without duplicate charge after disable. E11 owns new-attempt policy tests after OQ-PAY-02 resolution.
- **Migration regression:** existing profile/shipping UI/API still work; public placeholder becomes safe dynamic array without schema break; rollback revision cannot silently keep checkout enabled without readiness/contract. Audit data retained.

During implementation run lint/typecheck, focused unit/API/component suites and required real PostgreSQL/browser evidence. Record commands, environment, results and AC IDs. No application tests ran or passes claimed in this documentation-only task.

## PRD mapping

| Requirement | Coverage / boundary | Acceptance |
|---|---|---|
| FR-42 | Owner payment enablement, copy and method config; profile/shipping/policy controls outside this story. | 01, 02, 10, 11 |
| FR-25; PRD A-02/OQ-02 | Supported approved online method/readiness only; no provider choice, charge, redirect or Paid transition implemented. | 05, 08, 09 |
| FR-26; OQ-04 | COD option configuration; collection/confirmation remain downstream, disabling does not change old COD payment state. | 05, 09, 10 |
| FR-19; §6.1 | Authoritative Subtotal and EGP exact threshold comparison; pricing/tax computation not settings-owned. | 02, 06 |
| FR-21/23 | Current eligible options and final submit guard; input preserved after eligibility loss. | 05, 08, 11 |
| FR-24/27; AC-06/07 | Existing attempt/replay/reconciliation protected after disable, without duplicating execution. Full webhook/retry implementation belongs E11. | 09 |
| FR-06/07; AC-13 | Owner-only live settings access, deny by default and no unauthorized effects. | 04 |
| FR-45 | Transactional append-only redacted settings audit. | 01, 07 |
| FR-55; FR-42 historical rule | Order/attempt/config snapshot preservation across setting changes. | 09 |
| FR-57/58 | UTC, exact amount DTOs, version guards, strict validation and safe contracts. | 02, 06, 07, 12 |
| FR-59; NFR-12/13 | Credentials stay server-only; allowlisted DTOs, safe readiness, CSRF and log minimization. | 03, 04, 12 |
| NFR-08/09; §9 | Accessible responsive RTL forms and recoverable states. | 11 |
| NFR-14 | Additive environment-specific configuration and compatible rollback. | 13 |

Architecture: AD-1/2 module ownership; AD-3 checkout lock integration; AD-4 exact money/snapshots; AD-5 replay boundary; AD-6 provider separation; AD-9 auth; AD-10 validation/error/version; AD-11/12 states/cache; AD-15 audit; AD-16 secrets/CSRF/rollout; AD-17 real concurrency tests; AD-18 business gates. Resource version does not replace immutable financial-policy snapshots.

UX: EXPERIENCE A-13 and payment fields in S-05, UX-01/04/06/07/08/09/10, State Patterns and form accessibility; DESIGN admin forms/navigation/status/RTL. Ticket titles/instructions/bounds are retained; `/admin/settings/payments` proposal adapts to current query-tab convention. Gateway example brands and both-enabled seeds do not override provider approval. Process-only wrappers and unrelated shipping/tax story payloads are excluded; relevant source claims preserved across this kernel and four companions.
