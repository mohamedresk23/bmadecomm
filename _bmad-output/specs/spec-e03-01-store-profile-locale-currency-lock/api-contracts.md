# API contracts

All profile endpoints use explicit JSON DTOs and safe errors. Admin responses use `Cache-Control: private, no-store`; initially public settings also use no-store to avoid stale metadata without adding invalidation infrastructure. Preserve existing routes and fields; additive version fields are target changes subject to rollout.

## DTOs

`Profile`: `store_name: string`, `legal_name: string|null`, `support_email: string`, `support_phone: string`, `address: string|null`, `logo_media_id: string|null`, `logo_url: string|null`, `default_language: string`, `currency: string` (EGP in launch data), `currency_symbol: string`, `currency_exponent: integer`, `timezone: string`, `date_format: string`, `order_prefix: string`, `updated_at: ISO8601 UTC string`, `updated_by: opaque string|null`, plus target `version: positive integer`. Timestamps/actor/currency metadata/logo URL/version are read-only.

## GET `/api/v1/admin/settings/profile`

- Auth: current Owner staff session / `settings.read`.
- 200: `{ "profile": Profile, "currency_locked": boolean, "currency_locked_reason": string|null, "csrf": string }`.
- `currency_locked` reports the historical-order guard, not editability before orders. EGP remains the only launch choice when false. `csrf` is session-bound and never cached/shared/logged.
- 401 absent/expired staff session; 403 authenticated non-Owner; 404 missing singleton; 503 known DB/dependency outage; 500 sanitized unexpected failure.

## PUT `/api/v1/admin/settings/profile`

- Auth: current Owner / `settings.manage`, cookie CSRF and Origin policy.
- Headers: `Content-Type: application/json`, `X-CSRF-Token`; response/error correlation follows F00-03.
- Body: full writable profile plus target `expected_version`. Explicitly null nullable fields to clear them. Example target request:

```json
{
  "store_name": "متجر بيميد",
  "legal_name": null,
  "support_email": "support@example.test",
  "support_phone": "+201012345678",
  "address": null,
  "logo_media_id": null,
  "default_language": "ar-EG",
  "currency": "EGP",
  "timezone": "Africa/Cairo",
  "date_format": "YYYY-MM-DD",
  "order_prefix": "ORD-",
  "expected_version": 1
}
```

- 200: preserve `{ "success": true, "profile": Profile }`; version advances exactly once for the accepted update. Client may GET lock/CSRF metadata again. No idempotency-key contract is introduced for this nonfinancial profile command; a lost response is reconciled by GET.
- 409 `CURRENCY_LOCKED_ORDERS_EXIST`: changed currency when any order exists. Recheck under shared guard; no profile/audit change.
- Target 409 `STALE_STORE_SETTINGS`: expected version differs; no profile/audit change. Domain code is proposed here, not claimed to exist today.
- 422 `UNPROCESSABLE_ENTITY`: validly shaped non-EGP before orders, invalid fields/unknown writable keys, invalid image reference state, or missing version after rollout.
- 404 `NOT_FOUND`: missing singleton or media ID; 401/403 as above; 400 `BAD_REQUEST` for malformed JSON per shared parser; existing body-limit response for oversized requests.

## GET `/api/v1/store/settings/public`

- Auth: none; no actor-specific behavior.
- 200 DTO allowlist: `store_name`, `logo_url`, `support_email`, `support_phone`, `address`, `default_language`, `currency`, `currency_symbol`, `timezone`, `enabled_payment_methods`.
- Strings/nullability follow Profile. `enabled_payment_methods` is the existing array of `{id: string, title: string, instructions?: string}`; retain `[]` until E03-03 supplies the contract. Empty here must not be interpreted as payment configuration implemented by this story.
- Do not add legal/audit/version/CSRF/media-ID fields implicitly. Exponent and date format are not currently public DTO fields; a consumer requiring them needs an explicit compatible extension.
- 404 singleton absent; 503 dependency failure; sanitized 500 unexpected failure.

## Existing media upload dependency

`POST /api/media/upload`, authenticated upload permission from trusted staff context, CSRF/Origin for cookie mutation, multipart field `file`. Reuse F00-07's actual response DTO and map its media ID/preview; do not invent a second upload API. Successful upload is not a successful profile save or permission to publish an unvalidated asset.

## Errors and correlation

```json
{
  "error": {
    "code": "CURRENCY_LOCKED_ORDERS_EXIST",
    "message": "Cannot change currency after the first order.",
    "details": [{ "field": "currency", "message": "The operating currency is locked." }],
    "request_id": "opaque-correlation-id"
  }
}
```

Use existing F00-03 correlation handling for one request ID across response, audit and logs; never generate an unrelated audit-only ID. No stack traces, SQL, secrets or private media metadata. Map known storage/DB unavailability to 503; return safe 500 for unexpected defects. Every rejected profile command has zero profile changes; unrelated security telemetry is allowed and is not a successful settings audit.
