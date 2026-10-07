# Acceptance Criteria & Testing Requirements — Epic 03

## 1. Traceable Acceptance Criteria

### Story E03-01: Store Profile, Locale and Currency Lock

- **AC-E03-01-01 (Profile Persistence & Audit):**
  - **Given** an authenticated Store Owner,
  - **When** updating store profile fields (name, support email, phone, address, timezone, date format, order prefix) via `PUT /api/v1/admin/settings/profile`,
  - **Then** the record in `store_settings` is updated, a `200 OK` response is returned, and an append-only row is written to `audit_events` with `action = "settings.profile.update"`, recording the exact before/after field diff and actor ID.

- **AC-E03-01-02 (Currency Lock Enforced When Orders Exist):**
  - **Given** a database where at least one order exists in `orders`,
  - **When** the Store Owner submits a payload changing `currency` from `EGP` to `USD`,
  - **Then** the request is rejected with `409 Conflict`, error code `CURRENCY_LOCKED_ORDERS_EXIST`, the database state remains unchanged, and an audit event is NOT emitted for currency change.

- **AC-E03-01-03 (Currency Update Permitted When Zero Orders Exist):**
  - **Given** a fresh database where `orders` contains zero rows,
  - **When** the Store Owner modifies the currency during initial setup,
  - **Then** the update succeeds with `200 OK`, `currency` is updated in `store_settings`, and the change is audited.

- **AC-E03-01-04 (Logo Upload via F00-07 Pipeline):**
  - **Given** an image uploaded through the `F00-07` media endpoint yielding a valid `media.id`,
  - **When** the Store Owner attaches `logo_media_id` to the store profile,
  - **Then** the store profile updates, the logo URL resolves properly via public endpoints, and invalid/non-existent `media_id` submissions are rejected with `404 Not Found`.

- **AC-E03-01-05 (Timezone Presentation Invariant):**
  - **Given** store timezone configured as `Africa/Cairo`,
  - **When** timestamps are stored in database tables,
  - **Then** all internal database values remain in UTC `timestamptz`, and frontend/admin representations format the dates into Cairo local time without altering the underlying UTC value.

---

### Story E03-02: Shipping Methods and Zones

- **AC-E03-02-01 (Zone and Method Creation):**
  - **Given** an authenticated Store Owner,
  - **When** creating a shipping zone with name, country `EG`, and governorates `['cairo', 'giza']`, and adding a shipping method with `cost_minor = 5000` (50.00 EGP),
  - **Then** both rows are inserted transactionally, linked by `zone_id`, and audited.

- **AC-E03-02-02 (Exclusive Governorate Assignment):**
  - **Given** an active shipping zone already covering governorate `'cairo'`,
  - **When** a user attempts to create or update another active zone containing `'cairo'`,
  - **Then** the server rejects the request with `422 Unprocessable Entity` and error code `GOVERNORATE_ALREADY_ASSIGNED`.

- **AC-E03-02-03 (Server-Side Eligibility Engine - Serviced Address):**
  - **Given** a customer address with `country_code = 'EG'` and `governorate = 'cairo'`,
  - **When** evaluating shipping eligibility via `isEligible(address)`,
  - **Then** the engine returns `is_eligible: true`, identifies the zone, and lists only `is_active: true` methods with exact minor unit costs.

- **AC-E03-02-04 (Server-Side Eligibility Engine - Unserviced Address / Inactive Method):**
  - **Given** an address in a governorate not covered by any active zone (or a checkout payload with a disabled `method_id`),
  - **When** evaluating shipping or submitting an order (AC-11),
  - **Then** the server returns `is_eligible: false` with a clear localized Arabic rejection reason, and checkout order creation is rejected with `422 Unprocessable Entity`.

- **AC-E03-02-05 (Snapshot Immutability upon Shipping Rate Change):**
  - **Given** an existing order created with shipping rate `50.00 EGP`,
  - **When** the Store Owner modifies the shipping method's rate to `60.00 EGP` in admin settings,
  - **Then** the existing order's `order_address_snapshots` and totals remain strictly `50.00 EGP`.

---

### Story E03-03: Payment Method Enablement

- **AC-E03-03-01 (Enable/Disable Payment Methods):**
  - **Given** an authenticated Store Owner,
  - **When** toggling `is_enabled` on method `cod` or `online_card`,
  - **Then** the record in `payment_method_configs` updates atomically, and the change is audited.

- **AC-E03-03-02 (Rejection of Disabled Payment Methods at Checkout):**
  - **Given** payment method `online_card` has `is_enabled = false`,
  - **When** a shopper attempts to submit checkout with `payment_method = 'online_card'`,
  - **Then** the checkout coordinator rejects the submission with `422 Unprocessable Entity` and error code `PAYMENT_METHOD_DISABLED`.

- **AC-E03-03-03 (Zero Secret Exposure):**
  - **Given** any admin or public request to settings endpoints,
  - **When** inspecting the response headers, body, or application logs,
  - **Then** zero payment provider API keys, webhook signing secrets, merchant IDs, or authentication tokens are returned or logged.

---

### Story E03-04: Versioned Financial and Operational Policies

- **AC-E03-04-01 (Append-Only Policy Versioning):**
  - **Given** an active policy version `1`,
  - **When** the Store Owner posts updated policy settings via `POST /api/v1/admin/settings/policies`,
  - **Then** a new row is created with `version = 2`, `effective_from = now()`, the previous version row remains untouched, and `currentPolicy()` now returns version `2`.

