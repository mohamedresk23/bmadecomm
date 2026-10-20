---
title: 'E04-04-02: Product slug validation, generation & redirect chain management'
type: 'feature'
created: '2026-10-20'
status: 'done'
baseline_commit: '05ea5be0bdf881989df477597fec5c3301b4570b'
route: 'dispatch'
review_loop_iteration: 1
story_key: '4-402-product-slug-validation-generation-and-redirect-chain-management'
context:
  - AGENTS.md
  - _bmad-output/specs/spec-e04-04-publish-slug-redirects-and-seo/SPEC.md
  - _bmad-output/specs/spec-e04-04-publish-slug-redirects-and-seo/implementation-contract.md
  - _bmad-output/implementation-artifacts/spec-4-401-schema-migration-for-slug-seo-fields-and-slug-redirects.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The product catalog has database columns and tables for slugs and redirects (migration 0018), but lacks domain services and contract validation to normalize, validate, and auto-generate unique product slugs, and lacks automated redirect management to record 301 redirects and collapse multi-hop chains when published product slugs change.

**Approach:** Implement a domain `slug-service.ts` providing slug normalization, format validation, unique candidate generation with collision handling, and transactional redirect chain collapsing (`A->B` + `B->C` => `A->C`) and cycle prevention (`A->B` followed by `B->A`). Integrate slug and SEO fields into `product.ts` contracts and `product-service.ts` creation/edit workflows.

## Boundaries & Constraints

**Always:**
- Enforce strict slug format regex: `^[a-z0-9]+(-[a-z0-9]+)*$` and maximum length 255 characters (base slug bounded to 240 chars).
- Normalize input slugs: trim whitespace, lowercase, and reject invalid characters.
- If `slug` is omitted during product creation, auto-generate a unique slug derived from the product `name` (falling back to product ID or `product` if name produces an empty slug).
- Enforce global slug uniqueness against both existing products and active `slug_redirects.source_slug` belonging to other products.
- When an already **published** product's slug is updated (`old_slug !== new_slug`):
  - Collapse redirect chains: update all existing rows in `slug_redirects` where `target_slug = old_slug` to set `target_slug = new_slug`.
  - Prevent cycles: delete any row in `slug_redirects` where `source_slug = new_slug AND product_id = product.id`.
  - Insert new redirect record: `source_slug: old_slug`, `target_slug: new_slug`, `product_id: product.id`.
- When a **draft** product's slug is updated, do NOT create redirect rows in `slug_redirects` (draft URLs were never publicly published).
- Expose `slug`, `metaTitle`, `metaDescription`, `publishedAt` in `ProductDto`.
- Record audit event `catalog.product.slug_update` when slug is updated on an existing product.

**Never:**
- Never allow duplicate or malformed slugs to persist.
- Never create redirect rows with `source_slug == target_slug`.
- Never allow multi-hop redirect chains in `slug_redirects`.
- Never create redirects for unpublished draft products.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|---------------------------|----------------|
| Auto-generate slug on create | `name: "Summer Linen Shirt"`, `slug` omitted | Product created with `slug: "summer-linen-shirt"` | N/A |
| Collision during auto-generation | Existing product has `slug: "summer-shirt"`, create with same name | New product assigned `slug: "summer-shirt-1"` | N/A |
| Explicit valid slug on create | `slug: "custom-linen-top"` provided | Product created with `slug: "custom-linen-top"` | N/A |
| Invalid slug format | `slug: "Bad_Slug!"` or `"-leading"` or `"trailing-"` | Rejected with 422 Unprocessable Entity field error | Validation error |
| Duplicate slug on create/edit | Slug already used by another product | Rejected with 409 Conflict field error | Conflict error |
| Claim slug used as redirect by other product | Slug exists as `source_slug` for another product | Rejected with 409 Conflict field error | Conflict error |
| Edit slug on Draft product | Product is `draft`, slug changed from `draft-a` to `draft-b` | `products.slug` updated; 0 rows added to `slug_redirects` | N/A |
| Edit slug on Published product | Product is `published`, slug changed from `live-a` to `live-b` | `products.slug` updated; 1 row added to `slug_redirects` (`live-a -> live-b`) | N/A |
| Redirect chain collapsing | `live-a -> live-b` exists; product slug updated `live-b -> live-c` | `slug_redirects` updated so `live-a -> live-c` and `live-b -> live-c` | N/A |
| Redirect cycle prevention | `live-a -> live-b` exists; product slug changed back to `live-a` | Previous redirect row `live-a -> live-b` deleted; no loop exists | N/A |

