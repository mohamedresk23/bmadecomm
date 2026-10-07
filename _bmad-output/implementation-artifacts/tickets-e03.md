# Implementation Stories — Epic 03: Store Operational Settings

These stories break down the Epic 03 implementation specification into small, independently implementable and testable vertical slices. Each story is sized for a single AI coding session and delivers an end-to-end capability across the database, backend, and frontend layers.

---

## Story: E03-01 — Store Profile, Locale, Logo and Currency Lock

- **Story ID:** `E03-01`
- **Objective:** Enable the Store Owner to configure store branding, support channels, locale, timezone, and order prefix, while enforcing an absolute lock on the operating currency once any order exists to protect historical transactions.
- **Scope:**
  - **Database:**
    - Create `store_settings` table (singleton row with `id = 'default'`).
    - Seed default values: `store_name = 'متجر بيميد'`, `currency = 'EGP'`, `currency_symbol = 'ج.م'`, `currency_exponent = 2`, `timezone = 'Africa/Cairo'`, `default_language = 'ar-EG'`, `order_prefix = 'ORD-'`.
    - Foreign key reference to `media` table for `logo_media_id`.
  - **Backend:**
    - Implement `StoreSettingsService` in `src/modules/content/settings/application/store-settings.ts`.
    - Input validation schema (`StoreProfileUpdateInputSchema`) using Zod.
    - Currency lock invariant: check `EXISTS (SELECT 1 FROM orders)` under row lock; if any order exists and `currency` is altered, reject with `409 Conflict` (`CURRENCY_LOCKED_ORDERS_EXIST`).
    - Audit logging: emit an append-only row to `audit_events` on profile update within the transaction.
    - Endpoints:
      - `GET /api/v1/admin/settings/profile` (Owner only; returns profile and `currency_locked` status).
      - `PUT /api/v1/admin/settings/profile` (Owner only; updates profile).
      - `GET /api/v1/store/settings/public` (Public; returns safe storefront metadata).
  - **Frontend:**
    - Settings shell layout at `/admin/settings` with RTL tabs (Profile, Shipping, Payments, Policies).
    - Profile form at `/admin/settings/profile` with fields for store name, legal entity, support email, phone, physical address, timezone, date format, and order prefix.
    - Currency select input: disabled with lock badge and tooltip ("لا يمكن تغيير العملة بعد تسجيل أول طلب") when orders exist.
    - Logo uploader integrating with existing `F00-07` media upload endpoint (`POST /api/v1/media/upload`) with thumbnail preview.
    - Accessible toast notification and field-level inline error handling.
- **Dependencies:** F00-01 (Skeleton/Next.js), F00-02 (DB migrations/tx), F00-03 (API conventions), F00-04 (RBAC/audit), F00-07 (Media storage), E02-01 & E02-02 (Owner authentication and staff session).
- **Affected Layers:** Frontend, Backend, Database.
- **Acceptance Criteria:**
  - **AC-E03-01-01:** Updating profile fields persists changes in `store_settings` and writes an audit event with actor, action, and before/after diff.
  - **AC-E03-01-02:** Attempting to update `currency` when at least one order exists in `orders` returns `409 Conflict` (`CURRENCY_LOCKED_ORDERS_EXIST`) with zero state change.
  - **AC-E03-01-03:** Updating `currency` when zero orders exist in `orders` succeeds with `200 OK` and updates the setting.
  - **AC-E03-01-04:** Logo upload persists `logo_media_id`; invalid media ID returns `404 Not Found`.
  - **AC-E03-01-05:** Non-Owner staff (Manager, Warehouse, Support, Marketing) and customer/guest sessions receive `403 Forbidden` on admin endpoints.
  - **AC-E03-01-06:** Public endpoint `GET /api/v1/store/settings/public` returns store name, logo URL, currency, support contacts, and timezone without authentication.
- **Test Expectations:**
  - Unit tests for `StoreProfileUpdateInputSchema` validating Egyptian phone format, email, order prefix regex, and boundary lengths.
  - Integration test on isolated PostgreSQL asserting currency update succeeds with 0 orders and fails with 409 Conflict when 1 order is seeded.
  - RBAC integration test asserting 403 Forbidden for non-Owner roles and 401 for unauthenticated requests.
  - Component test for Screen A-13 profile tab verifying form inputs, logo preview, dirty state, and locked currency tooltip.

---

## Story: E03-02 — Shipping Zones, Methods and Eligibility Engine

