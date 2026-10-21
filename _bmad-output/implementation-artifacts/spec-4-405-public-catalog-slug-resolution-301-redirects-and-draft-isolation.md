---
title: 'E04-04-05: Public product slug resolution and draft isolation'
type: 'feature'
created: '2026-10-21'
status: 'done'
baseline_commit: 'fbdd41ae8d26c7f6c6aa5366700941c915d618ce'
route: 'dispatch'
review_loop_iteration: 0
story_key: '4-405-public-catalog-slug-resolution-301-redirects-and-draft-isolation'
context:
  - AGENTS.md
  - _bmad-output/specs/spec-e04-04-publish-slug-redirects-and-seo/implementation-contract.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Published products cannot yet be resolved by shoppers through their current or historical slugs.

**Approach:** Implement GET /api/public/products/by-slug/[slug], returning an explicit public product DTO, a permanent redirect for a historical slug, or an indistinguishable not-found response for unavailable products.

## Boundaries & Constraints

**Always:**
- Permit guest and customer reads without staff authentication. Never let cookies, roles or mock identity headers bypass publication filtering.
- Resolve the current published slug before historical redirects. A direct draft/archived match must return 404 rather than fall through to a redirect.
- Resolve historical slugs only against their owning product, which must currently be published. Derive the redirect destination from that owner's current canonical slug, preventing stale targets from exposing another product. Return HTTP 301 with relative Location /products/{canonicalSlug}; reject self redirects and invalid canonical values.
- Read product, variants, active attachments and redirect ownership from one database statement snapshot, avoiding mixed states during unpublish or slug editing. Requests after a committed unpublish return 404 for both current and historical slugs.
- Use an allowlisted public DTO: id, name, description, slug, variants and images, metaTitle and metaDescription. Variants include id, sku, integer-string priceMinor/comparePriceMinor, currency, currencyScale and attributes; preserve existing deterministic ordering. Images contain only attachment id, position and altText, ordered by gallery position with a stable tie-breaker; exclude removed attachments.
- Resolve blank SEO title to product name and blank SEO description to the first 160 Unicode code points of description; preserve custom values.
- Return 200 with the public DTO directly. Return standard sanitized API errors with correlation headers; generate a correlation ID when absent. Use the same generic 404 for malformed, missing, draft and archived slugs. Validate strict existing slug syntax and maximum length without normalizing incoming paths.
- Set Cache-Control: no-store on success, redirects and errors, and force dynamic execution. This includes permanent redirects, which otherwise risk surviving unpublication in browser/shared caches.

**Never:** Expose timestamps, status, revisions, audit data, storage keys, filenames, media IDs, admin preview URLs or private bytes. Add no public image content route, storage publication, migration, staff UI, storefront page, inventory behavior or writes. Preserve existing publish/unpublish and slug mutation semantics, and pre-existing working-tree edits.

## I/O & Edge-Case Matrix

| Input / State | Expected behavior |
|---|---|
| Current published slug | 200 allowlisted public DTO |
| Historical slug with published owner | 301 to owner's current /products/slug |
| Current or historical draft/archived slug | Generic 404 without Location or data |
| Missing or malformed slug | Same generic 404 |
| Removed attachment | Excluded from images |
| Blank/custom SEO | Content fallback/custom value |
| Database exception | Sanitized 500, correlation, no-store |
| Unpublish then reread either slug | 404 without stale cached result |

</frozen-after-approval>

## Code Map

