---
id: SPEC-e03-01-store-profile-locale-currency-lock
story: E03-01
epic: E03
created: 2026-10-08
companions:
  - requirements.md
  - api-contracts.md
  - acceptance-and-tests.md
  - brownfield.md
  - ../../planning-artifacts/prds/prd-bmadecomm-v2-2026-10-05/prd.md
  - ../../planning-artifacts/architecture/architecture-bmadecomm-2026-10-05/ARCHITECTURE-SPINE.md
  - ../../planning-artifacts/architecture/architecture-bmadecomm-2026-10-05/SOLUTION-DESIGN.md
  - ../../planning-artifacts/ux-designs/ux-bmadecomm-2026-10-05/DESIGN.md
  - ../../planning-artifacts/ux-designs/ux-bmadecomm-2026-10-05/EXPERIENCE.md
  - ../../implementation-artifacts/epic-3-context.md
sources: []
---

# E03-01 — Store profile, locale, logo and currency lock

This kernel and its companions define the implementation contract, derived from the canonical memory log and cited sources. E03-01 is a story within Epic 03. Existing implementation is context, not proof of acceptance. This run produces documentation only.

## Why

Give the Store Owner authoritative control over store identity, customer support details and presentation settings, while publishing safe storefront metadata and preventing configuration changes from rewriting financial history. The user confirmed EGP as the only launch currency on 2026-10-08.

## Capabilities

- **CAP-1**
  - **intent:** The Owner configures store identity, support contacts, locale, timezone, date format and the prefix used for future order numbers.
  - **success:** Valid changes persist with an atomic audit event; invalid, unauthorized and stale writes leave the profile unchanged, and the UI confirms only committed results.
- **CAP-2**
  - **intent:** The Owner uploads, selects, replaces or clears the store logo.
  - **success:** Only authorized, content-validated images become the public logo; failed uploads or profile saves retain the current reference.
- **CAP-3**
  - **intent:** The system preserves the launch currency and protects historical orders against currency changes.
  - **success:** EGP is the sole launch option; a different currency is rejected before trading and returns `409 CURRENCY_LOCKED_ORDERS_EXIST` once any order exists, including concurrent first-order creation.
- **CAP-4**
  - **intent:** Visitors obtain safe store identity and presentation metadata without authentication.
  - **success:** Public reads reflect committed settings and expose only the explicit public DTO, without staff identity, CSRF tokens or private configuration.

## Constraints

- Owner-only `settings.read`/`settings.manage`, live staff authorization and cookie mutation CSRF/Origin checks apply on the server (FR-06/07; AD-9/16).
- Settings remain owned by `content/settings`; HTTP and UI consume typed contracts, not database entities (AD-1/2/10).
- EGP symbol and exponent are server-derived. Existing orders, snapshots, payments and pending attempts never change with a profile edit (FR-42/55/57; AD-4).
- Timestamps remain UTC instants; timezone/date format affect presentation and reporting boundaries only (FR-57).
- Successful mutations and redacted append-only audit records commit together; admin data is private/no-store (FR-45; AD-12/15).
- Strict writable-field schemas, image content validation and stale-write rejection are mandatory; rollout details are in the companions (AD-10/14/17).

## Non-goals

- Shipping configuration, payment enablement and policy version management (E03-02/03/04).
- Customer language/currency switchers, currency conversion, multi-store operation or post-order currency migration.
- Homepage composition, staff administration, provider credentials, tax calculation or checkout/order implementation.

## Success signal

An authenticated Owner saves the profile and logo, reloads the committed values and sees the matching audit record; a visitor reads the safe metadata. Non-Owners, invalid images, non-EGP currencies, stale writes and post-order currency changes fail without a profile mutation or historical change.

## Assumptions

- `ar-EG`, `Africa/Cairo`, `YYYY-MM-DD` and `ORD-` remain the initial presentation defaults. Existing locale/date enum values remain readable; this does not authorize an English storefront release.
- Keep the current query-tab route and existing DTO shapes during migration; add version fields through a coordinated rollout.

## Open Questions

- **OQ-01:** Approve the editable locale/timezone allowlists and actual production store/legal/support values. Existing seed identity is development data.
- **OQ-02:** Confirm the `expected_version` rollout for any older PUT consumers before enforcing omission rejection. Target concurrency behavior and tests are specified; rollout remains a compatibility gate.
