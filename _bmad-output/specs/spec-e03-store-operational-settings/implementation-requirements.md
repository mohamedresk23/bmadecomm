# Implementation Requirements — Epic 03: Store Operational Settings

## 1. Objective

Epic 03 establishes the single source of truth for the store's operational, locale, fulfillment, payment, and financial parameters. Its core architectural mandate is to allow authorized administrators (Store Owner) to adjust operational rules dynamically while guaranteeing that historical orders, financial totals, customer address snapshots, and active checkout flows remain strictly immutable and uncorrupted.

---

## 2. Scope

Epic 03 is decomposed into four discrete, vertical capability stories:

### 2.1 E03-01: Store Profile, Locale and Currency Lock
- **Store Identity & Support:** Store public name, legal entity name, support email, support phone, physical warehouse/office address, and order prefix (e.g., `ORD-`).
- **Store Logo:** Upload, update, and preview store logo utilizing the established `F00-07` media foundation (`media` table, MIME validation, file size limit ≤ 5MB).
- **Locale & Timezone:** Default language (`ar-EG` default), store timezone (`Africa/Cairo` default per Assumption A-01), and date format (`YYYY-MM-DD` / localized Arabic display).
- **Currency Configuration:** Operating currency (`EGP` default), currency symbol (`ج.م` / `EGP`), minor unit exponent (`2`).
- **Currency Lock Guard:** Server-enforced domain invariant blocking any change to `currency` if any row exists in the `orders` table.

### 2.2 E03-02: Shipping Methods and Zones
- **Shipping Zones Management:** CRUD operations for geographical zones (e.g., "Greater Cairo", "Alexandria & Canal", "Delta", "Upper Egypt", "Remote Regions").
- **Regional Mapping:** Assigning country codes (ISO 3166-1 alpha-2, default `EG`) and governorates/governorate codes to zones. A governorate cannot belong to more than one active zone simultaneously.
- **Shipping Methods:** CRUD operations for shipping methods (e.g., "Standard Delivery", "Express Delivery") attached to zones.
- **Rate & Time Parameters:** Flat rate or zone-based shipping cost (stored as integer minor units `cost_minor`), estimated delivery time window (min days, max days), and active status toggle (`is_active`).
- **Eligibility Engine Contract:** Server-side evaluation `isEligible(shippingAddress, methodId)` exported for use by Cart (Epic 09), Pricing/Quote (Epic 08), and Checkout (Epic 10). Rejects disabled methods or unserviced governorates with explicit failure reasons.

### 2.3 E03-03: Payment Method Enablement
- **Payment Method Registry:** Management of supported payment methods:
  - Cash on Delivery (`cod`)
  - Online Card / Gateway (`online_card`)
- **Method Configuration:** Enable/disable toggles (`is_enabled`), customer-facing localized titles (`title_ar`, `title_en`), customer checkout instructions/notes, and optional minimum/maximum order subtotal bounds.
- **Checkout Read Contract:** Returns only active, enabled payment methods with customer-safe descriptions.
- **Secret Isolation:** Provider credentials, API keys, and webhook secrets are strictly externalized to server environment variables and never managed, stored, or exposed via this settings module.

### 2.4 E03-04: Versioned Financial and Operational Policies
- **Policy Versioning Core:** An append-only historical table (`operational_policy_versions`) tracking immutable policy snapshots identified by auto-incrementing integer version numbers (`version`) and timestamps (`effective_from`).
- **Financial Policy Parameters:**
  - `tax_mode`: Enum (`exclusive` | `inclusive` | `disabled`).
  - `tax_rate_basis_points`: Integer (e.g., 1400 for 14.00% VAT).
  - `tax_shipping`: Boolean indicating whether shipping cost is subject to sales tax.
  - `rounding_method`: String enum (`half_up` standard per Assumption A-04).
  - `rounding_minor_unit`: Integer (100 for 2 decimal places).
