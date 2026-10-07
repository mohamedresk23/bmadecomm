# Epic 02 permission matrix v2 — approved

Derived from PRD §8.1, FR-06/07, AC-13 and architecture AD-9. Explicitly approved by the user on 2026-10-07 with the binding rules below. No customer or guest receives any administrative grant. A check for an undefined permission always denies.

## Binding approval rules

- refund_operator is supplemental only: every orders.refund check requires a current Owner or Manager role AND orders.read AND orders.refund, plus resource/domain invariants and MFA freshness. Removing Manager from a refund_operator holder blocks the very next refund request, even if that supplemental role remains.
- Translate categories into explicit actual-key/path DTO allowlists, including nested objects/arrays. New/unclassified keys are absent by default. Test success/error serialization and any in-scope export; no export feature is added just to test it.
- Default Support cannot read administrative prices or payment details; it may read payment status only. Union of explicit current-role grants applies, while global secret/account/resource restrictions always win.
- No secrets in ordinary DTOs, logs, error details or export for any role, including Owner. Restricted MFA enrollment and one-time code-display flows are not ordinary business DTOs.

## Action grants

O = Store Owner; M = Store Manager; W = Warehouse; S = Customer Support; K = Marketing. An omitted role is denied unless it has another role with an explicit approved grant. Permission is necessary but does not bypass resource scope, state, financial invariants or CSRF.

| Exact key(s) | Default roles | Resource/action scope |
|---|---|---|
| `admin.dashboard.read` | O, M | Permitted dashboard projections only |
| `catalog.read`, `catalog.manage`, `media:upload` | O, M | Catalog read/manage and existing media upload/publish |
| `inventory.read`, `inventory.adjust` | O, M, W | Inventory; adjustment still requires reason and domain checks |
| `orders.read` | O, M, W, S | Order data projected for role/task; not every order field |
| `orders.fulfill`, `orders.ship` | O, M, W | Authorized fulfillment transitions |
| `orders.cancel` | O, M, S | Policy-permitted cancellation only |
| `orders.refund` | O | Manager needs an explicit grant; W/S/K have none by default |
| `customers.read`, `customers.notes.write` | O, M, S | Necessary support/customer data; not all fields |
| `coupons.read`, `coupons.manage` | O, M, K | Coupons subject to domain rules |
| `content.read`, `content.manage` | O, K | Storefront content; Manager requires an explicit grant |
| `reports.basic.read` | O, M | Basic reports, no unrestricted reporting export |
| `reports.marketing.read` | O, K | Marketing reports without unnecessary PII |
| `settings.read`, `settings.manage`, `secrets.manage` | O | Store settings/secrets; secret values never returned in DTOs |
| `staff.manage`, `roles.grant`, `audit.read` | O | Staff/grants and permitted audit reads; history remains immutable |
| `admin.reference.read` | O, M, W, S, K | Development/test reference fixture only; no production endpoint |

The registry reserves future domain keys but does not implement their endpoints. Preserve the existing `media:upload` spelling for compatibility; use the exact other names above. The Owner receives enumerated registry grants, never a role-name wildcard or domain-invariant bypass.

Proposed explicit Manager refund mechanism: a supplemental role `refund_operator` grants only `orders.refund`, no fields or other actions, and is assigned deliberately by an Owner only to an existing Owner/Manager. It is never assigned by a seed. Refund commands require both `orders.read` and `orders.refund` plus domain/resource checks. This extra role is a proposal, not a named PRD role; staff assignment UI remains E02-03. No arbitrary permission editor or per-user deny system is added here.

## Field read grants

Fields still require the resource's action permission. Explicit DTO allowlists select only fields needed for that surface, even when a broader category is granted. These proposed categories give downstream contracts a common foundation; they do not create order/customer databases in this story.

