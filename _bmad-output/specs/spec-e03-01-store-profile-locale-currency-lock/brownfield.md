# Current context, dependencies and migrations

Snapshot inspected on 2026-10-08. Do not treat existing tests or source comments as verified acceptance evidence; no application tests ran in this documentation task.

## Existing implementation

| Evidence path relative to repository | Observed behavior and implication |
|---|---|
| `src/modules/content/settings/contracts/store-profile.ts` | Profile/admin/public DTOs exist. Writable schema permits EGP/USD/EUR/SAR/AED/GBP, defaults missing locale/currency fields, strips unknown keys, and accepts any nonempty timezone. Reconcile with strict launch/domain validation. |
| `src/modules/content/settings/application/store-settings.ts` | Updates use singleton row lock and in-transaction audit. `checkOrdersExist` tolerates an absent orders table. It does not establish shared first-order synchronization or stale-write protection. GET currently seeds a missing singleton; target reads must not mutate. |
| Same service + `src/lib/media/*` | Logo publication currently calls storage within the DB transaction and constructs `/uploads/{filename}`. Target must use verified ready media through its owner, outside the settings lock. Keep DTO URL compatibility or an explicit redirect/storage rollout. |
| `src/app/api/v1/admin/settings/profile/route.ts` | Live Owner sessions and PUT CSRF checks exist. Audit request ID is created separately in PUT; use shared correlation. Origin checking currently rejects a different present Origin; complete trust-policy coverage with E02 conventions. |
| `src/app/api/v1/store/settings/public/route.ts` | Public endpoint exists with allowlisted metadata; preserve safe DTO keys. |
| `src/app/api/media/upload/route.ts` | Upload endpoint exists outside `/api/v1`; currently reads client `x-mock-user` before staff context. This is a security gap: test identities must not authorize production upload. Cookie upload currently lacks CSRF/Origin enforcement. |
| `src/app/admin/settings/page.tsx`, `profile-form.tsx` | Query-tab profile/shipping UI and profile tests exist. Profile fetch uses no-store; inspect against required dirty/loading/error/locked states, do not assume full UX acceptance. |
| `src/db/schema.ts`, `src/db/migrations/0010_store_settings.sql` | Singleton CHECK, media FK and seed exist. `updated_at`/`created_at` are timestamptz. No profile version column or orders declaration currently exists. |
| `src/db/migrations/meta/_journal.json` | Entries through `0011_shipping_zones_and_methods` are registered; do not recreate or renumber historical migrations. |
| `package.json`, `docs/staff-access.md`, `docs/staff-session-foundation.md` | Next 16.3.8, React 19, Drizzle/PostgreSQL, Zod and Vitest/Testing Library foundations exist; current staff identity is the authentication dependency. |

## Database target

Reuse `store_settings` with singleton text PK `id='default'`. Required fields are store name, support email/phone, locale, currency/symbol/exponent, timezone/date format/prefix; nullable legal name/address/logo reference/updated actor. Logo FK currently uses `ON DELETE SET NULL`; protect referenced assets through the media lifecycle rather than deleting them on replacement. Retain existing timestamp columns and UTC semantics. Reuse append-only `audit_events`; no separate audit table.

Target additive migration: positive integer `version NOT NULL DEFAULT 1` with a positive CHECK; accepted mutation uses version comparison and increments under the singleton lock. Keep currency/symbol/exponent consistent through service validation; any DB currency constraint must first inspect actual stored data. No migration or SQL is executed in this task.

Do not add shipping, payment or policy tables in this story. Do not create a placeholder production orders table merely for the currency test. Before checkout exists, absence of orders is valid only for the documented pre-orders deployment stage. Once orders ship, registry/schema mismatch is a configuration failure, not an excuse to report unlocked currency. Integration tests can supply an isolated orders fixture, while the checkout-owned shared guard remains its integration dependency.

## Rollout and backward compatibility

1. Inspect deployed settings/migration history and actual currency/media values. If a non-EGP trading store already exists, block launch and obtain an explicit migration decision; never relabel prices or silently force EGP.
2. Apply additive version migration, preserving existing profile/media/audit records and `0010/0011`. Seed once through migration/provisioning only, using approved deployment values. Existing example company/contact data is not approved production identity.
3. Ship compatible GET readers and updated form carrying version; inventory any other PUT clients. Resolve OQ-02 before strict `expected_version` enforcement. If overlap is required, document a short transition window and its risk; final acceptance requires stale-write rejection for all clients.
4. Maintain current success response shapes, public allowlist, upload route and query-tab links. Do not remove `enabled_payment_methods` or regress shipping. Alternate-currency writes intentionally cease to be supported following the user's launch decision; reads of legacy values must remain diagnosable until migration approval.
5. Roll back application releases using compatible readers/writers; retain the additive column and all data. No destructive down migration, order rewrite or audit deletion. Verify upgrade on a populated fixture and rollback to a compatible revision.

## Dependencies

| Dependency | Required contract |
|---|---|
| F00-01 | Existing project/runtime; implementation must read relevant installed Next.js guides under `node_modules/next/dist/docs/` before changing Next code, as AGENTS.md requires. |
| F00-02 | Registered additive migrations, real PostgreSQL transactions and isolated test DB. |
| F00-03 | Bounded JSON, DTO schemas, safe error envelope and correlation. |
| F00-04; E02-01/02 | Live staff sessions, Owner settings permissions, revocation, CSRF/Origin and append-only audit writer. |
| F00-07 | Trusted upload, actual image validation, ready/public media contract and reference-aware retention. |
| E03-02/03/04 | Consume settings through application contracts; owned shipping/payment/policy behavior remains outside this slice. |
| Catalog/pricing/checkout/orders | Read authoritative currency/presentation via settings contract; snapshot money independently; first-order writer shares the currency guard before release. |

No new provider credentials, carrier SDK, payment gateway or deployment is required for this specification. OQ-01/A-01 market/locale choices and production identity remain source gates except EGP, which the user resolved. OQ-03 tax policy is preserved as a sibling financial gate, not invented in the profile story.