- **Operational & Inventory Policy Parameters:**
  - `order_confirmation_mode`: Enum (`manual` by admin vs `auto_on_paid`).
  - `inventory_tracking_enabled`: Global boolean flag (defaults to `true` per FR-42).
  - `default_low_stock_threshold`: Default integer quantity trigger for low-stock alerts (e.g., `5`).
  - `reservation_ttl_seconds`: Expiration window for unpaid online payment checkout holds (defaults to `900` seconds / 15 minutes per Assumption A-05).
  - `cod_confirmation_timeout_seconds`: Operational window for staff to confirm COD orders before cancellation risk (defaults to `86400` seconds / 24 hours).
- **Public & Internal Read Contracts:** `currentPolicy()` returns the active latest version; `getPolicyById(id)` provides historical policy lookups for orders, quotes, and audit inspections.

---

## 3. Out of Scope

- **Homepage Content / Layout Management:** Editing homepage banners, featured categories, or carousel slides belongs to Epic 07 (Homepage content publishing).
- **Executing Gateway Transactions & Webhooks:** Managing online payment tokens, initiating charges, handling webhooks, and processing refunds belong to Epic 11 (Online payment) and Epic 14 (Refunds).
- **Carrier API Integrations:** Direct carrier dispatch, webhook updates, and live barcode printing (carriers and tracking numbers are handled manually in Epic 13 per Assumption A-02).
- **Multi-Currency Live Switching / Multi-Store:** Dynamic currency exchange rates, multi-store tenancy, and multi-country tax compliance engines are P2 additions.
- **Administrative Role & Staff Management:** Creating staff accounts and assigning roles belong to Epic 02 (Stories E02-01 and E02-03).
- **Customer Return Request Policies:** Automated customer-facing return workflows belong to Epic 24 (P1).

---

## 4. Business Rules & Domain Invariants

1. **Owner-Only Administrative Access (FR-06, FR-07, §8.1):**
   - Only staff identities with the `owner` role may read or write operational settings.
   - All other staff roles (`store_manager`, `warehouse`, `customer_support`, `marketing`) and customer/guest sessions receive an immediate HTTP 403 Forbidden on `/api/v1/admin/settings/*`.
2. **Permanent Currency Lock Invariant (FR-42, AD-4, AC-19):**
   - If `SELECT EXISTS(SELECT 1 FROM orders)` evaluates to `true`, any attempt to alter `currency` in `store_settings` is permanently rejected with domain error `CURRENCY_LOCKED_ORDERS_EXIST` (HTTP 409 Conflict).
   - Changing the store operating currency after initial order creation requires an offline database migration and accounting recalculation outside the scope of MVP.
3. **Historical Snapshot Immutability (FR-55, AD-4):**
   - Edits to store profile, shipping costs, or policy rules do not cascade to existing rows in `orders`, `order_items`, or `order_address_snapshots`.
   - Each order records its exact snapshot of shipping method name, shipping fee, tax breakdown, and references the specific `policy_version_id` active at creation time.
4. **Append-Only Policy Versioning (AD-4, AC-11):**
   - Updating any financial or operational policy creates a brand-new row in `operational_policy_versions` with `version = current_version + 1`.
   - Existing policy rows are immutable; no `UPDATE` or `DELETE` statements are ever executed against historical policy versions.
5. **Zero Secret Leakage Invariant (FR-59, AD-16):**
   - No payment gateway API keys, merchant identifiers, webhook signing secrets, or SMTP passwords can be stored in the settings tables.
   - Any API response originating from the settings module must pass through an allowlist DTO filter that strips unexpected or sensitive keys.
6. **Shipping Zone Exclusivity & Server-Side Enforcement (FR-22, AC-11):**
   - A governorate/region cannot be assigned to more than one active shipping zone.
   - Shipping eligibility must be verified by the server on every checkout quote and order submission. If a user selects a shipping method that is inactive, or provides an address outside all configured zones, the submission is rejected with HTTP 422 Unprocessable Entity.
7. **Transactional Audit Logging (FR-45, AD-15):**
   - Every mutation in `store_settings`, `shipping_zones`, `shipping_methods`, `payment_method_configs`, and `operational_policy_versions` must write an `audit_events` row inside the exact same database transaction, capturing `actor`, `action`, `resource`, `diff` (sanitized before/after JSON), and `requestId`.