</frozen-after-approval>

## Code Map

- `src/modules/catalog/products/contracts/product.ts` -- Add `slug`, `metaTitle`, `metaDescription` to `createProductSchema` and `updateProductSchema`; update `ProductDto`.
- `src/modules/catalog/products/application/slug-service.ts` -- New domain service for slug normalization, unique candidate generation, validation, and redirect chain collapsing.
- `src/modules/catalog/products/application/product-service.ts` -- Integrate slug generation on create and redirect handling on edit under product lock.
- `src/modules/catalog/products/contracts/product.test.ts` -- Add contract unit tests for slug and SEO metadata validation.
- `src/modules/catalog/products/application/slug-service.test.ts` -- Unit and integration tests for slug generation, chain collapsing, cycle prevention, and redirect insertion.
- `src/modules/catalog/products/application/product-service.test.ts` -- Update product service tests to verify slug persistence, auto-generation, and draft vs published edit behavior.

## Tasks & Acceptance

**Execution:**
- [x] `src/modules/catalog/products/contracts/product.ts` -- Update contracts and DTOs -- Include optional slug, metaTitle, metaDescription in create/update schemas and ProductDto.
- [x] `src/modules/catalog/products/application/slug-service.ts` -- Implement slug service -- Normalization, collision resolution, uniqueness check, redirect chain collapsing.
- [x] `src/modules/catalog/products/application/product-service.ts` -- Integrate slug service -- Auto-generate slug on create if omitted, handle redirects on edit if published.
- [x] `src/modules/catalog/products/contracts/product.test.ts` -- Add contract tests -- Test slug format and length validation.
- [x] `src/modules/catalog/products/application/slug-service.test.ts` -- Add slug service tests -- Test chain collapse, cycle prevention, and collision suffixes.
- [x] `src/modules/catalog/products/application/product-service.test.ts` -- Verify service integration -- Verify draft edit doesn't create redirects, published edit creates redirects.

**Acceptance Criteria:**
- Given a product creation request without a slug, when processed, then a unique normalized slug is automatically generated from the product name.
- Given an invalid slug format or duplicate slug, when submitted, then the service rejects the request with an explicit field error.
- Given a published product whose slug is updated from A to B, when saved, then a 301 redirect from A to B is inserted in `slug_redirects`, and any existing redirects pointing to A are updated to point to B.
- Given a draft product whose slug is updated, when saved, then no rows are inserted into `slug_redirects`.

## Implementation Notes

- Updated `src/modules/catalog/products/contracts/product.ts`:
  - Added `slugSchema` enforcing `^[a-z0-9]+(-[a-z0-9]+)*$` and max length 255 with lowercase/trim transformation.
  - Added `metaTitle` (max 70 chars, noControls, nullable) and `metaDescription` (max 160 chars, wellFormedUnicode, nullable).
  - Updated `createProductSchema` and `updateProductSchema` to accept optional `slug`, `metaTitle`, and `metaDescription`.
  - Updated `ProductDto` to include `slug`, `metaTitle`, `metaDescription`, and `publishedAt`.
- Implemented `src/modules/catalog/products/application/slug-service.ts`:
  - `normalizeSlug` and `isValidSlug` for format and length checking.
  - `slugify` with Unicode decomposition (`.normalize("NFD").replace(/[\u0300-\u036f]/g, "")`) so accented Latin characters map to ASCII bases (e.g. é -> e).
  - `deriveBaseSlug` for fallback resolution (product ID or `product`) bounded to 240 chars.
  - `assertSlugAvailable` verifying slug format (422) and uniqueness (409) against `products.slug` and active `slug_redirects.source_slug` for other products.
  - `generateUniqueSlug` with numeric collision suffix resolution (`-1`, `-2`, `-3`).
  - `handleSlugRedirects` with cycle prevention (`DELETE WHERE source_slug = newSlug AND product_id = productId`), chain collapsing strictly scoped to product (`UPDATE target_slug = newSlug WHERE target_slug = oldSlug AND product_id = productId`), and redirect insertion (`oldSlug -> newSlug`) executed conditionally on whether the product is currently published.
