# Implementation Stories — E03-03: Payment Method Enablement & Customer Guidance

This document breaks down the **E03-03 Implementation Specification** (`_bmad-output/specs/spec-e03-03-payment-method-enablement/`) into small, independently implementable and testable vertical stories. Each story is sized for a single AI coding session and maintains strict data security (zero provider secret exposure), append-only audit tracking, and comprehensive automated test coverage.

---

## Story Map Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│ E03-03: Payment Method Enablement & Customer Guidance                  │
├────────────────────────────────────────────────────────────────────────┤
│ 1. E03-03-01: Schema, Admin Service & REST API                         │
│    (DB migration 0012, seeds, Zod schemas, audit, optimistic locks)    │
│                                  │                                     │
│                                  ▼                                     │
│ 2. E03-03-02: Store Owner Admin UI & Shell Integration                 │
│    (/admin/settings?tab=payments, cards, exact money, dirty warning)   │
│                                  │                                     │
│                                  ▼                                     │
│ 3. E03-03-03: Storefront Public Metadata & Checkout Eligibility Engine │
│    (public settings dynamic array, subtotal bounds, row-lock engine)   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Story: E03-03-01 — Payment Method Schema, Admin API & Optimistic Concurrency

- **Story ID:** `E03-03-01`
- **Objective:** Establish the database persistence model, seed baseline payment methods (`cod` and `online_card`), and deliver the authenticated Store Owner REST endpoints (`GET` and `PUT`) with optimistic concurrency protection (`expected_version`), append-only audit logging, and strict secret-free DTO projection.
- **Scope:**
  - **Database:**
    - Create migration `0012_payment_method_configs.sql` and companion `0012_payment_method_configs.down.sql`.
    - Register migration in `src/db/migrations/meta/_journal.json`.
    - Define table `payment_method_configs` in `src/db/schema.ts`:
      - `id`: `text PRIMARY KEY` (`CHECK (id IN ('cod', 'online_card'))`).
      - `title_ar`: `text NOT NULL` (2–100 chars).
      - `title_en`: `text NOT NULL` (2–100 chars).
      - `instructions_ar`: `text NOT NULL DEFAULT ''` (max 2000 chars).
      - `instructions_en`: `text NOT NULL DEFAULT ''` (max 2000 chars).
      - `is_enabled`: `boolean NOT NULL DEFAULT true`.
      - `min_order_subtotal_minor`: `integer NULL` (`CHECK (min_order_subtotal_minor >= 0)`).
      - `max_order_subtotal_minor`: `integer NULL` (`CHECK (max_order_subtotal_minor >= 0)`).
      - Table check constraint: `min_order_subtotal_minor IS NULL OR max_order_subtotal_minor IS NULL OR min_order_subtotal_minor <= max_order_subtotal_minor`.
      - `version`: `integer NOT NULL DEFAULT 1` (`CHECK (version > 0)`).
      - `updated_at`: `timestamptz NOT NULL DEFAULT now()`.
      - `updated_by`: `text NULL`.
    - Seed both rows (`cod` and `online_card`) with baseline bilingual labels, `is_enabled = true`, null thresholds, and `version = 1`.
  - **Backend:**
    - Create contracts in `src/modules/content/settings/contracts/payment-settings.ts`:
      - `PaymentMethodConfig` DTO schema and `PaymentMethodConfigUpdateInputSchema`.
      - Input validation: canonical integer strings for subtotal bounds (`0`..`2147483647`), non-empty strings, plain text escaping.
      - Strict writable allowlist: reject unknown keys, currency changes, credentials, and timestamps in update payloads.
    - Implement `PaymentSettingsService` in `src/modules/content/settings/application/payment-settings.ts`:
      - `listConfiguredMethods(tx)`: returns configurations with safe readiness status (`is_ready: boolean`, `readiness_reason: "READY" | "NOT_CONFIGURED" | "NOT_APPROVED"`).
      - `updatePaymentMethodConfig(tx, actorId, methodId, input)`:
        - Select with `FOR UPDATE`.
        - Validate `input.expected_version === row.version` (otherwise throw 409 `STALE_PAYMENT_METHOD_CONFIG`).
        - Merge partial edits and enforce `min <= max`.
        - Increment version (`version + 1`), update timestamps and actor.
        - Emit atomic append-only audit event (`action: "payment_method_config.updated"`, `resource: "payment_method_config:${id}"`, safe diff, request ID).
    - Implement admin API routes:
      - `GET /api/v1/admin/settings/payments`: Owner-only (`settings.read`), returns `{ success: true, methods, csrf }` with `Cache-Control: no-store`.
      - `PUT /api/v1/admin/settings/payments/[id]`: Owner-only (`settings.manage`), validates CSRF + Origin, updates config atomically.