- **Story ID:** `E03-02`
- **Objective:** Enable the Store Owner to configure domestic shipping zones and methods with rates and transit times, while exposing a server-side eligibility engine that rejects unserviced addresses and inactive methods during checkout.
- **Scope:**
  - **Database:**
    - Create `shipping_zones` table (`id`, `name_ar`, `name_en`, `country_code`, `governorates` JSONB array, `is_active`).
    - Create `shipping_methods` table (`id`, `zone_id`, `name_ar`, `name_en`, `cost_minor`, `estimated_days_min`, `estimated_days_max`, `is_active`).
    - Check constraints: `cost_minor >= 0`, `estimated_days_min <= estimated_days_max`.
    - Seed Egypt baseline zones (Greater Cairo, Alexandria & Delta, Canal & Upper Egypt) and standard/express methods.
  - **Backend:**
    - Implement `ShippingService` in `src/modules/content/settings/application/shipping.ts`.
    - Governorate exclusivity validator: prevent any governorate from being active in more than one zone simultaneously.
    - Server-side eligibility query `isEligible(shippingAddress, methodId)` exported for use by Cart (Epic 09) and Checkout (Epic 10).
    - Audit logging for all zone and method CRUD actions within the mutation transaction.
    - Endpoints:
      - `GET /api/v1/admin/settings/shipping/zones` (Owner only; lists zones, assigned governorates, and methods).
      - `POST /api/v1/admin/settings/shipping/zones` (Owner only; creates a zone).
      - `PUT /api/v1/admin/settings/shipping/zones/{id}` (Owner only; updates a zone).
      - `DELETE /api/v1/admin/settings/shipping/zones/{id}` (Owner only; deletes a zone and its methods).
      - `POST /api/v1/admin/settings/shipping/methods` (Owner only; creates a method for a zone).
      - `PUT /api/v1/admin/settings/shipping/methods/{id}` (Owner only; updates a method).
      - `POST /api/v1/store/shipping/check-eligibility` (Public; checks address eligibility and returns available methods).
  - **Frontend:**
    - Shipping tab at `/admin/settings/shipping`.
    - Zones list showing zone title, count badge of covered governorates, and active status toggle.
    - Zone creation/edit modal with an interactive multi-select checklist of Egypt's 27 governorates; governorates already assigned to other active zones are disabled with an assignment note.
    - Methods table per zone displaying method name, cost formatted in EGP, transit time range, and quick inline toggle for `is_active`.
    - Method creation/edit modal with inputs for name (Ar/En), base rate (EGP), and min/max days.
    - Empty state panel with call-to-action when no zones exist.
- **Dependencies:** E03-01.
- **Affected Layers:** Frontend, Backend, Database.
- **Acceptance Criteria:**
  - **AC-E03-02-01:** Zone and method CRUD operations persist in the database and write corresponding audit events.
  - **AC-E03-02-02:** Attempting to create or update a zone with a governorate already active in another zone is rejected with `422 Unprocessable Entity` (`GOVERNORATE_ALREADY_ASSIGNED`).
  - **AC-E03-02-03:** Address eligibility query for a serviced governorate returns `is_eligible: true` with active methods and minor-unit costs.
  - **AC-E03-02-04:** Address eligibility query for an unserviced governorate returns `is_eligible: false` with localized explanation (AC-11).
  - **AC-E03-02-05:** Updating a shipping method's rate does not modify existing order address snapshots or past order totals (FR-55).
- **Test Expectations:**
  - Unit tests for governorate matching logic and Zod schemas (`estimatedDaysMin <= estimatedDaysMax`, `costMinor >= 0`).
  - Integration tests on PostgreSQL verifying zone creation, governorate conflict rejection, and cascade deletion.
  - Integration test for `isEligible` contract comparing serviced vs unserviced addresses.
  - Component tests for governorate multi-select checklist, method creation modal, and empty state rendering.

---

## Story: E03-03 — Payment Method Enablement & Customer Guidance

- **Story ID:** `E03-03`
- **Objective:** Enable the Store Owner to toggle Cash on Delivery and Online Card payment availability, customize localized customer instructions, and set subtotal thresholds without exposing gateway secrets.
- **Scope:**
  - **Database:**
    - Create `payment_method_configs` table (`id` enum `'cod' | 'online_card'`, `title_ar`, `title_en`, `instructions_ar`, `instructions_en`, `is_enabled`, `min_order_subtotal_minor`, `max_order_subtotal_minor`, `updated_at`, `updated_by`).
    - Seed default rows for `'cod'` (enabled) and `'online_card'` (enabled).
  - **Backend:**
    - Implement `PaymentSettingsService` in `src/modules/content/settings/application/payment-settings.ts`.
    - Query contract exporting only enabled payment methods with customer-facing titles and instructions for Checkout (Epic 10).
    - Strict DTO serialization allowlisting to guarantee zero provider credentials or secrets are returned (FR-59, AD-16).
    - Audit logging for payment method status and configuration updates.
    - Endpoints:
      - `GET /api/v1/admin/settings/payments` (Owner only; lists payment method configs).
      - `PUT /api/v1/admin/settings/payments/{id}` (Owner only; updates toggle, copy, or subtotal thresholds).
  - **Frontend:**
    - Payments tab at `/admin/settings/payments`.
    - Payment method cards for Cash on Delivery and Online Card Payment with master switch toggle (`is_enabled`).
    - Textarea inputs for localized customer checkout instructions (Arabic and English).
    - Numeric inputs for optional minimum and maximum order subtotal thresholds in EGP.
    - Security informational notice explaining that gateway API credentials and webhook keys are securely managed on the server and cannot be edited in the browser.
