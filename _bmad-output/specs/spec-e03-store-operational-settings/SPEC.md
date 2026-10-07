---
id: SPEC-e03-store-operational-settings
epic: Epic 03
title: "Epic 03 — Store operational settings"
created: 2026-10-07
companions:
  - implementation-requirements.md
  - api-contracts.md
  - acceptance-and-tests.md
  - dependencies-and-migrations.md
  - ../../planning-artifacts/prds/prd-bmadecomm-v2-2026-10-05/prd.md
  - ../../planning-artifacts/architecture/architecture-bmadecomm-2026-10-05/ARCHITECTURE-SPINE.md
  - ../../planning-artifacts/architecture/architecture-bmadecomm-2026-10-05/SOLUTION-DESIGN.md
  - ../../planning-artifacts/ux-designs/ux-bmadecomm-2026-10-05/DESIGN.md
  - ../../planning-artifacts/ux-designs/ux-bmadecomm-2026-10-05/EXPERIENCE.md
  - ../../planning-artifacts/stories/stories-bmadecomm-2026-10-05/stories.md
  - ../../planning-artifacts/epics/epics-bmadecomm-2026-10-05/epics.md
sources: []
---

> **Canonical contract.** This SPEC and its listed companions form the complete implementation specification for Epic 03 (Store operational settings). Downstream implementation, review, and verification passes must consume these files directly. No application code is implemented in this turn.

# Epic 03 — Store Operational Settings

## Why

A production ecommerce store requires verified, authoritative operational configuration to sell goods legitimately: store identity and support contacts for customer trust and legal disclosures, shipping zones and methods to calculate fulfillment feasibility, payment method availability to govern financial checkout flows, and versioned policies (tax, rounding, inventory reservation TTL, low-stock threshold, confirmation mode) to calculate totals deterministically without rewriting historical order records or breaking pending operations. 

Epic 03 establishes this central operational foundation. It guarantees that any subsequent configuration change is strictly forward-looking, that historical financial and fulfillment records remain immutable snapshots, and that administrative modifications are restricted to the authorized Store Owner with an audit trail.

## Capabilities

- **CAP-1 (Store Profile, Locale & Currency Immutability Guard — E03-01):**
  - **intent:** Store Owner configures store metadata (name, legal name, support email, support phone, physical address, logo, default language, currency, timezone, order prefix) while enforcing an absolute lock on currency once any order exists in the system.
  - **success:** Store profile attributes persist and audit cleanly; updating currency after an order exists is rejected by the server with a `409 Conflict` domain error; logo upload utilizes the existing media storage pipeline; store timezone is used for localized presentation without mutating UTC storage timestamps.

- **CAP-2 (Shipping Zones & Eligibility Engine — E03-02):**
  - **intent:** Store Owner configures shipping zones, regional mappings, and shipping methods (standard, express) with flat/zone rates and active status, exposing a server-side eligibility check for checkout and pricing.
  - **success:** Server-side eligibility query (`isEligible(address, methodId)`) returns valid rates or rejects disabled methods and unserviced locations; checkout and cart reject unserviced orders even on direct API submission; modifications do not alter existing order address/shipping snapshots.

- **CAP-3 (Payment Method Enablement & Secret Masking — E03-03):**
  - **intent:** Store Owner enables or disables supported payment methods (COD, Online Gateway) and configures localized customer instructions and order limits without exposing payment gateway secrets or credentials to any client.
  - **success:** Disabled methods are rejected server-side during checkout submission; client and administrative response DTOs contain zero provider credentials or secrets; credentials remain strictly in server environment configuration.

- **CAP-4 (Versioned Financial & Operational Policies — E03-04):**
  - **intent:** Store Owner updates financial (tax mode, tax rate, shipping taxability, rounding) and operational (order confirmation mode, inventory tracking toggle, default low-stock threshold, reservation TTL, COD confirmation timeout) policies through an append-only, versioned policy history.
  - **success:** Every policy modification produces a new immutable policy version row (`version = N + 1`); historical orders and active quotes retain their exact referenced policy version; `currentPolicy()` returns the active latest version; pending operations keep their version without corruption.

## Constraints