| Exact field key | Default roles | Allowed category / denied examples |
|---|---|---|
| `fields.catalog.public` | O, M | Staff catalog public descriptors, SKU and selling price; no secrets |
| `fields.catalog.cost` | O, M | Cost; W/S/K do not receive it |
| `fields.orders.fulfillment` | O, M, W, S | Order reference/state/items and necessary shipping contact; not cost/payment internals |
| `fields.orders.prices` | O, M | Order selling prices/totals; W/S/K excluded pending a deliberate support exception |
| `fields.orders.payment_status` | O, M, S | Payment state only; no method, amount or transaction reference |
| `fields.orders.payment_details` | O, M | Safe method/amount/reference; no PAN/CVV/provider secrets |
| `fields.orders.internal_notes` | O, M, S | Operational/support notes; W/K excluded |
| `fields.customers.support` | O, M, S | Necessary contact/support profile data; no credential/proof/session values |
| `fields.customers.internal_notes` | O, M, S | Support notes; W/K excluded |
| `fields.reports.financial` | O, M | Basic financial aggregates; W/S/K excluded |
| `fields.reports.marketing` | O, K | Non-PII marketing aggregates |

Passwords, password hashes, MFA seeds, recovery hashes, session/proof tokens, encryption keys, raw card data and provider secrets are never serializable DTO fields for any role, including Owner. Audit diffs use the same redaction policy.

## Multiple roles, conflicts and revocation

Proposed policy: **union of explicit grants from currently assigned roles**, with no explicit-deny records in this version. A role's absence of a grant is not a veto over a grant supplied by another assigned role. For example Warehouse + Manager can read prices/cost through Manager, but cannot refund unless explicitly granted `orders.refund`; Warehouse + Owner has Owner's enumerated privileges. Assigning an additional role is therefore a deliberate privilege increase.

Mandatory global restrictions (no secrets/raw card fields, customer/guest isolation, disabled/expired/revoked sessions, resource ownership and business invariants) always override any grant. Undefined permissions and empty role memberships deny. Revoking one role removes its grants on the next request; an independently granted permission from a remaining role remains valid. Revoking all staff roles prevents admin access. Never retain role grants in a session snapshot or across requests.

Proposed authentication interaction: reductions take effect immediately without logging out remaining permitted roles; an increase of privilege revokes all affected staff sessions and requires a fresh password+MFA login before exercising increased access. Neither rule authorizes role management UI in E02-01/02; the command integration belongs to E02-03.

Role seeds create definitions and approved baseline role-permission links only; they do not assign roles to existing customers. Bootstrap provisioning is a separate protected CLI creating the first Owner deliberately. Routine seed reruns must not restore removed mappings or overwrite explicit grants; later matrix upgrades need deliberate versioned reconciliation.

## Reference DTO

Proposed harmless fixture contains a reference ID and permitted display label plus nested synthetic `catalog.cost`, `order.prices`, `order.payment_status`, `order.payment_details`, `order.internal_notes`, and an array of fulfillment items. Each sensitive subtree requires the corresponding `fields.*` key. The route uses actual staff sessions/live grants; production returns 404 before reading identity or data. No query/body/header can enable it in production.

## Explicit requirements versus proposed interpretation

Explicit: §8.1 role responsibilities/exclusions; FR-06 current revocation/disable; FR-07 default-deny action/resource/field enforcement and no denied business effect. Except `orders.refund`, exact permission keys are proposed mappings. Field categories, multi-role union, enumerated Owner grants, resource-minimal contact views, privilege-increase logout and seed reconciliation are proposed decisions, not approved by the PRD alone.

Specific clarifications requiring this proposal's approval: Manager cost visibility is not stated explicitly; Support receives payment status but not monetary price/details fields, tightening the earlier proposal to avoid an ambiguous reading of the PRD's price prohibition. Warehouse gets necessary order shipping contacts, not the full customer profile. Generic administrative audit reads are Owner-only by default; later resource audit grants may be narrower. Manager has no content grant by default; Marketing has no generic `media:upload`, since current media lacks content-versus-catalog resource separation. Content-image upload scope must be specified in its later story rather than implicitly expanding Marketing's catalog privileges. Public storefront prices remain public; these masks concern administrative DTOs. No role gains broad export rights.
