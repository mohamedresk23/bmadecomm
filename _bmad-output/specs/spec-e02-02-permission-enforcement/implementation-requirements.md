# Implementation requirements

## Objective, scope and business rules

Implement the E02-02 foundation for CAP-1–3 under explicitly approved matrix v2/A1 and the user's binding clarifications: live authorization, repeatable role-permission seeds, actual-key nested field projection and a development/test-only protected reference endpoint. Reuse F00-04 primitives and verified E02-01 authentication. Protect existing consumers without creating later business features. PRD FR-06/07, §8, AC-13; story E02-02; AD-1/2/9/12.

Authorize a specific action against its resource before reading protected content or executing effects. Unknown permissions, absent grants, invalid staff context and unavailable authoritative lookups cannot grant access. Derive identity from server session state, never a client-supplied actor, role or permissions array. Authenticate again on each entry point, including server rendering and Server Actions if used; a navigation or Proxy result is insufficient.

Committed revocation or disable must affect the next request, including requests handled by another application instance. Source documents do not promise retroactive cancellation of commands already authorized before revocation commits. Do not claim a middleware lookup eliminates every in-flight race.

## Baseline role constraints

The following preserves PRD §8.1; exact keys/fields and union semantics were explicitly approved in matrix v2 on 2026-10-07. Owner access never overrides domain invariants/history. Refer to the approved matrix and build spec for actual leaf allowlists. refund_operator requires a currently assigned Owner/Manager and orders.read plus fresh MFA; removing Manager blocks the next refund.

| Role | Baseline capabilities | Restricted without explicit authorization |
|---|---|---|
| Store Owner | Functions, roles, settings, audit | Financial invariant bypass or history deletion |
| Store Manager | Catalog, inventory, customers, orders, coupons, basic reports | Role grants, secrets; refunds without `orders.refund` |
| Warehouse | Fulfillment data, preparation/shipping transitions, reasoned inventory movements | Refunds, grants, prices, cost, financial reports |
| Customer Support | Support/customer/order data, notes and request/cancellation within policy | Inventory, prices, refunds, grants |
| Marketing | Coupons, content, permitted marketing reports | Payment, refunds, inventory, unnecessary personal data |
| Customer | Own customer resources | Administrative resources or another customer's resources |
| Guest | Catalog, own cart, one order with restricted proof | Administrative access, account/order lists, ownership inferred from order number |

Customers/guests remain excluded. The user approves union of current explicit role grants without explicit-deny records, enumerated registry keys, default Support price/payment-detail masking and all-role secret prohibition. Granting a supplemental role never substitutes for a current qualifying refund base role. Approval does not create later business endpoints or arbitrary permission editors.

## Backend requirements

Identity APIs resolve active staff and current PostgreSQL grants. Check session revocation/expiry, enabled MFA-enrolled staff identity, action/resource and actual allowed DTO leaves. E02-01 implements the approved password+TOTP lifecycle, 30-minute idle/12-hour absolute expiry and 15-minute sensitive freshness. Never reset aggregate MFA budgets by issuing another challenge.

Keep HTTP and framework code in adapters, identity/grant persistence in identity infrastructure, and enforcement/projection available to application consumers. Adapt existing `requirePermission`, `requireOwnership` and `redactFields` rather than creating an independent policy system. The current shallow projection is not sufficient proof for nested DTOs: every serialized object and array must contain only explicitly allowed fields. Never serialize a database entity and then hide it with CSS.

For denied commands, do not change resource state, inventory, money, grants or business outbox effects. A sanitized operational denial record is distinct from a successful business audit event; neither credentials nor hidden DTO values belong in logs. Use existing transaction and append-only audit facilities for authorized grant changes when consumed by E02-03, without adding that management feature here. FR-07/45; AD-9/15/16.

Database errors must fail closed with safe dependency/error handling. No fallback to stale grants, supplied roles or owner shortcuts is permitted. No permission decisions or staff DTOs in cross-request/shared cache. AD-12.

## Frontend requirements and states

This story owns BE/DB; frontend requirements describe integration with E02-01 and downstream consumers, not a new routing system. Existing navigation, actions and sensitive columns follow the current server-authorized view. Direct access shows generic denial without resource details or sensitive first-render content. Preserve permitted navigation; do not interpret denial of one resource as a mandate to block the entire shell. UX-07; EXPERIENCE states and TF-6; DESIGN Navigation/DataTable/StatePanel/SessionNotice.

| State | Consumer behavior |
|---|---|
| Loading/refresh | Announce loading without flashing protected content or fabricated zero values |
| Empty | Show permitted empty data distinctly from denied access; do not substitute empty data for an authorization failure |
| Permission denied | Safe generic message, no protected resource details or side effects |
| Expired/revoked session | Suspend protected action and use existing safe sign-in/session notice |
| Read/dependency failure | Safe failure and supported reread; no stale privileged fallback |
| Allowed response with omitted fields | Render only authorized fields; responsive/mobile alternatives must not restore hidden values |

Maintain keyboard access, visible focus, perceivable status/error text and approved language direction. No new branding, staff screen, global interceptor or client role store is required. NFR-08/09; AD-11.

## Database changes and validation

Inspect E02-01's delivered schema first. Reuse its roles, permissions and user-role tables where present; introduce only missing additive relations. A role-permission relation is needed, but its final name and physical schema must agree with that prerequisite. Expected constraints are unique role/permission keys, unique relationship pairs, valid foreign keys to identity records, and indexes supporting live grant lookup. Use `src/db/schema.ts`, sequential `src/db/migrations/` and Drizzle metadata conventions; do not overwrite historical migrations.

Seed approved definitions/links transactionally with an initial-version marker. Do not assign existing customers, install credentials, erase explicit grants or resurrect revoked mappings on routine reruns. Test deliberate later reconciliation separately; missing role/unknown permission never implies Owner access. PRD FR-06/07, NFR-14; AD-16.

All HTTP inputs use runtime schemas and reject unknown writable fields. Action names and field selections are server allowlists; clients cannot submit trusted permissions, actors or SQL column names. Resolve resource identifiers within authorized scope; apply domain state/version rules in their owning modules. DB uniqueness/FKs are the last persistence defense. FR-58; AD-10.

## Dependencies, migration and backward compatibility

Direct dependency: E02-01. Foundation dependencies: F00-04 authorization/audit, F00-02 transaction/migrations, F00-03 runtime DTO/error contracts. Existing code uses Next.js 16.3.8, TypeScript, PostgreSQL, Drizzle, Zod and Vitest; these conventions supersede the planning document's historical assertion that no application exists.

The separately authorized E02-01 independent stage now adds staff sessions/accounts and role definitions/memberships in migration 0007, with real session/cookie helpers. Its login/MFA/provisioning/shell stage remains pending; do not treat these primitives as a completed authentication integration. Preserve customer registration, verification and `users.role='customer'`; never translate that legacy role field into staff authority. Keep F00-04 unit test contexts as fixtures, but production adapters must obtain contexts from trusted server state. Existing media routes still accept `x-mock-user`; replace that production trust source when wiring E02-02 and adapt tests without keeping a header bypass.

Use additive migrations and test upgrade through both stories, seed twice, failure rollback and a rollback path that never re-enables mock-header authority. Nested errors remain approved. Matrix/auth decisions are now approved; production email/operator/retention setup remains separate. Full E02-01 verification is still required before E02-02 code starts.