- **AC-E03-04-02 (Immutability of Historical Versions):**
  - **Given** historical policy version `1`,
  - **When** any administrative operation attempts to execute `PUT` or `DELETE` on version `1`,
  - **Then** the database triggers or repository layer reject the mutation, ensuring strict read-only immutability.

- **AC-E03-04-03 (Order Referencing Policy Version):**
  - **Given** an order created when policy version `1` was active,
  - **When** policy version `2` is published with different tax rates,
  - **Then** the historical order continues to link to `policy_version_id = 1`, and recalculation queries retrieve version `1` rules without drift.

---

### Global Acceptance Criteria

- **AC-11 (Shipping & Zone Compliance):**
  - Unserviced delivery regions or disabled shipping methods are strictly rejected by the server during checkout quotes and submission.
- **AC-19 (Settings Boundaries & Draft Scope):**
  - Currency toggle is visually and logically locked once orders exist. No P1 controls (e.g. multi-currency switching, advanced return rules) appear in the settings interface.

---

## 2. Test Matrix & Verification Strategies

### 2.1 Unit Tests (`src/modules/content/settings/`)
1. **Schema Validation Tests (`validation.test.ts`):**
   - Test `StoreProfileUpdateInputSchema` with valid Egyptian phone numbers, invalid emails, negative exponents, and long strings.
   - Test `ShippingMethodInputSchema` asserting `estimatedDaysMin <= estimatedDaysMax` and `costMinor >= 0`.
   - Test `PolicyVersionInputSchema` validating tax modes, basis points boundary (`0` to `10000`), and positive reservation TTLs.
2. **Governorate Matcher Unit Tests (`shipping-matcher.test.ts`):**
   - Assert case-insensitive, normalized governorate code matching against active zones.
   - Assert unserviced governorates return `is_eligible: false`.
3. **Currency Lock Domain Guard (`currency-guard.test.ts`):**
   - Pure function unit test validating currency mutation rules against order existence flags.

### 2.2 Integration Tests (PostgreSQL Test Harness via `F00-02`)
1. **Currency Lock Integration (`currency-lock.integration.test.ts`):**
   - Seed isolated DB with zero orders -> Update currency from `EGP` to `USD` -> Asserts success (200).
   - Insert dummy order row -> Attempt to update currency from `USD` to `EUR` -> Asserts `409 Conflict` and `CURRENCY_LOCKED_ORDERS_EXIST`.
2. **Shipping Zone Exclusivity Integration (`shipping-zones.integration.test.ts`):**
   - Create Zone A with `['cairo', 'giza']`.
   - Attempt to create Zone B with `['cairo', 'alexandria']` -> Asserts rollback and `422 Unprocessable Entity`.
3. **Policy Versioning Integration (`policy-versions.integration.test.ts`):**
   - Read initial version (`version = 1`).
   - Create new policy version -> Asserts new row has `version = 2` and different `id`.
   - Query `currentPolicy()` -> Returns version `2`.
   - Query `getPolicyByVersion(1)` -> Returns version `1` with original values.
4. **Audit Event Verification (`settings-audit.integration.test.ts`):**
   - Perform profile update, zone creation, payment toggle, and policy update.
   - Assert `audit_events` table contains corresponding rows with non-null `actor`, `action`, `resource`, `diff`, and `requestId`.
   - Verify that updates to audit rows fail due to append-only database triggers.

### 2.3 Concurrency & Race Condition Tests
1. **Concurrent Currency Modification vs. Order Placement:**
   - Run two concurrent transactions: Transaction A attempts to change store currency, while Transaction B places the first store order.
   - Verify that row-level locking ensures deterministic serializability: either Transaction A commits before Transaction B starts, or Transaction B commits first and Transaction A is cleanly rejected with `409 Conflict`.
2. **Concurrent Policy Version Creation:**
   - Simulate two simultaneous policy publication requests.
   - Verify that unique version constraints and `FOR UPDATE` locking prevent duplicate version numbers (`version = 2` and `version = 3` are assigned, not two `version = 2` rows).

### 2.4 Authentication & RBAC Tests (`settings-authz.test.ts`)
1. **Store Owner Access:** Valid session with role `owner` successfully accesses all `/api/v1/admin/settings/*` endpoints (200 OK).
2. **Store Manager Denial:** Valid session with role `store_manager` receives 403 Forbidden on all settings endpoints.
3. **Warehouse / Support / Marketing Denial:** Staff sessions with roles `warehouse`, `customer_support`, or `marketing` receive 403 Forbidden.
4. **Customer Session Denial:** Authenticated customer session receives 403 Forbidden.
5. **Anonymous Denial:** Unauthenticated request receives 401 Unauthorized.
6. **CSRF & Origin Verification:** POST/PUT request with missing or mismatched CSRF token receives 403 Forbidden.

### 2.5 Frontend Component & Accessibility Tests (`Screen A-13`)
1. **RTL & Layout Inspection:** Verify container renders `dir="rtl"` with appropriate font and spacing.
2. **Form Interaction & Dirty State:** Change an input, verify "Save Changes" button enables; click discard, verify values reset.
3. **Currency Lock Indicator:** When orders exist, verify currency input is disabled and explanatory badge is rendered.
4. **Toast & Alert Accessibility:** Verify success toast announces to screen readers (`aria-live="polite"`).
5. **Keyboard Navigation:** Tab navigation through all inputs, selects, and action buttons in logical tab order.

