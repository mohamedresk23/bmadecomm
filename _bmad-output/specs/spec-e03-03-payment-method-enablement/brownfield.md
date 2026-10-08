# Current project, database and dependencies

## Repository evidence — 2026-10-08

| Path | Current state and implication |
|---|---|
| `src/db/schema.ts`, `src/db/migrations/meta/_journal.json` | No payment config or payment attempt tables; migrations through 0011 shipping. Add a new registered migration, do not rewrite 0010/0011 or assume broad Epic 03 tables exist. |
| `src/modules/content/settings/` | Profile/shipping contracts/services exist; no payment settings service/contract found. Follow existing module ownership while meeting strict target rules. |
| `src/app/admin/settings/page.tsx` | Profile/shipping query tabs implemented; payments displayed unavailable. Add payments query-tab support rather than replacing current navigation. |
| `src/modules/content/settings/contracts/store-profile.ts` | Existing public enabled_payment_methods array has safe id/title/optional instructions shape. Preserve this shape. |
| `src/modules/content/settings/application/store-settings.ts` | Public query currently returns enabled_payment_methods as [] placeholder. Replace through settings read contract; no duplicate copy of payment filtering. |
| `src/modules/content/settings/infrastructure/admin-auth.ts` | Live staff Owner/CSRF helper exists; present different Origin denied. Reuse E02 provenance semantics and require trusted context; no actor/role supplied by browser. |
| `src/shared/api/*`, `src/shared/authz/audit.ts`, `src/db/tx.ts` | Error/body/correlation, append-only audit and transaction primitives exist. One correlation ID must reach audit and response. |
| `src/shared/money/money.ts` | Helper currently accepts numeric integers and multiplication rounds binary-float values; it does not supply exact decimal-input parsing or string DTO safety by itself. Bound exact integer operations and tested conversion adapter required. |

Existing E03-01 EGP-only decision applies here. The broader Epic 03 spec's gateway naming examples do not select a provider; its numeric money examples yield to AD-4 string JSON convention. Ticket both-enabled seed remains configured state, not evidence of production readiness. E03-03 route/form code is absent, so new contracts can use version guards/string bounds from first release without the E03-02 legacy-money rollout.

## Database target

Create `payment_method_configs` owned by content/settings in one additive migration:

| Column | Proposed representation / invariant |
|---|---|
| id | Text PK, CHECK/enum only cod or online_card; exactly two provisioned rows. |
| title_ar, title_en | Non-null text; 2–100 after trimming through service; seed safe generic text. |
| instructions_ar, instructions_en | Non-null text default empty; maximum 2000 validated. |
| is_enabled | Non-null boolean. Seed true for both as authored ticket; explicitly set rather than infer live readiness. |
| min_order_subtotal_minor, max_order_subtotal_minor | Nullable PostgreSQL integer, CHECK ≥0 and min≤max when both not null; null unbounded. |
| version | Integer NOT NULL DEFAULT 1, CHECK positive. |
| updated_at | timestamptz NOT NULL DEFAULT now(), API UTC ISO8601. |
| updated_by | Nullable opaque staff actor following current audit/settings identity convention; no credential data. |

No provider key, merchant credential, webhook token, card data or readiness boolean stored in this table. Currency inherited from locked store settings; DTO reports EGP/2. PK lookup is sufficient for two rows, no search/index/paging infrastructure. Audit uses existing audit_events and immutable writer, not a new log table. Migration/provisioning creates rows; GET never writes.

Row version tracks mutable config, not append-only tax/operational policies. Checkout retains its creation-time payment/config version and safe values in its own immutable snapshot contract; this story does not introduce payment_attempts/orders tables merely to claim downstream integration. Where historical rendering needs copy, checkout must snapshot that copy instead of reloading a mutable current version row.

## Migration and backward compatibility

1. Check actual migration journal/head, choose next available new migration ID and register it through existing tooling. Inspect whether another branch/deployment already introduced payment configs; reconcile rather than duplicate tables/IDs. No migration is executed in this spec task.
2. Expand schema and provision two rows once; do not overwrite Owner changes on later deployments. Generic development titles/instructions are not approved business promises. Thresholds default null; real limits/copy/readiness are deployment gates.
3. Deploy schema and service/ready-safe public adapter before enabling new payments tab. New admin PUT requires version from its first release; unknown client fields rejected. If deployment rolls frontend independently, hide tab until matching API exists.
4. Preserve public profile response keys and method metadata shape; consumers must treat the former empty placeholder as now data-driven and still apply checkout eligibility. Public and admin responses no-store; no credentials leak through cache. New admin money bounds are strings; no undocumented numeric compatibility required for a nonexistent payment endpoint.
5. Old public application can continue returning [] during a rollback but cannot represent a payment-enabled release; do not declare operational readiness under that revision. New checkout requires the service contract and registry, so coordinate rollback across consumers. Keep table/config/audit data; no destructive down migration or attempt deletion.
6. Verify upgrade on populated profile/shipping fixture and compatible application rollback. Do not claim schema rollback repairs a provider attempt. Production readiness remains false until approved provider/COD operations exist; seed true cannot bypass this.

## Dependencies and release gates

- **E03-01:** EGP-only store context, locale/public metadata and Owner settings shell. Read its kernel plus companions. No direct dependency on shipping completion or media upload.
- **F00-01/02/03/04:** framework, migrations/transactions, strict API/body/error/correlation, Owner authorization/audit. **E02-01/02:** staff authentication/revocation/CSRF/Origin.
- **Pricing E08:** authoritative Subtotal, currency/scale and tax-inclusive price semantics; settings does not calculate amounts.
- **Checkout E10:** effective-method list, selected-method lock/revalidation and immutable snapshot creation, quote-change recovery. Combined integration proves direct API bypass rejection; shipping-only stories do not prove payment acceptance.
- **Online payments E11:** approved server readiness contract/provider and new-attempt retry policy (OQ-PAY-01/02); trusted reconciliation must continue when config disables future selection. **COD/fulfillment E13** owns collection; **refunds E14** own reimbursement.
- **E03-04:** confirmation/TTL policies remain separately versioned; payment toggle does not change them.
- No live provider lookup, credentials, deployment or financial action is needed to write this spec. PRD OQ-02/04 remains explicit launch gate; EGP was already user-resolved. Do not invent a provider, COD policy or automatic cancellation rule.
- Any future Next.js code change must first read relevant installed documentation under `node_modules/next/dist/docs/` as AGENTS.md requires. No framework code written here.