- **Strict Store Owner RBAC:** Only the Store Owner role (`owner`) possesses `settings.read` and `settings.manage` permissions (as established in `e02-permission-matrix-proposal.md`). Store Manager, Warehouse, Customer Support, Marketing, and Customer/Guest roles are denied access by default (HTTP 403 Forbidden).
- **Zero Secret Exposure:** Payment gateway keys, webhook secrets, encryption keys, and mail passwords are never stored in settings tables or returned in any settings API DTO, logs, or error responses.
- **Historical Snapshot Immutability (FR-55, AD-4):** Modifying store profile, shipping rates, payment availability, or tax/reservation policies must never retroactively alter existing orders, order item snapshots, tax breakdowns, address snapshots, or completed payment receipts.
- **Currency Lock Invariant (FR-42, AC-19):** Operating currency is locked to `EGP` for MVP launch (Assumption A-01). Once at least one order exists in `orders`, changing the store currency via API or UI is strictly forbidden and rejected at the database/service layer. Multi-currency switching requires an out-of-scope migration path.
- **Standard Modular Monolith Architecture (AD-1, AD-2):** Settings domain code lives as a submodule in `src/modules/content/settings/` (with policy calculation contracts exported to `src/modules/pricing/` and `src/modules/checkout/`). Presentation adapters use Next.js App Router API routes under `/api/v1/admin/settings/*` and public endpoints under `/api/v1/store/settings/*`.
- **Audit Requirement (FR-45, AD-15):** Every settings modification writes an append-only record to `audit_events` within the same database transaction, capturing `actor`, `action`, `resource`, `diff`, and `requestId`.
- **Time Invariant (FR-57, AD-10):** All timestamps are stored in PostgreSQL as UTC `timestamptz` and transmitted in ISO 8601 format. The configured store timezone (`Africa/Cairo` by default) is used strictly for presentation and reporting date-window slicing.

## Non-goals

- General storefront homepage content editor or banner layout composition (owned by Epic 07).
- Executing live online payment transactions, webhooks, or refund processing (owned by Epic 11 and Epic 14).
- Automated carrier API integrations, live tracking sync, or shipping label printing (shipping carriers and tracking numbers are managed manually in Epic 13 per Assumption A-02).
- Multi-currency live conversion or multi-store localization switching in the customer UI (P2 / out of MVP scope).
- Automated customer return requests or customer-facing return portal settings (owned by Epic 24 in P1).
- Setting up new staff members or granting administrative roles from the settings screen (owned by Epic 02, Story E02-03).
- Arbitrary custom permission editing or raw database script execution from the admin UI.

## Success signal

A Store Owner can navigate to `/admin/settings`, view all operational configuration sections, upload a store logo, manage shipping zones and rates, toggle COD and online payment availability, and update tax/reservation policies. When an order is created, attempting to change the store currency is explicitly rejected with a clean domain error. Changing shipping rates or tax percentages generates a new version and an audit event, leaving preexisting orders, active payment attempts, and historical checkout snapshots perfectly intact.

## Assumptions

- **A-01 (Launch Scope — PRD §4.4):** Single B2C store, single warehouse, physical products, Egypt domestic sales, single currency `EGP`, Arabic RTL default, timezone `Africa/Cairo`.
- **A-02 (Methods & Integrations — PRD §4.4):** Cash on Delivery (COD) and one online payment provider; shipping managed via domestic zone rates with manual carrier assignment.
- **A-03 / A-04 (Financial Calculations — PRD §6.1):** Rounding mode is `half-up` to 2 decimal places (`minor_unit = 100`). Tax rate defaults to 14% VAT (Egypt standard) with support for inclusive/exclusive toggle and shipping taxability.
- **A-05 (Operational TTLs — PRD §6.2):** Backorders disabled; online reservation TTL defaults to 15 minutes (900 seconds); COD confirmation window defaults to 24 hours (86,400 seconds).

## Open Questions

- **OQ-01 / OQ-03 (Tax Invoicing & Inclusive/Exclusive Baseline):** The policy schema explicitly supports `tax_mode` (`exclusive` | `inclusive` | `disabled`), `tax_rate_basis_points`, and `tax_shipping`. The specific default for production deployment is resolved as a business configuration gate prior to public launch without altering the data contract.
- **OQ-04 (COD Auto-Cancellation Policy):** Whether unconfirmed COD orders auto-cancel strictly at 24 hours via worker or remain pending with an operator warning is configurable via `cod_confirmation_timeout_seconds` and `order_confirmation_mode`.

