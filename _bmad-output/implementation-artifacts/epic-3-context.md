# Epic 3 Context: Store Operational Settings

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Provide the Store Owner with authoritative control over the store's operational, fulfillment, payment, and financial parameters without corrupting historical orders, altering prior price snapshots, or breaking in-flight checkout attempts.

## Stories

- **Story E03-01:** Store profile, locale and currency lock
- **Story E03-02:** Shipping methods and zones
- **Story E03-03:** Payment method enablement
- **Story E03-04:** Versioned financial and operational policies

## Requirements & Constraints

1. **Owner-Only Administration:** Only the Store Owner (`owner` role) has `settings.read` and `settings.manage` permissions. Other roles receive HTTP 403 Forbidden.
2. **Permanent Currency Lock:** Currency is set to `EGP` for MVP launch (Assumption A-01). Once at least one order exists in `orders`, changing the currency is strictly rejected with HTTP 409 Conflict (`CURRENCY_LOCKED_ORDERS_EXIST`).
3. **Historical Snapshot Immutability:** Modifying shipping costs, payment availability, or tax policies does not alter preexisting orders, addresses, or completed payments (FR-55, AD-4).
4. **Append-Only Policy Versions:** Editing financial (tax mode, rate, rounding) or operational (confirmation mode, inventory tracking, reservation TTL, low-stock threshold) policies creates a new immutable version row (`version = N + 1`). Historical orders retain references to their creation-time `policy_version_id`.
5. **Zero Secret Leakage:** Payment gateway API credentials, merchant secrets, and webhook tokens are strictly isolated to server environment variables and never exposed in settings DTOs or client UI (FR-59, AD-16).
6. **Server-Side Shipping Eligibility:** Unserviced delivery locations or disabled shipping methods are rejected server-side during checkout quote and submission (FR-22, AC-11).
7. **Append-Only Audit Logging:** All mutations write an `audit_events` row inside the transaction with actor, action, resource, diff, and request correlation ID (FR-45, AD-15).

## Technical Decisions

- **Architecture:** Modular monolith submodule inside `src/modules/content/settings/` with typed application contracts exported to `pricing` and `checkout` (AD-1, AD-2).
- **Database Schema:** Additive migration introducing `store_settings`, `shipping_zones`, `shipping_methods`, `payment_method_configs`, and `operational_policy_versions`.
- **Money Representation:** Integer minor units (`cost_minor`, `rounding_minor_unit = 100`) avoiding binary floating-point inaccuracies.
- **Time Invariant:** UTC `timestamptz` storage; store timezone (`Africa/Cairo`) applied solely for display and reporting date grouping (FR-57).
- **Media Pipeline:** Store logo upload utilizes the existing `F00-07` media foundation (`media` table, MIME validation, 5MB ceiling).

## UX & Interaction Patterns (Screen A-13)

- **Layout:** Accessible admin view with 4 clean tabs/sections: Profile, Shipping, Payments, Policies.
- **RTL & Accessibility:** Native `dir="rtl"` layout, high-contrast states, keyboard navigation, and `role="status"` toast announcements.
- **Currency Lock Indicator:** When orders exist, the currency dropdown is visually locked with an explanatory badge and tooltip.
- **Zone & Method Builder:** Visual multi-select checklist for Egypt's 27 governorates, preventing duplicate governorate assignments across zones.
- **Payment Method Cards:** Toggles for COD and Card Gateway, with clear notices explaining that credentials are server-configured.
- **Policy History:** Dedicated view displaying past policy versions and timestamps.

## Cross-Story Dependencies

- **Preceding:** F00-01 (Skeleton), F00-02 (DB migrations/tx), F00-03 (API conventions), F00-04 (RBAC/audit), F00-07 (Media storage), Epic 02 (Owner authentication and staff session).
- **Succeeding:** Epic 04 (Catalog), Epic 05 (Inventory control), Epic 08 (Pricing engine), Epic 09 (Cart), Epic 10 (Checkout & COD creation).