---

## 5. Frontend Requirements (Screen A-13: Store Settings)

Screen A-13 is an administrative view situated within the protected admin layout (`/admin/settings`).

### 5.1 Layout & Navigation Structure
- **Container & Layout:** Standard responsive admin shell (`dir="rtl"` by default) with an accessible tabbed interface or vertical navigation sub-menu dividing the settings into 4 clean sections:
  1. **Store Profile & Identity (`/admin/settings/profile`)**
  2. **Shipping & Delivery (`/admin/settings/shipping`)**
  3. **Payment Methods (`/admin/settings/payments`)**
  4. **Financial & Operational Policies (`/admin/settings/policies`)**
- **Page Header:** Page title ("إعدادات المتجر" / "Store Settings"), contextual subtitle, and primary actions (e.g., "حفظ التغييرات" / "Save Changes") with loading indicators.

### 5.2 Section Specifications

#### 5.2.1 Section 1: Store Profile & Identity (E03-01)
- **Form Fields:**
  - Store Name (Input, required, max 100 chars, Arabic/English).
  - Legal Entity Name (Input, optional, max 150 chars).
  - Support Email (Input, email type, required).
  - Support Phone (Input, tel type, required, Egyptian mobile/landline format).
  - Physical Address (Textarea, required, max 300 chars).
  - Order Number Prefix (Input, required, e.g. `ORD-`, uppercase alphanumeric + hyphen, 2–10 chars).
  - Default Language (Select dropdown: `ar-EG` default, `en-US`).
  - Store Timezone (Select dropdown: `Africa/Cairo` default).
  - Date Format (Select dropdown: `YYYY-MM-DD`, `DD/MM/YYYY`).
  - Store Currency (Select dropdown: `EGP`).
    - *Currency Lock UI State:* If orders exist, the currency select is disabled with an explanatory tooltip and lock badge ("لا يمكن تغيير العملة بعد تسجيل أول طلب في المتجر" / "Currency cannot be modified once orders exist").
- **Logo Uploader:**
  - Displays current store logo preview.
  - "تغيير الشعار" / "Upload Logo" button integrating with `F00-07` media upload endpoint (`POST /api/v1/media/upload`).
  - Supports image drag-and-drop, showing upload progress, thumbnail preview, file size check (≤ 5MB), and removal option.

#### 5.2.2 Section 2: Shipping & Delivery (E03-02)
- **Zones & Methods Overview:**
  - List of configured shipping zones with badge indicators for total assigned governorates and active methods.
  - "إضافة منطقة شحن" / "Add Shipping Zone" button triggering a modal or dedicated drawer.
- **Zone Editor:**
  - Zone Name (Arabic & English inputs, e.g., "القاهرة الكبرى / Greater Cairo").
  - Governorate Selector: Multi-select checklist of Egypt governorates (27 governorates: Cairo, Giza, Alexandria, Qalyubia, etc.). Selected governorates show tags; governorates already assigned to other zones are disabled with a label indicating their current assignment.
- **Shipping Method List / Form:**
  - Table showing methods per zone (Name, Cost in EGP, Estimated Transit Days, Status Toggle).
  - Quick inline toggle for `is_active`.
  - Method Edit Modal: Method Title (Arabic/English), Base Rate (Numeric input, minimum 0.00), Transit Min Days, Transit Max Days.

#### 5.2.3 Section 3: Payment Methods (E03-03)
- **Method Cards:**
  - Card for **Cash on Delivery (COD)**:
    - Master toggle: Enabled / Disabled.
    - Localized Title (Arabic / English).
    - Customer Instructions textarea (e.g., "الدفع نقدًا عند استلام الطلب من مندوب التوصيل").
    - Optional Min / Max Order Amount inputs.
  - Card for **Online Card Payment (Paymob / Gateway)**:
    - Master toggle: Enabled / Disabled.
    - Localized Title (Arabic / English).
    - Customer Instructions textarea (e.g., "الدفع الآمن عبر البطاقات الائتمانية والخصم المباشر").
    - Status badge: "مزود الدفع مهيأ على الخادم" / "Server Gateway Configured".
    - Security Notice: Explicit text stating that API keys and gateway secrets are securely managed on the server and cannot be edited in the browser.

