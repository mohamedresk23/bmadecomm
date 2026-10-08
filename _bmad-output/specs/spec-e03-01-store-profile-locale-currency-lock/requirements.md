# Implementation requirements

## Scope and business rules

Implement or reconcile the profile slice of A-13: store name, legal name, support email/phone, physical address, logo, default language, operating currency, timezone, date format and future order prefix. Include Owner reads/writes, public metadata, validation, audit, access enforcement and UI states. Keep sibling settings behavior intact; this story does not deliver shipping, payments or policy forms.

1. One store configuration exists, identified by `default`. Never accept a store ID or actor from the browser.
2. Launch operates in EGP only, with symbol `ج.م` and exponent `2`. Derive both server-side; no exchange rates or price conversion.
3. After any Order exists, reject an attempted currency change with `409 CURRENCY_LOCKED_ORDERS_EXIST`, even for cancelled/unpaid orders. An unchanged currency permits edits to other fields. Before orders, non-EGP is `422`; the former ticket expectation of a successful alternate currency is superseded by the user's decision.
4. Validate currency as a bounded uppercase ISO-shaped string, then apply the domain guard, so post-order attempts such as USD reach the specified 409 rather than an early EGP-only enum rejection. An invalid syntax remains 422.
5. Serialize writes against the singleton. First-order creation must participate in the same settings guard and read currency within that transaction; locking settings while merely counting orders does not serialize unrelated order inserts. Define a common lock order with checkout before it ships. Profile code cannot write orders or recalculate them.
6. Protect the permanent meaning of “after first order”: ordinary order deletion is prohibited by financial retention rules; if deletion is ever introduced, persist a monotonic trading-start marker first. Never unlock through cancellation or cleanup.
7. Prefix edits apply to future numbers only. Existing order identifiers and their unique constraints are unaffected; prefix itself does not guarantee number uniqueness.
8. Locale/timezone/date edits do not move stored instants or rewrite historical labels/snapshots. Reporting computes boundaries in the selected IANA zone, respecting DST, rather than applying a fixed Cairo offset.
9. Authorize, validate, verify media, recheck domain constraints, compare version, update and audit in a short transaction. A failure rolls back all profile DB effects. No external storage call while holding the settings lock.
10. Audit action `store_settings.updated`, resource `store_settings:default`, authenticated actor, timestamp, safe before/after diff and the same request correlation ID used by the HTTP response. Never include CSRF/session values, credentials, raw upload bytes or unrelated personal data.

## Frontend requirements

- Use the protected current `/admin/settings?tab=profile` view. `/admin/settings` defaults to profile; retain the working shipping tab. A future `/admin/settings/profile` alias is optional, not required. Payments/policies remain unavailable until their own stories; no new operational controls.
- Display labeled fields in identity/support, branding and presentation groups. Arabic RTL defaults, logical spacing, LTR isolation for phone/email/codes, visible focus and keyboard access follow DESIGN/EXPERIENCE. Avoid inventing brand colors/fonts beyond existing UI conventions.
- Currency shows EGP as the only launch value, with an explanation of launch scope even before orders. After orders, show the lock notice “لا يمكن تغيير العملة بعد تسجيل أول طلب”. Make its explanation visible to keyboard/touch users without requiring hover.
- Logo upload previews the validated image, supports replacement/removal, and keeps the current saved logo until save succeeds. Save is disabled during upload/submission and when unchanged. Unsaved edits remain in local component memory; navigation away prompts before discarding dirty values.
- Use shared boundary validation for immediate feedback; map server `details` to fields. Show required fields, error summary/focus on invalid submit, and announce successful save with `role="status"`. Do not announce success optimistically.
- Render the committed profile returned by PUT as the clean baseline. Refresh lock/version metadata after save as needed. On stale conflict, reload explicitly and let the Owner reapply edits; do not silently overwrite another Owner's change.

## Loading, empty and failure states

