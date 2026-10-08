# API contracts

New admin routes use REST JSON under `/api/v1`; require live Owner session, private/no-store responses and shared correlation. Mutations require X-CSRF-Token, trusted Origin/provenance and bounded JSON. No create/delete route, paging or custom method registry. Order of the fixed list is COD then online card.

## Admin DTO

`PaymentMethodConfig`: id enum, title_ar/title_en strings, instructions_ar/instructions_en strings, is_enabled boolean, min_order_subtotal_minor/max_order_subtotal_minor canonical integer string|null, version positive integer, updated_at UTC ISO8601, updated_by opaque actor|null, currency `EGP`, currency_exponent `2`. Safe derived read-only fields: `is_ready: boolean`, `readiness_reason: "READY"|"NOT_CONFIGURED"|"NOT_APPROVED"`. Readiness service unavailable is a dependency failure, not a fabricated status. Only approved safe status mapping may be extended later; no env key names, merchant IDs, URLs/tokens or provider debug payloads.

## GET `/api/v1/admin/settings/payments`

200 `{success:true,methods:PaymentMethodConfig[],csrf:string}`. Exactly both registered rows; empty/missing registry is a configuration error. Read requires settings.read. CSRF never appears in a public DTO or logs. 401/403 for access denial; known unavailable dependency 503, unexpected fault sanitized 500.

## PUT `/api/v1/admin/settings/payments/{id}`

Partial update of documented config fields plus required expected_version. Currency, IDs, readiness, timestamps/actor and credentials are read-only or prohibited. At least one config field required. Example:

```json
{
  "is_enabled": true,
  "title_ar": "الدفع عند الاستلام",
  "title_en": "Cash on Delivery",
  "instructions_ar": "الدفع عند استلام الطلب",
  "instructions_en": "Pay when your order is delivered.",
  "min_order_subtotal_minor": "10000",
  "max_order_subtotal_minor": null,
  "expected_version": 1
}
```

200 `{success:true,method:PaymentMethodConfig}` with version N+1 and committed config. Disabling both methods remains a successful authorized change with UI warning. Edit does not establish readiness or affect existing attempts. No idempotency-key requirement added for this config PUT; lost response reconciles via GET and version.

## Existing public GET `/api/v1/store/settings/public`

Preserve all current profile keys. Replace existing `enabled_payment_methods: []` placeholder with safe metadata array of `{id:string,title:string,instructions?:string}` for effectively available methods. This is a compatible change in values, not a new profile API or basket eligibility assertion. Retain array when no methods available.

Map Arabic store locales to Arabic copy and English locales to English copy, fallback to Arabic for unknown saved locale; this does not implement customer language switching. Include instructions only when nonempty. Do not expose bounds, readiness diagnostics, config version, actor, CSRF or full bilingual/admin DTO. Use no-store initially rather than stale cached enablement. Registry/dependency failure returns safe error, not misleading successful empty configuration.

## Internal server contracts (no new public quote endpoint here)

- `listConfiguredMethods(tx)` reads config; only admin uses complete DTO.
- `listAvailablePaymentMetadata(tx, readiness, locale)` applies enabled + approved readiness, returns existing safe public shape without subtotal filtering.
- `getEligiblePaymentMethods(tx, pricingContext, readiness, locale)` applies enabled/readiness and inclusive bounds using authoritative `{subtotal_minor, currency, currency_exponent}` from pricing. Internal money is exact integer representation; HTTP string encoding is not permission to trust client amounts.
- `assertPaymentMethodEligible(tx, methodId, pricingContext, readiness)` under selected row lock returns config version and safe snapshot copy, or typed `PAYMENT_METHOD_DISABLED`, `PAYMENT_METHOD_NOT_READY`, `PAYMENT_SUBTOTAL_OUT_OF_RANGE`, `PAYMENT_METHOD_UNKNOWN` or currency mismatch. Caller owns transaction lifetime through snapshot insertion. No provider call inside lock.
- Checkout maps these to its safe versioned quote/submit DTO/error conventions, preserves inputs and never creates an accepted order for a rejected new selection. Settings exposes no endpoint accepting a browser subtotal as authoritative.

## Errors

Envelope `{error:{code,message,details,request_id}}`, shared response/log/audit correlation, safe field details. No raw body logging on secret-key rejection.

| Status/code | Meaning |
|---|---|
| 400 BAD_REQUEST | Malformed JSON per existing parser; preserve its separate body-limit behavior. |
| 401 UNAUTHORIZED | Absent/invalid/expired staff session. |
| 403 FORBIDDEN | Authenticated non-Owner or invalid CSRF/provenance. |
| 404 NOT_FOUND | Unknown admin method ID after authorization. Missing seeded registry is configuration failure rather than normal absent resource. |
| 409 target STALE_PAYMENT_METHOD_CONFIG | expected_version mismatch; zero config/version/audit changes. |
| 422 UNPROCESSABLE_ENTITY | Input/unknown-key/merged bounds/overflow/empty edit validation. |
| 503 dependency / 500 safe internal | Known DB/readiness unavailable or unexpected defect/config fault; no secrets or stacktrace. |

Downstream eligibility failures reject new checkout submissions according to the checkout contract; they do not reject trusted callbacks/reconciliation for an existing attempt. No endpoint in this story may set Paid, collect card details or expose gateway credentials.
