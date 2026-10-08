---
id: SPEC-e03-02-shipping-methods-and-zones
story: E03-02
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

# E03-02 — Shipping methods and zones

This kernel and listed companions form the implementation contract derived from the canonical memory log and project sources. E03-02 is a story in Epic 03; code already exists and must be reconciled against this contract. Documentation only; no code or migrations executed.

## Why

Let the Store Owner define domestic delivery coverage, prices and transit estimates so customers receive truthful shipping options and checkout cannot accept an unserviced location or disabled method. Administrative changes must preserve financial history and concurrent configuration integrity.

## Capabilities

- **CAP-1**
  - **intent:** The Owner creates, edits, activates, disables and safely removes delivery zones covering Egyptian governorates.
  - **success:** Active coverage is unique per governorate, including concurrent edits; accepted mutations have atomic audit records and stale edits are rejected.
- **CAP-2**
  - **intent:** The Owner maintains shipping methods, EGP rates and transit estimates for each zone.
  - **success:** Valid rates and ranges persist; disabled methods are unavailable for new orders; removal retains referenced records and historical snapshots remain unchanged.
- **CAP-3**
  - **intent:** Customers and server consumers obtain delivery eligibility and available methods for a destination and optionally a selected method.
  - **success:** Only active methods in the unique active EG zone qualify; foreign/unserviced destinations and invalid selections are rejected for checkout, with clear recovery messages.

## Constraints

- Owner-only live staff authorization, CSRF/Origin protection on mutations, explicit DTOs and no-store administrative responses (FR-06/07/58; AD-9/10/16).
- Settings are owned by `content/settings`; pricing/cart/checkout use its application contract, not duplicate database rules (AD-1/2).
- EGP only at launch, inherited from the user's E03-01 decision; exact integer minor units, UTC timestamps and immutable order/payment snapshots (FR-42/55/57; AD-4).
- Coverage changes, reference-sensitive deletion and final eligibility decisions share a serialization protocol; version guards reject stale writes.
- Every accepted mutation and its redacted append-only audit commit together with one request correlation ID (FR-45; AD-15).

## Non-goals

- Carrier APIs, labels, tracking synchronization, shipment execution or delivery guarantees.
- International shipping, pickup, weight/product-based rates, free-shipping coupon calculation, same-day service or postcode polygons.
- Payment enablement, financial policies, staff management or implementing cart/checkout/order creation in this story.

## Success signal

An Owner edits zones and methods and reloads the persisted audited configuration; a guest receives correct methods and EGP costs. Duplicate active coverage, stale writes, foreign/unserviced destinations and disabled selections fail safely. Existing orders retain their original shipping details and amounts.

## Assumptions

- Use Egypt's existing 27-code governorate catalog and domestic governorate-based flat rates. City/postcode are optional query context, not eligibility criteria until an approved policy requires them.
- Preserve current bilingual admin names and query-tab navigation. Seed coverage, rates and estimates are development examples, not approved production terms.

## Open Questions

- **OQ-SHIP-01:** Approve production governorate coverage, methods, rates and estimates, and whether any service needs city/postcode rules. Until then do not launch existing all-Egypt seeds as actual service promises.
- **OQ-SHIP-02:** Confirm rollout for string money DTOs and required version guards across existing numeric/no-version clients. Final target behavior is specified; compatibility enforcement requires consumer coordination.
