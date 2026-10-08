# Requirements and business rules

## Objective and scope

Deliver A-13 shipping administration plus a reusable server-side eligibility contract. Scope covers zone/method CRUD, safe removal, toggles, exact rates, transit ranges, active governorate exclusivity, public eligibility, audit, strict validation, permissions, migration and meaningful UI states. Preserve profile/shipping navigation and sibling settings. Checkout integration is a dependent acceptance gate, not code to build in this documentation task.

## Business rules and edge cases

1. Zone configuration country is `EG` only. Normalize country uppercase. A well-formed foreign-country eligibility query returns ineligible even if its governorate text resembles Cairo. Never ignore country.
2. Store canonical codes from the current 27-item `EGYPT_GOVERNORATES` catalog; each zone has 1–27 unique governorates. Admin input uses canonical codes; public matching retains current case/spacing normalization, Arabic/English names and fixed aliases (`sharkia`, `menofia`, `assiut`, `fayoum`, `qaliubiya`). Unknown locations are ineligible, not fuzzy matched to a convenient zone.
3. At most one active zone covers a governorate. Inactive zones may overlap; activation validates the effective full governorate set. Editing a zone excludes itself from overlap checking. Disable releases coverage for new eligibility decisions but does not delete historical records. If corrupt legacy data still yields multiple active matches, fail as a configuration error, never select an arbitrary first zone.
4. Serialize all zone create/update/delete/activation commands using one dedicated shipping guard row. Lock that guard before zone/method rows (IDs sorted where multiple). An unlocked scan or a lock on only the edited zone cannot prevent two concurrent new zones claiming Cairo.
5. Method belongs to an existing zone; moving it between zones is outside the update contract. An active method under an inactive zone is retained but never eligible. A serviced zone with no active methods is ineligible. A selected ID belonging to another zone, disabled, removed or nonexistent is ineligible; do not accept merely because another method is available.
6. Use EGP exponent 2; cost is nonnegative exact integer minor units. Zero is a legitimate free method. Rate is base shipping charge, not a tax-inclusive total; pricing policy owns tax/discount allocation. Estimated day bounds are nonnegative integers with min ≤ max; equality is allowed but zero does not authorize a same-day marketing promise.
7. PUT currently has partial semantics; preserve them. Merge input with stored values before validating range and eligibility invariants, including a one-sided transit edit. Empty updates and unknown keys are rejected. Actor/resource IDs, audit data and currency come from the server.
8. Each mutable resource has a positive version. Update/delete compares expected version under lock; accepted update increments once. Old versions conflict without audit/profile mutation. Creating a method locks its parent so zone removal cannot race it.
9. Safe deletion: unreferenced resources may be hard deleted. A zone or any child method referenced by an Order or retained quote is `409 SHIPPING_RESOURCE_IN_USE`; tell the Owner to disable it. No financial-record cascade. Deleting an unreferenced zone removes its unreferenced methods atomically and records their safe IDs/configuration in the deletion audit. This refines the ticket's unconditional cascade requirement to preserve AD-4/FR-55.
10. Existing orders and payment attempts retain shipping labels, method reference, address and exact amount snapshots. Never reprice them. A quote for a new order must revalidate latest eligibility/rate at submission; changes require explicit review, not silent acceptance of an old total. A previously committed order does not become invalid because its method is subsequently disabled.
11. Eligibility reads use a consistent view. Final checkout validation and snapshot creation use the shipping guard in their transaction so disable/rate-edit cannot commit between validation and order snapshot. Checkout must establish a shared lock order compatible with idempotency/inventory/coupon locks (AD-3); no external network calls while holding locks. Standalone public eligibility does not reserve or guarantee a rate.
12. Audit successful zone/method create/update/delete actions inside the DB transaction with authenticated actor, safe before/after diff, time/resource and the same request ID used by the response. Failure to write audit rolls back. No address payload, contact PII, CSRF or credentials in audit/logs.
13. POST create is not implicitly idempotent. Disable repeat submission in UI; after timeout reconcile list before another POST, do not blind-retry or claim a new resource exists. No uniqueness of display names is imposed by this story.

## Frontend

Use `/admin/settings?tab=shipping`; no requirement to add the ticket-only `/admin/settings/shipping` route. Display zones, governorate counts, active state, and per-zone method tables with exact formatted EGP costs, transit estimates and active state. Keep profile available; do not implement payment/policy tabs.

