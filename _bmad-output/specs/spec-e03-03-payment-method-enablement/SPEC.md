---
id: SPEC-e03-03-payment-method-enablement
story: E03-03
epic: E03
created: 2026-10-08
companions:
  - requirements.md
  - api-contracts.md
  - acceptance-and-tests.md
  - brownfield.md
  - ../spec-e03-01-store-profile-locale-currency-lock/SPEC.md
  - ../../planning-artifacts/prds/prd-bmadecomm-v2-2026-10-05/prd.md
  - ../../planning-artifacts/architecture/architecture-bmadecomm-2026-10-05/ARCHITECTURE-SPINE.md
  - ../../planning-artifacts/architecture/architecture-bmadecomm-2026-10-05/SOLUTION-DESIGN.md
  - ../../planning-artifacts/ux-designs/ux-bmadecomm-2026-10-05/DESIGN.md
  - ../../planning-artifacts/ux-designs/ux-bmadecomm-2026-10-05/EXPERIENCE.md
  - ../../implementation-artifacts/epic-3-context.md
sources: []
---

# E03-03 — Payment method enablement and customer guidance

This kernel and its companions are the implementation contract derived from the canonical memory log and cited sources. E03-03 is a story within Epic 03. This run produces documentation only; it does not enable payments, implement application code or execute migrations.

## Why

Give the Store Owner control over which approved payment methods customers can use, their explanatory copy and subtotal eligibility, without exposing gateway credentials or disrupting existing orders and pending payment attempts.

## Capabilities

- **CAP-1**
  - **intent:** The Owner enables/disables COD and online card payment and edits localized titles, instructions and subtotal limits.
  - **success:** Valid edits persist with version protection and atomic audit; unauthorized, invalid and stale requests leave configuration unchanged.
- **CAP-2**
  - **intent:** Customers and checkout obtain safe, currently available payment choices consistent with store configuration and operational readiness.
  - **success:** Disabled/unready methods are unavailable for new checkout; authoritative subtotal bounds are applied server-side at quote/submission, including concurrent settings changes.
- **CAP-3**
  - **intent:** The system preserves prior financial activity while isolating provider credentials from settings.
  - **success:** Configuration edits never rewrite orders/attempts or stop pending reconciliation; settings DTOs, logs, errors and client bundles contain no provider/session secrets.

## Constraints

- Fixed `cod` and `online_card` registry, one approved online provider at launch; no custom methods or credentials UI (PRD A-02; FR-25/42/59).
- EGP only, inherited from the user's E03-01 decision; exact integer minor units with string JSON amounts and UTC timestamps (AD-4/10).
- Only a live Owner staff session has settings read/manage; mutation requires trusted CSRF/Origin checks (FR-06/07; AD-9/16).
- `content/settings` owns configuration, pricing owns Subtotal, payments owns readiness/attempts; adapters consume typed contracts, not duplicate domain rules (AD-1/2).
- Every accepted change has a transactional redacted append-only audit and one request correlation ID; admin responses are private/no-store (FR-45; AD-12/15).
- Enablement does not establish provider readiness or mark a payment Paid; existing attempt state remains authoritative (FR-24/25/55).

## Non-goals

- Charge initiation, card collection, redirects, callbacks, provider SDKs, refunds or reconciliation implementation (E11/E14).
- COD collection, confirmation/expiry policies, pricing/tax calculations, shipping or staff administration.
- Wallet, bank transfer, pickup, extra gateways, multi-currency or customer currency/language switchers.

## Success signal

An Owner changes a payment method and reloads its committed audited values. Public metadata remains safe, and server checkout eligibility excludes disabled/unready or out-of-range methods while existing orders and pending attempts remain intact.

## Assumptions

- Both methods may be disabled; show an explicit no-payment warning rather than inventing a mandatory enabled-method rule.
- Thresholds use PRD §6.1 Subtotal (effective item price × quantity, before coupon/shipping and separate tax addition), with inclusive limits. Plain-text instructions and validation lengths are proposed implementation constraints.
- Ticket seeds may mark both rows configured-enabled, but deployment readiness stays false until method operations are approved; seeds alone do not authorize production payment acceptance.

## Open Questions

- **OQ-PAY-01:** Approve COD/online launch operation, provider/readiness contract, customer copy and production bounds (PRD OQ-02/04). No gateway is chosen here.
- **OQ-PAY-02:** Define whether a new attempt on an existing failed order is allowed after disable/bound changes. Existing attempts, reconciliation and same-operation replay remain protected; E11 must resolve new-attempt eligibility before release.
