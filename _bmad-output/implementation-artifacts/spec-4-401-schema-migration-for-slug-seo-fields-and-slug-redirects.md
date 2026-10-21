---
title: 'E04-04-01: Schema migration for slug, SEO fields & slug_redirects'
type: 'feature'
created: '2026-10-20'
status: 'done'
baseline_commit: '05ea5be0bdf881989df477597fec5c3301b4570b'
route: 'dispatch'
review_loop_iteration: 0
story_key: '4-401-schema-migration-for-slug-seo-fields-and-slug-redirects'
context:
  - AGENTS.md
  - _bmad-output/specs/spec-e04-04-publish-slug-redirects-and-seo/SPEC.md
  - _bmad-output/specs/spec-e04-04-publish-slug-redirects-and-seo/implementation-contract.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Products currently lack storage foundations for public web addressing (`slug`), SEO metadata (`meta_title`, `meta_description`), publication lifecycle timestamp (`published_at`), and URL alias redirection (`slug_redirects`). Without these schema foundations and migration 0018, product publishing and URL stability cannot be implemented safely.

**Approach:** Author additive migration `0018_product_publish_slug_seo.sql` and corresponding `.down.sql`, register it in the migration journal, update Drizzle table definitions in `src/db/schema.ts` with strict check constraints and unique indexes, backfill unique slugs for any existing draft products, and verify bidirectional migration rollbacks and schema consistency in automated tests.

## Boundaries & Constraints

**Always:**
- Use additive migration `0018_product_publish_slug_seo` without dropping or corrupting existing tables (`products`, `variants`, `product_media`, `variant_media`).
- Enforce lowercase alphanumeric slug format with hyphens via SQL check constraint: `slug = lower(btrim(slug)) AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`.
- Enforce global slug uniqueness on `products` table via `uniqueIndex("products_slug_unique").on(t.slug)`.
- Ensure existing draft products are backfilled with unique, valid slugs generated from `name` (or product ID if name yields empty) so the `NOT NULL` constraint can be applied cleanly.
- Create table `slug_redirects` with primary key `id`, `source_slug` (unique index), `target_slug`, `product_id` (foreign key to `products.id` with `ON DELETE CASCADE`), and check constraint `source_slug <> target_slug`.
- Provide complete, verified `.down.sql` rollback script that cleanly drops the new table, columns, and constraints without orphaned objects.
- Preserve backward compatibility for existing product aggregate queries and repositories.

**Never:**
- Never drop or alter existing columns or constraints on `products`, `variants`, or `product_media`.
- Never allow nullable or non-normalized slugs on newly inserted products.
- Never permit self-referencing redirect entries in `slug_redirects`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|---------------------------|----------------|
| Migration Up on Clean/Populated DB | Run migration 0018 up | `products` table gains `slug`, `meta_title`, `meta_description`, `published_at`; `slug_redirects` table created; journal updated | Atomic transaction failure if error |
| Pre-existing Draft Products | Draft products exist without slug | Backfill generates unique slug from name; collisions receive numeric suffix `-1`, `-2`; NOT NULL constraint succeeds | Handled in migration script |
| Migration Down / Rollback | Run rollback 1 step | Table `slug_redirects` dropped, columns dropped from `products`, journal entry rolled back cleanly | Clean down migration |
| Valid Slug Insert | Insert product with slug `"organic-cotton-tshirt"` | Insert succeeds; unique index and regex check pass | N/A |
| Invalid Slug Insert | Insert product with slug `"Organic Cotton!"` or `"-bad-"` | Check constraint `products_slug_normalized` violates and rejects insert | SQL Check Violation |
| Duplicate Slug Insert | Insert product with slug identical to an existing product | Unique constraint `products_slug_unique` violates and rejects insert | SQL Unique Violation |
| Self-Redirect Insert | Insert into `slug_redirects` with `source_slug = target_slug` | Check constraint `slug_redirects_no_self_redirect` violates and rejects insert | SQL Check Violation |

</frozen-after-approval>

## Code Map

- `src/db/migrations/0018_product_publish_slug_seo.sql` -- Up migration script adding columns to `products`, backfilling slugs, and creating `slug_redirects`.
- `src/db/migrations/0018_product_publish_slug_seo.down.sql` -- Down migration script dropping `slug_redirects` and columns from `products`.
- `src/db/migrations/meta/_journal.json` -- Drizzle migration journal entry at index 18 for `0018_product_publish_slug_seo`.
- `src/db/schema.ts` -- Drizzle schema updates for `products` and definition of `slugRedirects`.
- `src/db/migrate.test.ts` -- Migration runner test assertions updated for migrations 0017 and 0018.
- `src/db/product-publish-migration.test.ts` -- Dedicated schema & constraint verification test for slug format, uniqueness, backfill, and redirect table.