- **Dependencies:** F00-02 (Migrations/Transactions), F00-04 (Audit Trail), E02-01 & E02-02 (Staff Session/Owner Auth).
- **Affected Layers:** Backend, Database.
- **Acceptance Criteria:**
  - **AC-E03-03-01:** Owner toggle persists `is_enabled`, increments `version`, and writes an audit event in the same transaction; audit failure rolls back the update.
  - **AC-E03-03-02:** Valid localized copy and nullable subtotal bounds persist; merged min ≤ max enforced; null and `0` remain distinct.
  - **AC-E03-03-03:** All API responses, logs, and audit entries strictly exclude provider credentials and secrets; forbidden keys in payloads are rejected with 422.
  - **AC-E03-03-04:** Non-Owner staff receive `403 Forbidden`; unauthenticated requests receive `401 Unauthorized`; missing/invalid CSRF or Origin yields `403`.
  - **AC-E03-03-07:** Stale write based on version $N$ returns `409 Conflict` (`STALE_PAYMENT_METHOD_CONFIG`) with zero database mutation or audit entry.
  - **AC-E03-03-10 (Backend part):** Saving both methods as disabled is permitted; returns committed state without throwing or auto-enabling.
  - **AC-E03-03-13:** Migration executes cleanly, seeds both rows idempotently, and rollback cleanly drops the table.
- **Test Expectations:**
  - **Unit tests:** Zod input validation schemas (string lengths, integer strings, min ≤ max, rejection of raw numeric floats/scientific notation/credentials).
  - **API route tests:**
    - `GET`: returns 200 with exactly 2 methods and CSRF token for Owner; 401 for anonymous; 403 for non-Owner staff.
    - `PUT`: successful update increments version to 2; stale update with version 1 returns 409; unknown method ID returns 404; missing `expected_version` returns 422.
  - **Integration tests (PostgreSQL/PGlite):**
    - Transactional audit rollback on failure.
    - Idempotent migration up and down execution.

---

## Story: E03-03-02 — Store Owner Payment Methods Management UI

