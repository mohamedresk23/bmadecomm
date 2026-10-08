# Implementation requirements

## Objective and scope

Implement A-13 payment administration for two supported methods: enablement, Arabic/English customer-facing title/instructions and optional subtotal bounds. Include persistence, owner authorization, safe reads, runtime validation, audit, stale protection, storefront metadata integration and a transaction-aware checkout eligibility contract. Full checkout/payment execution remains downstream work.

## Business rules and edge cases

1. Registry IDs are immutable `cod` and `online_card`. Owner cannot create/delete a method, edit provider IDs or change the currency. Unknown route ID is 404 after authorization.
2. `is_enabled` is store configuration. Effective availability additionally requires a trusted server readiness result for that method. Readiness belongs to approved deployment/payment operation; it is not a browser flag, credential-existence heuristic, realtime network probe in a DB transaction or permission to charge. Missing/unknown readiness fails closed for that method.
3. Seed both configured-enabled rows as tickets specify, with nullable unbounded thresholds and safe development text. Provider/COD launch readiness is independently unapproved until OQ-PAY-01. UI distinguishes enabled but not ready from usable; no provider brand is assumed. Production deployment can intentionally disable a method without changing the registry.
4. Both methods disabled is allowed under an explicit assumption; warn that no new checkout method is available. Do not reject that save or silently enable a method. Existing financial operations continue.
5. Thresholds are per-method, inclusive. Null min/max means no lower/upper bound; zero is an actual bound, not empty. Equal min/max is valid. Min must not exceed max when both exist. Merge partial updates before checking this invariant.
6. Eligibility compares authoritative pricing Subtotal in EGP minor units, as defined in PRD §6.1: sum of effective item prices × quantity before coupon and shipping, without adding separately calculated tax. Tax-inclusive item prices remain the input price defined by pricing; settings does not strip tax or recalculate it. Never substitute Grand Total or accept a client-submitted subtotal as authority.
7. A public no-context list filters configured enablement/readiness but cannot apply basket thresholds. It is metadata, not eligibility or permission to submit. Quote returns basket-eligible options; final submit rechecks selected method, thresholds, currency and readiness.
8. Read latest config under row lock through final order snapshot creation. Owner update and submission serialize on the selected method row; if multiple rows are locked, use ascending ID order. Checkout defines the compatible global order with its idempotency/inventory/coupon/shipping locks before combined release. No external provider calls while locked.
9. Disabled/unready/out-of-range selection on a new submission is rejected without order/reservation/payment attempt effects. A previously valid quote is not grandfathered; preserve customer input and offer current options. In a race, either submission commits using the prior config before disable, or disable wins and new submission is rejected.
10. Existing committed order snapshots, payment method identity, amounts, labels and attempts do not change when enablement, copy or thresholds change. Continue webhook verification, status queries, reconciliation and refunds even when the method is disabled. Same-key replay restores its original operation rather than creating a new payment or applying current eligibility retroactively. New-attempt retry policy is OQ-PAY-02, not a silent decision here.
11. Mutable configuration version starts at 1. Required expected_version compares under lock; accepted update increments once, writes timestamps/actor and commits audit atomically. Version mismatch is 409 with zero configuration/audit changes. This resource version is not E03-04's append-only financial policy version.
12. Audit action `payment_method_config.updated`, resource `payment_method_config:{id}`, safe before/after values, authenticated actor, UTC time and the shared request ID. Audit failure rolls back config/version. No credentials, CSRF/session tokens or arbitrary request object in diff/logs.
13. All copy is plain text, escaped when rendered; no raw HTML, scripting, secrets or card fields. Boundary rejection prevents provider-secret keys from entering DTOs. Do not log rejected raw bodies; retain only field/error codes. Owner instructions are publicly intended text; explicitly tell the Owner not to enter credentials.
14. Missing mandatory registry rows is a configuration fault, not an empty configured store. GET does not seed rows or pretend every method is disabled. Legitimate no-enabled/no-eligible result is an empty list; DB/readiness-service outage is unavailable, not successful emptiness. A known unconfigured method is simply unready.

## Frontend requirements