#### 5.2.4 Section 4: Policies & Financial Rules (E03-04)
- **Active Policy Card:**
  - Version Badge: "النسخة الحالية: v{version}" with timestamp of activation.
- **Financial Controls:**
  - Tax Mode (Radio group: `exclusive` [الأسعار لا تشمل الضريبة], `inclusive` [الأسعار شاملة الضريبة], `disabled` [الضريبة معطلة]).
  - Tax Rate (Numeric input with `%` suffix, e.g. 14.00%).
  - Tax on Shipping (Checkbox: "تطبيق الضريبة على رسوم الشحن").
  - Rounding Mode (Disabled select displaying "Half-Up (أقرب قرش)").
- **Operational Controls:**
  - Order Confirmation Mode (Radio group: `manual` [تأكيد يدوي من الإدارة], `auto_on_paid` [تأكيد تلقائي فور نجاح الدفع الإلكتروني]).
  - Inventory Tracking (Switch toggle: Enabled / Disabled, default Enabled).
  - Default Low-Stock Threshold (Numeric input, e.g. 5 units).
  - Online Payment Reservation TTL (Numeric input in minutes, e.g. 15 minutes).
  - COD Confirmation Timeout (Numeric input in hours, e.g. 24 hours).
- **History Viewer:**
  - Expandable drawer or table showing previous policy versions (`v1`, `v2`, ...), timestamp, author, and changed values.

### 5.3 UX States & Feedback
- **Loading State:** Skeleton loaders for form inputs and table rows during initial fetch.
- **Unsaved Changes Notice:** Floating bar or sticky footer prompting the user to save changes or discard when dirty fields exist.
- **Success State:** Toast notification ("تم حفظ الإعدادات بنجاح" / "Settings saved successfully") using accessible live region (`role="status"`).
- **Error State:** Field-level inline errors with red border and descriptive helper text; top-level banner for submission failures.
- **Empty States:** When no shipping zones are configured, render an informative `StatePanel` with an illustration and primary CTA ("إضافة أول منطقة شحن").

---

## 6. Backend Requirements

### 6.1 Modular Placement & Layering
In compliance with `AD-1` and `AD-2`:
- Domain and application services reside in `src/modules/content/settings/`:
  - `src/modules/content/settings/contracts/`: DTOs, Zod schemas, interface types.
  - `src/modules/content/settings/application/`: Application services (`StoreSettingsService`, `ShippingService`, `PaymentSettingsService`, `PolicyService`).
  - `src/modules/content/settings/infrastructure/`: Drizzle repositories and DB query helpers.
- Next.js App Router HTTP Adapters:
  - `src/app/api/v1/admin/settings/*`: Protected administrative route handlers.
  - `src/app/api/v1/store/settings/*`: Public storefront read-only route handlers.

### 6.2 Transactional & Audit Flow
Every mutating application command follows this execution pattern:
1. Authenticate staff session; ensure `user.role === 'owner'` (or permissions include `settings.manage`).
2. Validate incoming request body with Zod schema.
3. Open a database transaction via `tx.transaction()`.
4. Perform state validation and invariants (e.g. currency lock check against `orders`).
5. Execute database writes (upsert settings, insert new policy version, update shipping methods).
6. Emit `audit_events` row atomically in the same transaction with diff snapshot.
7. Commit transaction and return typed response DTO.

---

## 7. Database Changes

The schema introduces five tables in `src/db/schema.ts` through an additive Drizzle migration.

### 7.1 Schema Definitions (Drizzle ORM)