- **Story ID:** `E03-03-02`
- **Objective:** Implement the accessible, responsive Store Owner interface at `/admin/settings?tab=payments` with interactive method cards for Cash on Delivery and Online Card, draft toggle states, exact money inputs, and warning banners.
- **Scope:**
  - **Frontend UI & Components:**
    - Integrate `payments` tab into the settings shell in `src/app/admin/settings/page.tsx`.
    - Create `PaymentMethodsManager` component (`src/app/admin/settings/payment-methods-manager.tsx`):
      - Method cards for **Cash on Delivery (الدفع عند الاستلام)** and **Online Card (بطاقة بنكية)**.
      - Master switch toggle (`is_enabled`) with draft status until saved (prevents premature effective payment changes).
      - Status badges: Configured enabled/disabled, Readiness status (`جاهز للعمل`, `غير مهيأ تقنياً`, `قيد الاعتماد`).
      - Informational banner: *"بيانات بوابات الدفع الإلكتروني ومفاتيح الربط تدار عبر إعدادات الخادم الآمنة ولا يمكن تعديلها من المتصفح."*
      - Bilingual text inputs: Title (Ar/En) and Customer Instructions (Ar/En) with live character counter.
      - Subtotal bound inputs: Min and Max in EGP with explicit note: *"تطبق الحدود على المجموع الفرعي للطلب (Subtotal) قبل رسوم الشحن والخصومات."*
      - Exact decimal parsing adapter: converts formatted decimal string (e.g., `"150.50"`) to minor unit string (`"15050"`), blank string to `null`, and `"0.00"` to `"0"`.
    - Safety and warning flows:
      - Prompt on disabling a method informing the owner that existing pending attempts will still be settled.
      - Prominent warning banner when both payment methods are disabled: *"تنبيه: تعطيل كافة طرق الدفع سيمنع العملاء من إتمام أي طلبات شراء جديدة."*
      - Dirty form state tracking: warn before navigating away with unsaved edits.
      - Optimistic concurrency conflict handling: on 409 response, display conflict notification and provide a one-click button to reload current server version and reapply changes.
    - RTL-first styling, LTR isolation for amounts and codes, accessible keyboard navigation, and ARIA live regions for save status announcements.
- **Dependencies:** `E03-03-01` (Admin API & Schema), E03-01 (Admin Settings Shell).
- **Affected Layers:** Frontend.
- **Acceptance Criteria:**
  - **AC-E03-03-10 (UI part):** Both-disabled state shows an explicit warning to the Owner and allows saving without validation blocks.
  - **AC-E03-03-11:** Payments tab and cards support RTL, visible focus states, mobile widths (320px–1440px), exact price entry, dirty navigation warning, busy save state, and screen-reader announced success.
  - **AC-E03-03-03 (UI part):** Frontend bundle and network requests contain zero provider keys or credentials fields.
- **Test Expectations:**
  - **Component tests (Vitest + React Testing Library):**
    - Render cards with fetched data from mock API.
    - Toggle `is_enabled` and verify save button becomes enabled (dirty state).
    - Subtotal bounds formatting: typing `50.5` serializes to `5050`; clearing field sends `null`.
    - Conflict (409) handling renders conflict message and refresh action.
    - Warning alert displays when both methods are toggled off.
    - Accessible roles: switch controls, text inputs, live announcements.

---

## Story: E03-03-03 — Storefront Payment Metadata & Server-Side Checkout Eligibility Engine

- **Story ID:** `E03-03-03`
- **Objective:** Connect the public store settings endpoint to return active, ready payment metadata, and implement the authoritative server-side checkout eligibility engine with row-lock revalidation against pricing subtotals.
- **Scope:**
  - **Storefront Public Metadata:**
    - Update `src/app/api/v1/store/settings/public/route.ts` and `StoreSettingsService.getPublicSettings()`:
      - Replace static empty array placeholder `enabled_payment_methods: []` with dynamically queried safe available methods.
      - Filter methods where `is_enabled = true` AND `is_ready = true`.
      - Map localized copy based on store locale: Arabic for `ar*`, English for `en*`, fallback to Arabic.
      - Return safe shape `{ id, title, instructions? }`. Exclude bounds, version, actor, CSRF, or internal diagnostics.
  - **Server-Side Checkout Eligibility Engine:**
    - Implement eligibility contracts in `src/modules/content/settings/application/payment-eligibility.ts`:
      - `listAvailablePaymentMetadata(tx, readinessProvider, locale)`: returns public metadata list without basket subtotal filtering.
      - `getEligiblePaymentMethods(tx, pricingContext, readinessProvider, locale)`:
        - Receives authoritative `{ subtotal_minor: number, currency: "EGP", currency_exponent: 2 }` from pricing.
        - Evaluates inclusive bounds: `(min IS NULL OR subtotal >= min) AND (max IS NULL OR subtotal <= max)`.
        - Rejects currency/exponent scale mismatches.
        - Returns list of eligible methods with localized instructions and config versions.
      - `assertPaymentMethodEligible(tx, methodId, pricingContext, readinessProvider)`:
        - Acquires row lock (`SELECT ... FOR UPDATE`) on selected method in `payment_method_configs`.
        - Re-validates enablement, readiness, and subtotal bounds under lock.
        - Throws typed errors: `PAYMENT_METHOD_DISABLED`, `PAYMENT_METHOD_NOT_READY`, `PAYMENT_SUBTOTAL_OUT_OF_RANGE`, or `PAYMENT_METHOD_UNKNOWN`.
        - Returns `{ methodId, version, title, instructions }` for immutable checkout order snapshot creation.
    - Inject default deployment readiness provider port (`isMethodReady(methodId)`) returning `true` for COD and `false` for unconfigured Online Card.
