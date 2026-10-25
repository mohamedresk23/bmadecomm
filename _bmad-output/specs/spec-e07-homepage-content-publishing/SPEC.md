---
id: SPEC-e07-homepage-content-publishing
epic: Epic 07
title: "Epic 07 — Homepage content publishing"
created: 2026-10-22
companions:
  - implementation-contract.md
  - ../../planning-artifacts/prds/prd-bmadecomm-v2-2026-10-05/prd.md
  - ../../planning-artifacts/architecture/architecture-bmadecomm-2026-10-05/ARCHITECTURE-SPINE.md
  - ../../planning-artifacts/architecture/architecture-bmadecomm-2026-10-05/SOLUTION-DESIGN.md
  - ../../planning-artifacts/ux-designs/ux-bmadecomm-2026-10-05/DESIGN.md
  - ../../planning-artifacts/ux-designs/ux-bmadecomm-2026-10-05/EXPERIENCE.md
  - ../../implementation-artifacts/e02-permission-matrix-proposal.md
  - ../spec-e04-04-publish-slug-redirects-and-seo/SPEC.md
  - ../../planning-artifacts/stories/stories-bmadecomm-2026-10-05/stories.md
  - ../../planning-artifacts/epics/epics-bmadecomm-2026-10-05/epics.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate for Epic 07 (`E07-01..E07-03`). Derived from `.memlog.md` and authorized project foundations.

# Epic 07 — Homepage Content Publishing

## Why

Staff already manage categories (`E04-01`), product drafts and variants (`E04-02`), product image galleries (`E04-03`), and safe product publication with slugs and SEO metadata (`E04-04`). However, the public storefront root (`S-01`) is still a static placeholder, and staff have no way to compose, preview, or publish curated homepage sections (`FR-08`, `FR-11`) without risking exposure of unfinished layout edits or unpublished catalog items to shoppers. Epic 07 delivers a complete draft → authorized preview → atomic publication workflow (`A-12` → `S-01`) so staff can curate the store homepage safely while guaranteeing that shoppers only ever see a consistent published snapshot backed by live published products and active categories.

## Capabilities

- **CAP-1 (Homepage sections draft editor — E07-01)**
  - **intent:** Authorized staff can compose, enable or disable, and editorially order homepage sections in a persistent draft (`homepage_drafts`) via admin screen `A-12`.
  - **success:** Staff with `content.manage` can save a draft containing only the approved `FR-08` section types (`hero`, `featured_categories`, `featured_products`, `best_sellers`, `new_arrivals`, `promotions`), toggle each section's `enabled` state, reorder sections and referenced items, and persist changes with optimistic concurrency (`expectedRevision`) and an atomic audit event.
- **CAP-2 (Catalog reference & content schema validation — E07-01)**
  - **intent:** System validates the homepage content schema and all referenced product and category identifiers before persisting draft updates or publishing.
  - **success:** Unknown section types, malformed payloads, duplicate section/item IDs, or non-existent product/category references are rejected with structured `400`/`422` field errors and zero side effects.
- **CAP-3 (Authorized staff draft preview — E07-02)**
  - **intent:** Authorized staff can preview the current homepage draft rendered with `S-01` storefront components before publishing.
  - **success:** Preview requests require an active staff session with `content.read` or `content.manage` (returning `401`/`403` to guests, customers, or unpermitted staff), render the current draft sections with `S-01` presentation components, and strictly enforce `Cache-Control: private, no-store` and `X-Robots-Tag: noindex, nofollow`.
- **CAP-4 (Immutable publication snapshot & cache invalidation — E07-03)**
  - **intent:** Authorized staff can publish the validated homepage draft into an immutable `homepage_publications` snapshot and immediately refresh the public storefront cache.
  - **success:** Publishing writes a new immutable row in `homepage_publications` (`version = N + 1`) inside a PostgreSQL transaction, records a `content.homepage.publish` audit event with actor and correlation ID, and triggers Next.js cache invalidation for `S-01` while subsequent draft edits remain invisible to the public until the next publish.
- **CAP-5 (Public storefront homepage rendering & live catalog filtering — E07-03)**
  - **intent:** Shoppers visiting `S-01` view a consistent published homepage that displays only enabled sections and dynamically excludes unpublished or archived catalog items at render time.
  - **success:** Public `S-01` renders the latest `homepage_publications` snapshot (or a clean empty state when no publication or enabled sections exist); if any referenced product is `draft` or `archived` (or a referenced category is inactive) at render time, it is automatically filtered out without breaking the page or exposing private catalog data (`AC-19`).