- **Dependencies:** E03-01.
- **Affected Layers:** Frontend, Backend, Database.
- **Acceptance Criteria:**
  - **AC-E03-03-01:** Toggling payment method status updates `is_enabled` in the database and writes an audit event.
  - **AC-E03-03-02:** Updating instructions and subtotal limits validates inputs and persists values cleanly.
  - **AC-E03-03-03:** All API responses and logs contain zero provider secrets, API keys, or private tokens (FR-59, AD-16).
  - **AC-E03-03-04:** Non-Owner staff receive `403 Forbidden` on payment settings endpoints.
- **Test Expectations:**
  - Unit tests for payment method input schemas validating length constraints and non-negative subtotal bounds.
  - Integration tests verifying that toggling method availability updates the DB and records audit diffs.
  - Response security test asserting the complete absence of secret or credential keys in API responses.
  - Component tests for payment method cards, toggles, instruction textareas, and save actions.

---

## Story: E03-04 — Versioned Financial and Operational Policies

- **Story ID:** `E03-04`
- **Objective:** Enable the Store Owner to maintain financial rules (tax mode, VAT rate, rounding) and operational parameters (order confirmation mode, inventory tracking toggle, low-stock threshold, reservation TTL, COD timeout) via an append-only versioned policy history that guarantees historical order immutability.
- **Scope:**
  - **Database:**
    - Create `operational_policy_versions` table (`id`, `version` unique integer, `tax_mode`, `tax_rate_basis_points`, `tax_shipping`, `rounding_method`, `rounding_minor_unit`, `order_confirmation_mode`, `inventory_tracking_enabled`, `default_low_stock_threshold`, `reservation_ttl_seconds`, `cod_confirmation_timeout_seconds`, `change_reason`, `effective_from`, `created_by`).
    - Add descending index on `version`.
    - Seed baseline policy version 1 (14% VAT exclusive, manual confirmation, 900s reservation TTL, 86400s COD confirmation timeout).
  - **Backend:**
    - Implement `PolicyService` in `src/modules/content/settings/application/policies.ts`.
    - Append-only publication command: assign `version = current_max_version + 1` and `effective_from = now()` inside transaction.
    - Query contracts: `getCurrentPolicy()` returning latest active policy; `getPolicyByVersion(version)` for historical order/quote lookups.
    - Immutability enforcement: block `UPDATE` and `DELETE` queries against policy version rows.
    - Audit logging on new policy version publication.
    - Endpoints:
      - `GET /api/v1/admin/settings/policies/current` (Owner only; returns active policy).
      - `POST /api/v1/admin/settings/policies` (Owner only; publishes new policy version).
      - `GET /api/v1/admin/settings/policies/history` (Owner only; paginated list of past versions).
  - **Frontend:**
    - Policies tab at `/admin/settings/policies`.
    - Active version header badge (`النسخة الحالية: v{version}`).
    - Financial policy card:
      - Tax Mode radio group (`exclusive` [الأسعار لا تشمل الضريبة], `inclusive` [الأسعار شاملة الضريبة], `disabled` [الضريبة معطلة]).
      - Tax Rate percentage input (14.00% default).
      - Tax on Shipping checkbox.
      - Rounding mode display (`half-up`, disabled).
    - Operational policy card:
      - Order Confirmation Mode radio group (`manual` by admin, `auto_on_paid`).
      - Inventory Tracking switch toggle (defaults to Enabled).
      - Default Low-Stock Threshold numeric input (e.g., 5).
      - Online Payment Reservation TTL numeric input in minutes (e.g., 15).
      - COD Confirmation Timeout numeric input in hours (e.g., 24).
      - Optional "سبب التغيير" / Change Reason input.
    - Policy version history drawer/table displaying version numbers, timestamps, author, and change notes.
- **Dependencies:** E03-01.
- **Affected Layers:** Frontend, Backend, Database.
- **Acceptance Criteria:**
  - **AC-E03-04-01:** Publishing updated policies creates a new row with `version = N + 1` and `effective_from = now()`, leaving historical rows intact (AD-4).
  - **AC-E03-04-02:** `getCurrentPolicy()` immediately returns the latest published policy version.
  - **AC-E03-04-03:** `getPolicyByVersion(1)` retrieves original version 1 rules, ensuring historical order totals never experience calculation drift.
  - **AC-E03-04-04:** Attempting to edit or delete an existing policy version directly is blocked.
  - **AC-E03-04-05:** Non-Owner staff receive `403 Forbidden` on all policy endpoints.
- **Test Expectations:**
  - Unit tests for policy input validation schemas (basis points range 0–10000, positive reservation TTLs).
  - Integration tests on PostgreSQL asserting monotonic version increments and historical immutability.
  - Concurrency test simulating simultaneous policy updates to verify no duplicate version numbers are generated.
  - Component tests for Screen A-13 policies tab, form inputs, change reason field, and version history drawer.