```typescript
import { pgTable, text, timestamp, jsonb, integer, boolean, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// 1. Singleton store settings table
export const storeSettings = pgTable("store_settings", {
  id: text("id").primaryKey(), // singleton key: 'default'
  storeName: text("store_name").notNull(),
  legalName: text("legal_name"),
  supportEmail: text("support_email").notNull(),
  supportPhone: text("support_phone").notNull(),
  address: text("address").notNull(),
  logoMediaId: text("logo_media_id").references(() => media.id),
  defaultLanguage: text("default_language").notNull().default("ar-EG"),
  currency: text("currency").notNull().default("EGP"),
  currencySymbol: text("currency_symbol").notNull().default("ج.م"),
  currencyExponent: integer("currency_exponent").notNull().default(2),
  timezone: text("timezone").notNull().default("Africa/Cairo"),
  dateFormat: text("date_format").notNull().default("YYYY-MM-DD"),
  orderPrefix: text("order_prefix").notNull().default("ORD-"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  updatedBy: text("updated_by").notNull(),
});

// 2. Shipping zones
export const shippingZones = pgTable("shipping_zones", {
  id: text("id").primaryKey(), // UUID
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en").notNull(),
  countryCode: text("country_code").notNull().default("EG"),
  governorates: jsonb("governorates").notNull().$type<string[]>(), // Array of governorate codes
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// 3. Shipping methods linked to zones
export const shippingMethods = pgTable("shipping_methods", {
  id: text("id").primaryKey(), // UUID
  zoneId: text("zone_id").notNull().references(() => shippingZones.id, { onDelete: "cascade" }),
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en").notNull(),
  costMinor: integer("cost_minor").notNull().default(0), // Integer minor currency units (pennies)
  estimatedDaysMin: integer("estimated_days_min").notNull().default(1),
  estimatedDaysMax: integer("estimated_days_max").notNull().default(3),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("shipping_cost_non_negative", sql`${t.costMinor} >= 0`),
  check("shipping_days_valid", sql`${t.estimatedDaysMin} <= ${t.estimatedDaysMax}`),
]);

// 4. Payment method configurations
export const paymentMethodConfigs = pgTable("payment_method_configs", {
  id: text("id").primaryKey(), // 'cod' | 'online_card'
  titleAr: text("title_ar").notNull(),
  titleEn: text("title_en").notNull(),
  instructionsAr: text("instructions_ar"),
  instructionsEn: text("instructions_en"),
  isEnabled: boolean("is_enabled").notNull().default(true),
  minOrderSubtotalMinor: integer("min_order_subtotal_minor"),
  maxOrderSubtotalMinor: integer("max_order_subtotal_minor"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  updatedBy: text("updated_by").notNull(),
}, (t) => [
  check("payment_method_valid_key", sql`${t.id} IN ('cod', 'online_card')`),
]);

// 5. Versioned financial & operational policies (Append-Only)
export const operationalPolicyVersions = pgTable("operational_policy_versions", {
  id: text("id").primaryKey(), // UUID
  version: integer("version").notNull().unique(), // Monotonically increasing: 1, 2, 3...
  taxMode: text("tax_mode").notNull().default("exclusive"), // 'exclusive' | 'inclusive' | 'disabled'
  taxRateBasisPoints: integer("tax_rate_basis_points").notNull().default(1400), // 1400 = 14.00%
  taxShipping: boolean("tax_shipping").notNull().default(false),
  roundingMethod: text("rounding_method").notNull().default("half_up"),
  roundingMinorUnit: integer("rounding_minor_unit").notNull().default(100),
  orderConfirmationMode: text("order_confirmation_mode").notNull().default("manual"), // 'manual' | 'auto_on_paid'
  inventoryTrackingEnabled: boolean("inventory_tracking_enabled").notNull().default(true),
  defaultLowStockThreshold: integer("default_low_stock_threshold").notNull().default(5),
  reservationTtlSeconds: integer("reservation_ttl_seconds").notNull().default(900), // 15 mins
  codConfirmationTimeoutSeconds: integer("cod_confirmation_timeout_seconds").notNull().default(86400), // 24 hours
  changeReason: text("change_reason"),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).defaultNow().notNull(),
  createdBy: text("created_by").notNull(),
}, (t) => [
  check("tax_mode_valid", sql`${t.taxMode} IN ('exclusive', 'inclusive', 'disabled')`),
  check("tax_rate_non_negative", sql`${t.taxRateBasisPoints} >= 0`),
  check("confirmation_mode_valid", sql`${t.orderConfirmationMode} IN ('manual', 'auto_on_paid')`),
  check("reservation_ttl_positive", sql`${t.reservationTtlSeconds} > 0`),
]);
```