- `src/db/schema.ts`: products, variants, variantAttributes, productMedia, slugRedirects; use explicit projections.
- `src/modules/catalog/products/application/product-service.ts`: selectAggregates demonstrates single-statement JSON aggregation and integer-string money. Do not return its staff DTO wholesale.
- `src/modules/catalog/products/application/slug-service.ts`: reuse isValidSlug; canonical owner wins over stored redirect target.
- `src/modules/catalog/products/application/gallery-service.ts`: reuse attachment ordering concepts, never its admin preview projection.
- `src/shared/api/errors.ts` and `error-handler.ts`: existing error envelope and correlated diagnostic conventions.
- `src/test-utils/catalog.ts`, `publication.ts`, `db.ts`: isolated fixtures and publication helpers.
- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`: read; promised params and dynamic uncached route behavior.

## Tasks & Acceptance

**Execution:**
- [x] `src/modules/catalog/products/contracts/public-product.ts`: define explicit public DTO and discriminated resolution result.
- [x] `src/modules/catalog/products/application/public-product-service.ts`: validate slug, resolve snapshot and map the public allowlist/SEO fallbacks.
- [x] `src/app/api/public/products/by-slug/[slug]/route.ts`: dynamic public GET, correlation, exact 301 and no-store on all handled responses.
- [x] `src/modules/catalog/products/application/public-product-service.test.ts`: exercise the complete matrix with database fixtures, redirect chains, changed draft slugs and read-only assertions.
- [x] `src/app/api/public/products/by-slug/[slug]/route.test.ts`: verify guest access, DTO privacy, strict HTTP status/Location, headers, errors and committed unpublication behavior.

**Acceptance Criteria:**
- Given published and unpublished products with historical slugs, when a guest resolves each address, then only published owners produce data or redirects.
- Given publication or slug changes, when the next request begins after commit, then it observes current visibility and canonical destination.
- Given private gallery/storage metadata, when reading the public DTO, then no private identifier, URL or bytes appear and database state remains unchanged.

## Implementation Notes

Implemented the explicit public DTO, single-statement resolver and dynamic no-store GET route. Lifecycle state progressed from approved draft through ready-for-dev, in-progress and in-review to done without repeating investigation or planning.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence and route |
|---|---|---|
| Blind 1: unscoped fixture update | low | Update touches unrelated variants inside isolated transaction; direct correction scopes it to the fixture. patch. |
| Blind 2: singleton variant ordering | medium | Singleton assertion cannot distinguish incorrect aggregate ordering. patch; same root cause as Gap 1. |
| Blind 3: published direct-match precedence coverage | low | Existing collision test checks draft only; add a direct published assertion. patch. |
| Blind 4: nullable and empty DTO coverage | low | Existing fixture omits nullable description/comparison price and empty collections. patch. |
| Blind 5: HTTP customer authentication bypass | false | src/proxy.ts only propagates correlation headers and has no authentication guard; public GET never reads identity or invokes authentication. Cookies cannot affect resolution. Direct handler tests verify this public contract. |
| Gap 1: variant ordering regression gap | medium | Verified singleton fixture cannot detect reversed order; extend with tied positions and conflicting insertion order. patch. |


## Design Notes

No unresolved intent gaps or irreversible operations. Footprint is a read-only service, public contract, one route and focused tests. Metadata-only images satisfy this backend resolution contract without inventing a public media delivery lifecycle. No shared caching is introduced, so publication commands need no invalidation changes. Prior story continuity: reuse atomic publication semantics, retained first-publication timestamps and parent-locked writers without changing them.

## Verification

Run focused service/API tests plus existing publication and slug regressions; typecheck, repository lint and production Webpack build. Inspect every matrix row and privacy assertion. Use a bounded broader suite only if necessary; report environment limitations explicitly. No live data, migration or deployment execution.

Verification result: 33 unique focused/publication/slug/readiness tests passed using PGlite. Typecheck, repository lint and production Webpack build passed. All eight matrix rows are covered by the executed public service/API tests. PostgreSQL concurrency integration tests were not run.

Post-review verification: added ordering, direct published precedence and nullable/empty DTO regressions; scoped the fixture money update. All accepted findings fixed, none deferred. Final parent rerun: 5 test files / 30 tests passed; typecheck, repository lint and next build --webpack passed. Earlier publication/readiness route regression runs also passed.
