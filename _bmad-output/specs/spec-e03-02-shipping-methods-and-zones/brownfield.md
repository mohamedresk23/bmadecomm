# Current implementation, database and rollout

## Current project evidence — 2026-10-08

| Repository path | Observation / target gap |
|---|---|
| `src/modules/content/settings/contracts/shipping.ts` | Catalog of 27 governorates and explicit aliases exists; names 2–100, nonnegative costs/day ranges. Country accepts any two characters; unknown keys stripped; numeric cost DTO; partial range validated only when both bounds supplied. Tighten effective validation and domestic configuration. |
| `src/modules/content/settings/application/shipping.ts` | CRUD/audit, per-resource row locks and eligibility exist. Exclusivity scan is not serialized across different/new zones; country ignored by eligibility; rate formatted using hardcoded EGP; no versions; zone delete cascades methods without reference guard. |
| `src/app/api/v1/admin/settings/shipping/{zones,methods}/...` | Owner/session/CSRF adapters and GET/POST/PUT/DELETE exist. Preserve envelopes; consolidate request correlation rather than generating audit-only IDs. |
| `src/modules/content/settings/infrastructure/admin-auth.ts` | Resolves staff live session; denies non-Owners; checks session CSRF and a present different Origin. Complete provenance behavior according to E02 conventions, no per-route weakening. |
| `src/app/api/v1/store/shipping/check-eligibility/route.ts` | Public read-only query with current DTO and private/no-cache; target no-store and correct country semantics. |
| `src/app/admin/settings/{page,shipping-manager}.tsx` | Query-tab UI, governorate forms, method forms and delete confirmation exist. Price currently uses parseFloat/Math.round; replace through exact conversion during implementation. |
| `src/db/migrations/0011_shipping_zones_and_methods.sql`, `src/db/schema.ts` | JSONB memberships, integer rate, zone-method FK cascade, rate/range checks, zone lookup index and seeded three zones/four methods exist. Do not create these again. |
| Existing `shipping.test.ts`, route/component tests | Useful baseline tests exist; no test execution or pass claimed in this spec task. Real PostgreSQL concurrency remains necessary. |

Architecture documents described a greenfield project; current source is now the brownfield baseline. Tickets propose `/admin/settings/shipping`; actual `/admin/settings?tab=shipping` remains canonical. The broader Epic 03 spec's unconditional cascade and numeric money examples are reconciled here with AD-4 retention and AD-4/10 string money conventions. No upstream document was modified.

## Database target

Reuse `shipping_zones`: opaque text PK, Arabic/English names, EG country, canonical governorates JSONB array, active flag, UTC created/updated timestamps. Reuse `shipping_methods`: opaque text PK, zone FK, bilingual names, integer `cost_minor`, integer min/max days, active flag and UTC timestamps. Keep existing zone index and money/range checks.

Add via new registered migration (not a rewrite of 0011): positive `version` default 1 on both resources, nonnegative day CHECKs and domestic-country CHECK after data reconciliation, and dedicated singleton shipping mutation guard. Retain JSONB storage; service validation plus a guard shared by **all** shipping writers enforces cross-row exclusivity. A row-wise CHECK on JSONB does not solve cross-zone concurrency. DB write privileges must prevent alternate unguarded writers; any administrative maintenance must obey the protocol. No new financial/policy/payment table is included.

Backfill versions without resetting rates, flags or memberships. Inspect active overlap, non-EG values, invalid JSON/codes/negative days before tightening constraints; report conflicts for Owner reconciliation, never silently reassign coverage. Keep numeric DB representation within PostgreSQL integer capacity; target string serialization does not require converting stored amounts.

Referenced deletion checks are an orders/quote-owned contract executed under the shared guard. No production orders/quotes table currently exists in schema; do not invent one to make the shipping story look complete. Before orders ships, unreferenced deletion can work; integration acceptance requires durable references that participate in the same guard. Order creation acquires the guard before selecting/snapshotting shipping; quote retention/cleanup uses it before removing reference protection. Existing order snapshots have no cascade path from shipping deletion. If a future FK conflicts with the current method cascade, migrate to retention-safe behavior before enabling financial usage.

Zone version also advances when a child method is created/updated/deleted so a stale zone-delete precondition detects changed children. Method mutation returns its own version; UI refetches parent metadata after success. This is a target proposed aggregation convention, not current behavior.

## Migration and backward compatibility

1. Preserve registered 0010/0011, existing IDs and seeded/deployed data. Shipping seed currently covers all 27 governorates, including border regions, and illustrative 50/65/85 EGP methods; OQ-SHIP-01 must approve production terms. No seed rerun overwrites Owner edits.
2. Expand schema with versions/guard/checks after preflight; deploy guarded writers and compatible readers. Coordinate all callers before relying on serialization; mixed guarded/unguarded writers cannot guarantee uniqueness.
3. Current v1 DTO uses numeric `cost_minor`; target uses string money. Do not silently change its type for deployed consumers. Resolve OQ-SHIP-02 with either a coordinated all-consumer upgrade or a separate versioned adapter; retain numeric v1 compatibility until clients migrate. Any numeric adapter accepts only bounded exact integers and never performs binary-float pricing. Target examples apply after that gate, not retroactively to unmodified clients.
4. Add version to reads; upgrade form/clients to send expected_version and DELETE If-Match. Enforce omission rejection only after coordinated upgrade. Final acceptance requires every writer's version guard; log any transitional gap rather than calling it complete.
5. Rollback retains additive schema/data/audit, using a compatible guarded revision; do not roll back to unsafe unguarded writers after financial use. Test populated upgrade and compatible rollback. No destructive financial cleanup or automatic EGP conversion.

## Dependencies

- E03-01: EGP launch identity, store timezone and safe typed settings; consume its kernel/companions.
- F00-01/02/03/04: framework, registered DB migrations/transactions, bounded JSON/error/correlation, authorization/audit. E02-01/02: current Owner session, revocation, CSRF/Origin. Media upload is not a direct dependency for shipping.
- Cart/pricing/checkout (E08/E09/E10): authoritative eligibility, quote change review, snapshot creation, shared lock order and reference-retention contract before combined acceptance. Fulfillment consumes retained order snapshots, not latest method cost.
- No carrier/payment SDK needed. Production geography/rates under OQ-SHIP-01; rollout under OQ-SHIP-02. Existing PRD OQ-02/04 shipping operation gates remain; do not invent a carrier or postal policy.
- Before any future Next.js code change, read the relevant installed guide in `node_modules/next/dist/docs/` as AGENTS.md requires. This documentation run edits no framework code.