- Extend current shell to `/admin/settings?tab=payments`, following profile/shipping navigation. Ticket `/admin/settings/payments` may be an alias but is not required. Enable this tab only when its backend is delivered; leave policies for E03-04.
- Two method cards show COD and generic online card, configured enabled state, safe readiness state and explanation. Provide Arabic/English title and instruction fields plus nullable min/max subtotal in EGP. Bounds explicitly say Subtotal, not total payable.
- Use decimal text input and exact digits-to-minor-units conversion with at most two fractional digits; blank becomes null, `0.00` becomes `"0"`. Reject extra precision/exponents/negative/overflow instead of rounding floats. Format through a verified money adapter; current shared helper alone does not establish this exact parsing behavior.
- Save per method; enablement toggle is a draft until save (no optimistic effective payment change). Disable duplicate saves during submission; only server success resets dirty state. Warn on disabling a method and explain existing attempts remain handled; when all effective options are unavailable, show explicit notice.
- Arabic RTL default, LTR isolation for IDs/money, fixed labels, visible focus, keyboard-accessible switches and inline error summary follow DESIGN/EXPERIENCE. Announce success/busy changes with status region; no success before commit. Navigation away from unsaved edits prompts before discarding.
- Notice: API credentials/webhook keys are configured by server operators and cannot be edited here. No key inputs, masked-secret fields, provider settings links with embedded tokens or sensitive readiness diagnostics.

## Validation

These are proposed endpoint-specific limits where source did not give numbers; preserve them consistently in UI/schema/DB tests.

| Field | Rule |
|---|---|
| `id` | Route enum `cod` or `online_card`; not writable. |
| `title_ar`, `title_en` | Trim, required on seed; provided edit 2–100 characters, nonempty. |
| `instructions_ar`, `instructions_en` | Trim plain text; maximum 2000 each; empty allowed to clear, non-null string. No HTML rendering. |
| `is_enabled` | Boolean only; omitted edit retains value. |
| `min_order_subtotal_minor`, `max_order_subtotal_minor` | Null or canonical decimal nonnegative integer string; 0..2147483647, matching proposed PostgreSQL integer storage; merged min ≤ max. Reject numeric JSON, decimals/exponents/signs/overflow. |
| `expected_version` | Required positive integer; omitted/invalid 422, stale 409. |
| Whole PUT | Strict writable allowlist; at least one config field; reject currency/actor/timestamps/provider/secret/readiness keys, arrays, null body or empty edits. |

Reuse bounded JSON parser/error envelope; defaulting applies only to seeds, never resets absent partial-edit fields. Currency/scale on internal quote context must match EGP/2; reject mismatches rather than comparing differently scaled values.

## Authentication and backend requirements

Logical `settings.read` and `settings.manage` are Owner-only in existing E02 policy; map to centralized policy representation rather than creating duplicate grant names. Resolve current staff session/expiry/account/roles on every request. No/expired/invalid staff context is 401; valid non-Owner staff is 403; customer authentication does not authorize admin. Mutations require session-bound CSRF and trusted Origin/provenance per E02, never client role/actor headers.

Add contracts/application/persistence inside `src/modules/content/settings/`; proposed application service `payment-settings.ts` reuses transactions, audit and API helpers. HTTP adapters only validate/authenticate/map results. Define typed server-owned readiness input/provider port; inject a deterministic unconfigured implementation until the approved integration supplies one. Never import provider SDK/session/DB into a client bundle.

Public metadata and checkout DTOs use allowlists independent from admin config. No raw DB row serialization. Internal eligibility result provides selected method ID, config version and safe title/instructions for snapshot handoff, or safe exclusion reason. Pricing owns Subtotal, payments owns execution, checkout coordinates transactions; no settings command writes attempts or changes statuses.

## Loading, empty and failure states

| State | Required behavior |
|---|---|
| Initial loading | Skeleton/status; save disabled until config, versions and CSRF are available. |
| Disabled/unready | Visible distinction and safe explanation; not a load failure or Paid state. |
| All methods disabled/unready | Explicit no-payment warning for Owner; shopper has no selectable option and clear next step. |
| Optional blank instructions/bounds | Valid empty/no-limit state; no fake zero. |
| Missing registry/load outage | Retry/configuration-error panel, not an empty list or a form that overwrites defaults. |
| Validation failure | Inline details and summary, preserve valid draft, focus errors. |
| Saving | Busy per-card state and duplicate-submit prevention. |
| Stale config | Explain conflict, refetch and require explicit review/reapply, no overwrite. |
| Save network timeout | Outcome unknown; reconcile GET/version before retry; no false success. |
| Forbidden/session expired | Stop writes; deny/login guidance; no token storage for recovery. |
| Quote loses eligibility | Preserve checkout data, clear invalid selection with explanation and present current options; no forced alternative. |
| Dependency failure | Unavailable/retry distinct from enabled=false or subtotal ineligible. |