- **CAP-6 (Accessible RTL admin editor & keyboard reordering — E07-01..03)**
  - **intent:** Staff and shoppers interact with `A-12` and `S-01` in accessible Arabic RTL layouts with full keyboard and mobile support (`NFR-08`, `NFR-09`).
  - **success:** Section and item reordering in `A-12` works via explicit keyboard-accessible Move Up / Move Down controls without requiring drag-and-drop (`WCAG 2.5.7`), all inputs have persistent labels and field-linked error summaries, and `S-01` renders responsively at `320px`, `768px`, `1024px`, and `1440px` without P1 controls (`UX-10`).

## Constraints

- **RBAC Enforcement (`FR-07`, `AD-2`, `e02-permission-matrix-proposal.md`):** Reading drafts or preview requires `content.read` or `content.manage`; mutating drafts or publishing requires `content.manage` (granted by default to `owner` and `marketing`, or explicitly granted roles in `user_roles`/`role_permissions`). Customer sessions and unauthenticated requests are denied (`401`/`403`).
- **Approved Section Types Only (`FR-08`, `UX-10`):** Only the six `FR-08` section types (`hero`, `featured_categories`, `featured_products`, `best_sellers`, `new_arrivals`, `promotions`) are permitted. Arbitrary HTML/JS blocks, general-purpose CMS page builders, scheduled publishing, and P1 controls (Wishlist, Ratings, Brands) are forbidden.
- **Draft & Preview Isolation (`AD-12`, `AC-19`):** Draft APIs and preview routes must never be cached in shared/public caches (`Cache-Control: private, no-store`, `Pragma: no-cache`) and preview routes must emit `noindex`. Public `S-01` reads exclusively from `homepage_publications`, never from `homepage_drafts`.
- **Live Catalog Safety at Render (`FR-08`, `FR-14`, `AC-19`):** Publication snapshots store section configuration and ordered catalog reference IDs, while product/category card details (name, slug, primary image with alt text, price, availability) are resolved against live published catalog records so that unpublishing or archiving a product immediately removes it from public `S-01` rendering.
- **Transactional Audit & Concurrency (`FR-45`, `AD-15`):** All draft updates and publication commands validate `Origin`/CSRF (`x-csrf-token`), check `expectedRevision` (returning `409 Conflict` on stale writes), and append an immutable row to `audit_events` in the same database transaction.
- **Modular Monolith Boundary (`AD-1`, `AD-2`):** Domain and application services reside under `src/modules/content/homepage/` with zero Next.js framework imports inside `application/` or `contracts/`.

## Non-goals

- General-purpose multi-page CMS, custom landing page builder, or rich-text/HTML code injection.
- Automated scheduled publishing or time-windowed campaign automation (`epics.md` Epic 07 boundary).
- Full catalog search, filter, and pagination screen (`S-02`, owned by Epic 06) or Product Detail Page variant selection (`S-03`, owned by Epic 06).
- P1 storefront controls on product cards (Wishlist `D-01`, Verified Reviews/Ratings `D-02`, Brands `D-03`).
- Granting Marketing staff unrestricted catalog media upload privileges (`media:upload` remains scoped per `e02-permission-matrix-proposal.md`).

## Success signal

An authorized staff member (`owner` or `marketing`) opens `/admin/content/homepage` (`A-12`), configures and reorders homepage sections (including `featured_categories` and `featured_products`) using keyboard-accessible controls, saves the draft (verifying that public `/` still does not show the un-published draft), opens `/admin/content/homepage/preview` (`E07-02`) to verify the `S-01` rendering with `noindex` and `private, no-store` headers while a guest/customer receives `401`/`403`, and then clicks Publish (`E07-03`). Immediately after publishing, a guest visiting `/` (`S-01`) sees the enabled sections and published products; when one of the featured products is subsequently unpublished via `E04-04`, refreshing `/` automatically omits that product without error.

## Assumptions

- **A-01 (Singleton Homepage Resource):** The store has a single logical homepage (`slug = 'home'`) backed by one mutable draft row in `homepage_drafts` (`revision` incrementing on each save) and an append-only history of published snapshots in `homepage_publications` (`version` incrementing on each publish).
- **Best Sellers Fallback Contract (`epics.md` Epic 06/07 boundary):** Until Epic 13 populates delivered-minus-returned unit facts, `best_sellers` resolves published products using a deterministic tie-break (`published_at DESC, id ASC`) without fabricating purchase counts.

## Open Questions

- **OQ-08 / Content Media Scope:** In `E07-01`, `hero` and `promotions` sections reference optional existing published media IDs (uploaded by an authorized `media:upload` role) or internal store links (`/catalog`, category/product slugs) without introducing a separate unapproved media upload pipeline for Marketing.