Zone create/edit modal has Arabic/English names and a 27-governorate checklist. Annotate governorates owned by another active zone. Active-zone form prevents choosing them; inactive drafts may select overlapping governorates with a clear warning that activation can fail. Own assignments stay selectable. Method modal includes bilingual names, price in EGP and min/max days; inline toggles save through the same guarded command.

Convert the decimal price text to minor units using exact digits (at most two fractional places), not `parseFloat` and multiplication/rounding. Format integers via shared money helpers. Show free cost correctly; do not derive financial amounts from formatted text.

Arabic RTL, logical layout, visible keyboard focus and LTR isolation for IDs/money follow DESIGN/EXPERIENCE. Modal has title, focus containment, Escape/cancel before submission and focus restoration. Errors have field association and an accessible summary; success/busy state is announced. Delete confirmation names the resource and zone's child-method impact; referenced-resource conflict offers disable instead. No optimistic rate/coverage changes or success before server commit.

## Loading, empty and failure states

| State | Behavior |
|---|---|
| Initial load | Busy/skeleton state; no mutation until settings and CSRF loaded. |
| No zones | Empty explanation and Owner create-zone CTA; public query is ineligible. |
| Zone has no methods | Empty method section and create-method CTA; public query is ineligible. |
| Disabled zone/method | Explicit status; child active state does not imply zone eligibility. |
| Save/delete pending | Disable duplicate action; preserve current values until result. |
| Validation/overlap error | Inline field detail and summary; keep draft, refresh assignment notes without silently clearing selection. |
| Stale conflict | Reload authoritative version and ask for explicit review/resubmission. |
| Referenced deletion | Retain item and offer disable; do not report successful deletion. |
| Load/server/network failure | Retry panel, not an empty list; retain safe loaded data with stale notice and prohibit unsafe submission. |
| Mutation timeout | Outcome unknown; reconcile by GET before retrying; especially no automatic duplicate POST. |
| Session expired/revoked | Stop editing; login guidance, no token persistence. |
| Forbidden | Access-denied panel without settings payload. |
| Public no service | Localized repair explanation and no available methods; preserve checkout address inputs. |
| Public dependency failure | Unavailable/retry state distinct from a business ineligible result. |

## Backend validation and permissions

Typed contracts under `src/modules/content/settings/contracts/`, application-owned commands/queries under `application/`, persistence/auth infrastructure adapters; thin App Router endpoints. Export a transaction-aware eligibility function returning selected method identity and exact cost to pricing/checkout. Do not call this server contract through internal HTTP or expose DB entities to UI.

| Input | Rule |
|---|---|
| Zone/method names | Trim; both languages required on create; each 2–100 characters; provided edit values obey same bounds. |
| Admin country | `EG` after uppercase normalization; immutable domestic launch scope. |
| Governorates | 1–27 canonical unique codes; reject null/duplicates/unknown. Active exclusivity rechecked under guard. |
| IDs | Nonempty opaque resource strings; parent exists; reject path/actor injection. Proposed boundary max 128 characters, covers current IDs. |
| Rate | Target canonical decimal integer string, 0..2147483647 (existing PostgreSQL integer range); reject fractions, negatives, scientific notation and overflow. |
| Days | Integer 0..2147483647; compare merged min/max; service promises require OQ-SHIP-01 approval. |
| Active | Boolean, default true only on create; do not reset omitted edit fields. |
| Version | Positive integer; required update/delete after rollout. |
| Public country | Two uppercase ASCII letters after normalization, default EG if omitted. |
| Public governorate | Trim; required; proposed max 100; normalize via fixed catalog/aliases; unknown yields ineligible. |
| Public city/postcode | Optional strings, proposed max 100/20; presently informational; no implicit postcode requirement. |
| Public method ID | Optional nonempty opaque ID ≤128; if supplied, must be eligible for destination. |

Reject unknown writable keys and empty edits using strict runtime schemas. Reuse bounded JSON parser and safe error helpers. Logical permissions `settings.read`/`settings.manage` map to existing centralized role policy; do not invent a second grants system. Owner only. No/invalid/expired staff session is 401; valid non-Owner staff is 403; customer login never authorizes admin. Recheck revocation every request. Mutation requires session-bound CSRF and trusted Origin/provenance according to current E02 conventions. Public read-only eligibility requires no session/CSRF and exposes no private configuration.