---

## 8. Validation Rules

All inputs must be parsed and strictly validated using Zod at the API route boundary before reaching application logic.

### 8.1 Store Profile Schema (`StoreProfileUpdateInputSchema`)
- `storeName`: string, min 2, max 100 characters, trimmed.
- `legalName`: optional string, max 150 characters, trimmed.
- `supportEmail`: string, valid email format, lowercase normalized.
- `supportPhone`: string, regex `/^\+?(20)?(1[0125]\d{8}|[23]\d{7,8})$/` (Egyptian phone format).
- `address`: string, min 5, max 300 characters.
- `logoMediaId`: optional string UUID corresponding to a valid record in `media` table.
- `defaultLanguage`: enum `['ar-EG', 'en-US']`.
- `currency`: enum `['EGP']`.
- `timezone`: enum `['Africa/Cairo']`.
- `dateFormat`: enum `['YYYY-MM-DD', 'DD/MM/YYYY']`.
- `orderPrefix`: string, regex `/^[A-Z0-9_-]{2,10}$/`.

### 8.2 Shipping Zone & Method Schemas
- `nameAr`: string, min 2, max 100 characters.
- `nameEn`: string, min 2, max 100 characters.
- `countryCode`: string, 2 uppercase characters (`EG`).
- `governorates`: array of valid Egypt governorate codes, min 1 item, no duplicates.
- `costMinor`: integer, min 0 (0 represents Free Shipping).
- `estimatedDaysMin`: integer, min 0, max 30.
- `estimatedDaysMax`: integer, min 1, max 60, must be `>= estimatedDaysMin`.

### 8.3 Operational Policy Schema (`CreatePolicyVersionInputSchema`)
- `taxMode`: enum `['exclusive', 'inclusive', 'disabled']`.
- `taxRateBasisPoints`: integer, min 0, max 10000 (0% to 100%).
- `taxShipping`: boolean.
- `orderConfirmationMode`: enum `['manual', 'auto_on_paid']`.
- `inventoryTrackingEnabled`: boolean.
- `defaultLowStockThreshold`: integer, min 0, max 1000.
- `reservationTtlSeconds`: integer, min 60, max 86400 (1 minute to 24 hours).
- `codConfirmationTimeoutSeconds`: integer, min 3600, max 604800 (1 hour to 7 days).
- `changeReason`: optional string, max 255 characters.

---

## 9. Authentication, Permissions & Security

- **Session Requirement:** All administrative endpoints require a valid staff session cookie (`context = 'staff'`) that is active, non-expired, and not revoked (per `AD-9`).
- **Owner Role Guard:** Verified via `requireRole('owner')` or `requirePermission('settings.manage')`. Staff sessions with other roles (e.g., Manager, Warehouse) receive:
  ```json
  {
    "error": {
      "code": "FORBIDDEN",
      "message": "Only Store Owners can view or modify operational settings.",
      "request_id": "req-xxx"
    }
  }
  ```
- **CSRF & Origin Protection:** All mutating HTTP verbs (`POST`, `PUT`, `DELETE`) require a valid session CSRF token header and verified `Origin` header matching the host origin.
- **Cache Directives:** All admin responses return `Cache-Control: no-store, private`. Public storefront settings endpoint (`GET /api/v1/store/settings/public`) uses `Cache-Control: public, s-maxage=300, stale-while-revalidate=600` with tags for on-demand invalidation when settings are updated.

---

## 10. Error Handling & Standard Responses