- Integrated `src/modules/catalog/products/application/product-service.ts`:
  - Auto-generates unique slug on product creation when omitted.
  - Validates provided slug availability and format.
  - On update, performs slug availability check if slug changed, manages redirects for published products via `handleSlugRedirects`, and records audit event `catalog.product.slug_update`.
  - Allowed editing draft and published products while strictly disallowing archived products (409 Conflict).
  - Explicitly preserves existing `metaTitle` and `metaDescription` when omitted, updates them when provided, and clears them to `null` when passed as `null`.
  - Preserves existing `slug` and creates zero redirect records when `slug` is omitted on update.
  - Translated PostgreSQL slug unique and check constraint errors (23505, 23514) into structured 409 and 422 ApiErrors with `{ field: "slug" }`.
- Added and updated tests:
  - `src/modules/catalog/products/contracts/product.test.ts`: Contract tests for slug normalization, regex, max lengths (255 chars), and SEO title/description bounds.
  - `src/modules/catalog/products/application/slug-service.test.ts`: Unit and DB integration tests for derivation, Latin diacritic decomposition, collision resolution, availability check, chain collapse, cycle prevention, draft collapse preservation, and cross-product isolation.
  - `src/modules/catalog/products/application/product-service.test.ts`: Integration tests verifying creation with auto-generated and explicit slugs, draft vs published slug edits, redirect chain collapsing, cycle avoidance, SEO metadata retention/update/clearing, slug omission preservation, DB check constraint violation translation into 422 ApiError, audit events, and conflict rejection.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence / Resolution |
|---|---|---|---|
| Scope redirect chain collapsing to current product | high | patch | Updated Step 2 in `slug-service.ts` to `where(and(eq(slugRedirects.targetSlug, oldSlug), eq(slugRedirects.productId, productId)))`. Verified in multi-product isolation test in `slug-service.test.ts`. |
| Unpublished products with legacy redirects should still collapse chains and prevent cycles | medium | patch | Refactored `handleSlugRedirects` so cycle prevention and chain collapse execute for any product slug change, while new redirect insertion is gated on `productStatus === "published"`. Verified in `slug-service.test.ts`. |
| Unicode decomposition for accented characters in `slugify` | medium | patch | Added `.normalize("NFD").replace(/[\u0300-\u036f]/g, "")` in `slug-service.ts`. Added tests for café, crème brûlée, schön in `slug-service.test.ts`. |
| Fix mojibake / encoding characters in Arabic test strings | low | patch | Cleaned all Arabic test strings in `slug-service.test.ts` to clean UTF-8 `"قميص صيفي"`. |
| Ensure `metaTitle` and `metaDescription` retain/update/null cleanly in `updateProduct` | medium | patch | Explicitly tracked `existingMetaTitle` / `existingMetaDescription` on `updateProduct` and added test assertions verifying retention, update, and nulling in `product-service.test.ts`. |
| Verify omitted slug in `updateProduct` preserves existing slug with 0 redirects | low | patch | Added dedicated test assertion in `product-service.test.ts` verifying slug preservation and zero redirect row insertion when slug is omitted on update. |
| Verify check constraint (code 23514) error translation into 422 `ApiError` | low | patch | Added test in `product-service.test.ts` simulating a DB-level check violation and asserting 422 `ApiError` with `{ field: "slug" }`. |

## Design Notes

Redirect chain collapsing SQL:
```sql
UPDATE slug_redirects
SET target_slug = $newSlug
WHERE target_slug = $oldSlug AND product_id = $productId;
```
Cycle avoidance:
```sql
DELETE FROM slug_redirects
WHERE source_slug = $newSlug AND product_id = $productId;
```
And new redirect row insertion:
```sql
INSERT INTO slug_redirects (id, source_slug, target_slug, product_id)
VALUES (createId(), $oldSlug, $newSlug, $productId);
```
