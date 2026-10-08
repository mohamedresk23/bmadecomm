# API contracts

These preserve current paths and response envelopes. Money strings, version fields and deletion guards below are target additions/changes; coordinate rollout described in brownfield.md. Admin responses private/no-store; public eligibility no-store. Lists are complete unpaginated configuration lists in this slice, stably sorted by name then ID; future pagination requires an explicit compatible contract. No filters/search endpoint is introduced.

## DTOs

`Method`: `id`, `zone_id`, `name_ar`, `name_en` strings; `cost_minor` target canonical integer **string**; `cost_formatted` display string; `estimated_days_min/max` integers; `is_active` boolean; `created_at/updated_at` UTC ISO8601 strings; target `version` positive integer. Target money context `currency: "EGP"`, `currency_exponent: 2` accompanies rate DTOs. Never use formatted cost as an authoritative value.

`Zone`: `id`, `name_ar`, `name_en`, `country_code` strings; `governorates: string[]`, `is_active: boolean`, `methods: Method[]`, timestamps and target `version`.

`AvailableMethod`: `method_id`, localized `name`, target string `cost_minor`, `cost_formatted`, estimated-day integers and EGP context. Existing response uses Arabic name; switching storefront language requires an explicit locale contract, not arbitrary client text.

## Administrative routes

All require live Owner settings permissions. Mutations require `X-CSRF-Token` and trusted Origin policy. JSON bodies are bounded and strictly validated. GET returns session-bound CSRF; actor always comes from session.

| Method/path | Request | Success |
|---|---|---|
| GET `/api/v1/admin/settings/shipping/zones` | None | 200 `{success:true,zones:Zone[],csrf:string}` |
| POST same | `name_ar`, `name_en`, `governorates`, optional `country_code` (EG), optional `is_active` (true) | 201 `{success:true,zone:Zone}`; version 1 |
| PUT `/api/v1/admin/settings/shipping/zones/{id}` | Partial writable zone fields plus `expected_version`; at least one change field | 200 `{success:true,zone:Zone}`; version N+1 |
| DELETE same | Target `If-Match: "N"` matching zone version | 200 `{success:true}`; only unreferenced resources |
| POST `/api/v1/admin/settings/shipping/methods` | `zone_id`, names, target string `cost_minor`, day bounds, optional `is_active` | 201 `{success:true,method:Method}`; version 1 |
| PUT `/api/v1/admin/settings/shipping/methods/{id}` | Partial method fields except zone_id, plus expected_version | 200 `{success:true,method:Method}`; version N+1 |
| DELETE same | Target `If-Match: "N"` | 200 `{success:true}`; only unreferenced method |

Example target method create (50 EGP):

```json
{"zone_id":"zone_cairo_giza","name_ar":"توصيل عادي","name_en":"Standard Delivery","cost_minor":"5000","estimated_days_min":1,"estimated_days_max":2,"is_active":true}
```

No method GET route is needed; zone listing includes methods. Method DELETE already exists although the original ticket omitted it. No POST idempotency contract is claimed; ambiguous create results must be reconciled.

## POST `/api/v1/store/shipping/check-eligibility`

Public read-only query. JSON `{country_code?:string,governorate:string,city?:string,postal_code?:string,method_id?:string}`. Does not persist destination or create a reservation/order/quote.

- Eligible 200: `{success:true,is_eligible:true,zone_name:string,available_methods:AvailableMethod[]}`. Return all active options in deterministic order, even when method_id validates one of them, preserving current behavior. Server consumer independently returns the selected method's exact rate; it never prices by picking the first option.
- Ineligible 200: `{success:true,is_eligible:false,reason:string,available_methods:[]}`. Target additive `reason_code` uses `COUNTRY_UNSUPPORTED`, `GOVERNORATE_UNKNOWN`, `ZONE_UNSERVICED`, `NO_ACTIVE_METHODS`, or `METHOD_UNAVAILABLE`. Do not disclose private inactive zone/method details.
- Malformed input 400/422 according to parser/schema; DB failure 503/500, never disguised as `is_eligible:false`.
- Consumers must revalidate using the application contract at quote and final submit. This informational 200 is not authorization to create an Order.

## Errors

Use existing `{error:{code,message,details,request_id}}`; safe field details only. Correlation ID is shared by HTTP response/logs/audit, not a separate random audit ID.

| Status/code | Meaning |
|---|---|
| 401 `UNAUTHORIZED` | Absent/expired/invalid staff session. |
| 403 `FORBIDDEN` | Non-Owner or invalid CSRF/provenance. |
| 404 `NOT_FOUND` | Missing admin resource/parent after authorization. |
| 409 target `STALE_SHIPPING_SETTINGS` | Update/delete expected version mismatch. |
| 409 target `SHIPPING_RESOURCE_IN_USE` | Financial/retained quote reference blocks removal. |
| 422 `GOVERNORATE_ALREADY_ASSIGNED` | Active overlap; field governorates. |
| 422 `UNPROCESSABLE_ENTITY` | Invalid field/merged range/unknown key/overflow or missing precondition after rollout. |
| 400 `BAD_REQUEST` | Malformed JSON per shared parser; preserve its separate oversize-body behavior. |
| 503 dependency / 500 safe internal | Known unavailable DB or unexpected defect; no SQL/stacktrace/private destination leakage. |

Checkout maps ineligible selection to its established domain error and preserves inputs (FR-22/AC-11); changed rate becomes a stale-quote conflict with explicit review under FR-19/23. Do not implement a new checkout error envelope here. Failed mutations leave resource/version/audit unchanged; valid public ineligibility is a query result with no mutation.