- **Dependencies:** `E03-03-01` (Schema & Core Service), E03-01 (Store Profile/Locale).
- **Affected Layers:** Backend.
- **Acceptance Criteria:**
  - **AC-E03-03-05:** Disabled or unready methods are excluded from effective storefront metadata and checkout eligibility.
  - **AC-E03-03-06:** Authoritative pricing subtotal in EGP minor units compared against inclusive bounds; values 1 minor unit above/below bounds fail eligibility; discounts/coupons and shipping costs do not affect subtotal threshold comparison.
  - **AC-E03-03-08:** Concurrent disable/bound edit versus order submission serializes on selected method row lock: commits with prior config before disable, or fails closed if disable commits first.
  - **AC-E03-03-09:** Updating payment configuration does not alter past order snapshots or disrupt pending webhook/reconciliation operations; idempotent same-key replayed requests restore original outcomes.
  - **AC-E03-03-12:** Public settings endpoint preserves all existing profile keys, serves dynamic payment metadata without cache leaks (`no-store`), and exposes zero admin fields.
- **Test Expectations:**
  - **Unit tests:** Eligibility matrix (enabled × ready × subtotal bounds × currency). Boundary tests for inclusive bounds (exact match, min - 1, max + 1).
  - **Public API tests:** `GET /api/v1/store/settings/public` returns localized payment metadata when methods are enabled/ready, and empty array when all are disabled/unready.
  - **PostgreSQL concurrency tests:** Simultaneous checkout eligibility assertion and admin disable transaction verify strict serializability under row locks.

---

## Acceptance Criteria Coverage Traceability

| Spec AC | Description | Covered In Story |
|---|---|---|
| **AC-E03-03-01** | Owner toggle persistence, version increment, atomic audit | `E03-03-01` |
| **AC-E03-03-02** | Localized copy & subtotal bounds validation (inclusive, null vs 0) | `E03-03-01` |
| **AC-E03-03-03** | Zero credentials in DTOs, errors, logs, and client bundles | `E03-03-01`, `E03-03-02` |
| **AC-E03-03-04** | RBAC (401/403), CSRF, Origin verification | `E03-03-01` |
| **AC-E03-03-05** | Disabled/unready excluded from public/checkout | `E03-03-03` |
| **AC-E03-03-06** | Authoritative pricing subtotal evaluation, exact bounds | `E03-03-03` |
| **AC-E03-03-07** | Stale write 409 conflict, validation 422 | `E03-03-01`, `E03-03-02` |
| **AC-E03-03-08** | Concurrent disable vs checkout submit serialization (row lock) | `E03-03-03` |
| **AC-E03-03-09** | Immutability of prior order snapshots & idempotency | `E03-03-03` |
| **AC-E03-03-10** | Both-disabled save allowed with UI warnings | `E03-03-01`, `E03-03-02` |
| **AC-E03-03-11** | Payments tab RTL, exact price entry, dirty navigation, accessible forms | `E03-03-02` |
| **AC-E03-03-12** | Public settings dynamic array, locale mapping, `no-store` | `E03-03-03` |
| **AC-E03-03-13** | Registered additive migration, seeds, safe rollback | `E03-03-01` |