## Tasks & Acceptance

**Execution:**
- [x] `src/db/migrations/0018_product_publish_slug_seo.sql` -- Create migration up script -- Add columns, backfill logic, unique index, and slug_redirects table.
- [x] `src/db/migrations/0018_product_publish_slug_seo.down.sql` -- Create migration down script -- Safely drop added table and columns.
- [x] `src/db/migrations/meta/_journal.json` -- Append journal entry 18 -- Keep migration journal in sync with disk scripts.
- [x] `src/db/schema.ts` -- Export updated `products` and new `slugRedirects` table -- Keep Drizzle TypeScript types and constraints consistent.
- [x] `src/db/migrate.test.ts` -- Update migration test expectations -- Include 0017 and 0018 in end-to-end migration suite.
- [x] `src/db/product-publish-migration.test.ts` -- Add integration tests for new schema -- Test regex check, uniqueness, and rollback.

**Acceptance Criteria:**
- Given a database at migration 0017 with existing draft products, when migration 0018 runs, then all existing products receive valid unique slugs, new columns exist, and `slug_redirects` is created.
- Given migration 0018 applied, when inserting an invalid slug format or duplicate slug, then PostgreSQL rejects the insert with a check or unique violation.
- Given migration 0018 applied, when rolling back 1 step, then `slug_redirects` is dropped, columns are removed from `products`, and prior product and variant data remains intact.

## Implementation Notes

- Added additive migration `0018_product_publish_slug_seo.sql` and rollback `0018_product_publish_slug_seo.down.sql`.
- Migration safely adds `slug`, `meta_title`, `meta_description`, and `published_at` to `products`.
- Backfill CTE normalizes existing draft product names to lowercase kebab-case (with fallback to product id if name yields empty), and applies numeric suffixes `-1`, `-2` to duplicate names.
- Added strict `products_slug_normalized` check constraint enforcing `slug = lower(btrim(slug)) AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 255`.
- Added global unique index `products_slug_unique` on `products.slug`.
- Added `products_slug_autofill_trigger` to transparently preserve backward compatibility for raw SQL fixture inserts across older test suites while strictly preserving check and unique constraints when explicit slugs are supplied.
- Created `slug_redirects` table with `source_slug` unique index, `product_id` index with `ON DELETE CASCADE`, and `slug_redirects_no_self_redirect` check constraint.
- Updated `src/db/schema.ts` with updated `products` and new `slugRedirects` table.
- Updated `src/db/migrate.test.ts` to include migrations 0017 and 0018 across up, down, re-apply, and target rollbacks.
- Updated `src/db/product-drafts-migration.test.ts` to reflect the 0018 head state.
- Added `src/db/product-publish-migration.test.ts` testing 0017-to-0018 backfill, slug formatting checks, uniqueness, self-redirect rejection, cascade deletion, single-step rollback, and Drizzle schema interop.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence / Resolution |
|---|---|---|---|
| Missing CHECK constraints on meta_title and meta_description lengths | medium | patch | Added length <= 70 and <= 160 check constraints in migration 0018 and schema.ts; verified in tests. |
| Missing format and normalization constraints on slug_redirects | medium | patch | Added regex check constraints for both source and target slugs in migration 0018 and schema.ts; verified in tests. |
| Missing index on slug_redirects.target_slug for chain collapsing | medium | patch | Added index slug_redirects_target_slug_idx in migration 0018 and schema.ts. |
| Unbounded base_slug during backfill and trigger | medium | patch | Bounded base_slug to left(..., 240) in both backfill CTE and trigger; verified in tests with long names. |
| Autofill trigger does not avoid collision with active slug_redirects | medium | patch | Added collision check against slug_redirects in products_slug_autofill(); verified in tests. |
| Missing default ID generator on slugRedirects in schema.ts | low | patch | Added $defaultFn(() => createId()) to slugRedirects.id in schema.ts. |
| Edge-case potential NULL ID check in trigger | low | patch | Updated trigger condition to ensure safe comparison. |

## Design Notes

The slug backfill algorithm in SQL uses:
```sql
UPDATE products
SET slug = lower(regexp_replace(btrim(name), '[^a-zA-Z0-9]+', '-', 'g'))
WHERE slug IS NULL OR slug = '';
```
Followed by deduplication with row_number or temporary resolution if collisions exist, ensuring the column can be safely set to `NOT NULL`.