API responses conform to the project error envelope convention:
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable explanation",
    "details": [
      {
        "field": "currency",
        "message": "Cannot change currency once orders have been placed in the store."
      }
    ],
    "request_id": "req-12345"
  }
}
```

### Specific Domain Error Codes:
- `CURRENCY_LOCKED_ORDERS_EXIST` (409): Attempted to modify currency while orders exist.
- `GOVERNORATE_ALREADY_ASSIGNED` (422): One or more governorates in the new zone are already covered by an existing active zone.
- `SHIPPING_METHOD_INACTIVE` (422): Requested shipping method is disabled.
- `SHIPPING_ZONE_UNSERVICED` (422): Provided address cannot be matched to any active shipping zone.
- `PAYMENT_METHOD_DISABLED` (422): Attempted checkout with a disabled payment method.
- `POLICY_IMMUTABLE` (400): Attempted to mutate or delete a historical policy version.
- `MEDIA_NOT_FOUND` (404): Specified `logoMediaId` does not exist or is not in `active` status.

---

## 11. Edge Cases & Concurrency Guards

1. **Race Condition: Currency Change vs. First Order Placement:**
   - Handled by acquiring a row lock on `store_settings` inside the currency update transaction, followed by `SELECT EXISTS(SELECT 1 FROM orders)`. If an order is committed concurrently, the currency update rolls back with `409 Conflict`.
2. **Concurrent Policy Creation:**
   - Policy versions have a unique constraint on `version`. To assign the next version safely, the transaction runs `SELECT MAX(version) FROM operational_policy_versions FOR UPDATE`, increments by 1, and inserts the new record.
3. **Zone Deletion with Active Orders:**
   - Deleting or disabling a shipping zone does not affect orders already created, as orders preserve the shipping rate and method name inside `order_address_snapshots`.
4. **Timezone Transitions & DST:**
   - Time calculations in backend tasks and database triggers use UTC exclusively. Displayed strings format according to the configured IANA timezone (`Africa/Cairo`) using standard `Intl.DateTimeFormat`.
5. **Logo Replacement / Orphan Media:**
   - Updating `logoMediaId` points to the new media row. The old media record remains in `media` to protect audit trail history and avoid broken links in historical rendered views.

---

## 12. Traceability to PRD & Architecture

| PRD / Arch Requirement | Implementation in Epic 03 |
|---|---|
| **FR-42 (Settings)** | Complete store profile, support info, logo, currency, locale, timezone, inventory defaults, payment and shipping toggles. |
| **FR-22 (Shipping & Addresses)** | Server-side shipping zone and method eligibility engine (`isEligible`), rejection of unserved zones. |
| **FR-55 (Historical Immutability)** | Snapshots preserved; settings updates do not cascade to existing orders; policy versions immutable. |
| **FR-57 (Data Invariants)** | Currency exponent locked, UTC timestamps stored in PostgreSQL, unique constraints on policy versions. |
| **FR-58 (API Contracts)** | Unified REST DTOs, Zod boundary validation, standard error envelopes with correlation IDs. |
| **FR-59 (Providers & Integrations)** | Strict isolation of provider credentials; no secrets exposed in settings DTOs. |
| **FR-06 / FR-07 / §8.1 (RBAC)** | Owner-only permissions (`settings.read`, `settings.manage`); fail-closed security. |
| **PRD §4.4 (A-01, A-02)** | Single B2C store, Cairo timezone, EGP currency, COD + one online gateway, domestic shipping zones. |
| **PRD §6.1 (Pricing & Tax Rules)** | Versioned financial policies: tax mode, basis points, shipping taxability, half-up rounding. |
| **PRD §6.2 (Reservation Policy)** | Versioned operational policies: 15-minute reservation TTL, 24-hour COD confirmation window. |
| **AC-11 (Shipping Rejection)** | Server-side validation during quote/checkout rejects unserviced zones and disabled methods. |
| **AC-19 (Draft / Scope Controls)** | Currency toggle disabled when orders exist; no P1 controls visible in settings UI. |
| **AD-1 / AD-2 (Modular Architecture)** | Settings submodule located in `src/modules/content/settings/` with clear boundary interfaces. |
| **AD-4 (Price & Policy Snapshots)** | Append-only `operational_policy_versions`; orders reference static `policy_version_id`. |
| **AD-15 (Audit Events)** | In-transaction append-only logging to `audit_events` for every settings change. |