| State | Required behavior |
|---|---|
| Initial load | Loading status/skeleton; disable editing and save until valid profile and CSRF are available. |
| No logo or optional value | Branded-neutral placeholder; clear optional fields without showing a broken image. |
| Singleton missing | Configuration failure with retry/support guidance; no blank form capable of overwriting settings and no GET-based seeding. |
| Upload in progress | Announced progress/busy state; prevent duplicate upload/save. |
| Upload rejected/provider unavailable | Inline error; retain previous saved logo and profile; allow retry. |
| Validation error | Preserve valid edits, show field errors plus summary, focus appropriately. |
| Save pending | Disable duplicate submission; preserve edits until server confirms. |
| Currency lock/stale conflict | Explain cause; preserve draft, refetch authoritative state and require explicit resubmission. |
| Network timeout after PUT | Outcome unknown; GET/reconcile before resubmission, no false failure/success or automatic mutation loop. |
| Session expired/revoked | Stop writes, clear token state, guide to admin login; never persist auth tokens to recover the form. |
| Forbidden | Access-denied state without profile data or hidden sensitive fields. |
| Public read failure | Consumer displays a safe unavailable/fallback state, never invents currency/financial values from a failed request. |

## Backend and media requirements

Use current `src/modules/content/settings/{contracts,application,infrastructure}` and thin `/api/v1` route adapters. Reuse staff session resolution, transactional DB utilities, API errors and audit writer. Public reads use an explicit allowlist. Do not import server DB/storage/session code into client bundles.

Integrate existing F00-07 `POST /api/media/upload` with multipart `file`; the ticket's `/api/v1/media/upload` does not currently exist. Validate actual decode/type and size for JPEG/PNG/WebP, maximum 5MB per the existing media foundation; SVG/HTML/executable content is rejected. Upload authorization must derive from the server session, never a client `x-mock-user` header. Cookie uploads and publication need the same CSRF/Origin trust policy as profile mutations.

The Owner may reference an existing media asset only if authorized for this use and validated as an image. Resolve through the media owner's contract. Publish/verify availability outside the profile DB lock; only a ready asset can be committed as the logo. Missing asset: 404; invalid/unauthorized asset: safe 422/403 without leaking private metadata. Clearing the logo sets null. Replacement does not delete the old asset; orphan cleanup belongs to F00-07 retention and must check references. A staged/ready orphan after a failed profile save is acceptable; a broken public logo is not.

## Validation rules

Lengths and accepted enums below reuse current contracts unless marked target tightening. Server validation remains authoritative.

| Field | Validation / normalization |
|---|---|
| `store_name` | Trim; required; 2–100 characters. |
| `legal_name` | Trim; nullable; at most 150 characters; empty maps to null. |
| `support_email` | Trim; required valid email; at most 255 characters; do not apply registration-only verification rules. |
| `support_phone` | Trim; required Egyptian mobile format `^(\+20\|0)1[0125]\d{8}$`; preserve valid supplied form. |
| `address` | Trim; nullable; at most 300 characters; empty maps to null. |
| `logo_media_id` | Null or nonempty opaque existing media ID; no arbitrary URL, path or HTML; authorization/content/availability checks. |
| `default_language` | Existing readable values `ar-EG`, `en-US`, `ar`, `en`; initial/default `ar-EG`; editable release allowlist pending OQ-01. |
| `currency` | Required uppercase 3-letter syntax; only EGP accepted at launch; post-order changed value 409. |
| `timezone` | Required recognized IANA timezone, initial `Africa/Cairo`; reject unknown values (target tightening over current nonempty check); curated UI choices pending OQ-01. |
| `date_format` | `YYYY-MM-DD`, `DD/MM/YYYY`, `MM/DD/YYYY`. |
| `order_prefix` | Trim; `^[A-Z0-9_-]{1,10}$`; initial `ORD-`. |
| `expected_version` | Required positive integer after compatibility rollout; stale value 409. |

Reject unknown writable keys, including symbol, exponent, audit actor and timestamps. Enforce bounded JSON via existing shared parser. Explicit PUT uses all writable profile fields with nullable optional values; never reset omitted presentation fields to defaults on an established profile. Malformed JSON/type/enum errors expose safe details only. Preserve current endpoint parser's status/body limits rather than defining a conflicting global convention.

## Authentication and permissions

Owner alone can read/manage settings. Re-evaluate session expiry, account activity and current roles on every request; revocation takes effect on the next request. No/invalid staff session is 401, including a guest or customer with no staff session. A valid staff session lacking Owner is 403. This resolves the ticket's contradictory customer/guest 403 statement using existing E02/AD-9 semantics.

GET requires `settings.read`; PUT requires `settings.manage`. Map these logical permissions to the existing centralized policy representation; do not introduce duplicate dot/colon grant systems. Mutation requires `X-CSRF-Token` and trusted same-origin checks. Public GET needs no authentication and must never expose the admin CSRF field. Reuse current security conventions for missing Origin/nonbrowser clients; make accepted provenance explicit rather than weakening checks in this route.
