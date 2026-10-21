---
id: SPEC-e04-04-publish-slug-redirects-and-seo
created: 2026-10-20
companions:
  - implementation-contract.md
  - ../../planning-artifacts/prds/prd-bmadecomm-v2-2026-10-05/prd.md
  - ../../planning-artifacts/architecture/architecture-bmadecomm-2026-10-05/ARCHITECTURE-SPINE.md
  - ../../planning-artifacts/architecture/architecture-bmadecomm-2026-10-05/SOLUTION-DESIGN.md
  - ../../planning-artifacts/ux-designs/ux-bmadecomm-2026-10-05/DESIGN.md
  - ../../planning-artifacts/ux-designs/ux-bmadecomm-2026-10-05/EXPERIENCE.md
  - ../../implementation-artifacts/epic-4-context.md
  - ../../implementation-artifacts/spec-e04-02.md
  - ../spec-e04-03-product-images/SPEC.md
  - ../../planning-artifacts/stories/stories-bmadecomm-2026-10-05/stories.md
sources: []
---

# E04-04 — Product publish, slug redirects and SEO metadata

> Canonical contract for E04-04. Derived from `.memlog.md` and authorized project foundations. This specification governs product publication gates, slug generation and editing, 301 redirect management, and basic SEO metadata.

## Why

Staff already create private product drafts with variants (E04-02) and manage full product image galleries (E04-03). However, products cannot currently be safely published to shoppers or addressed with stable URLs, and search engines have no metadata or redirect handling when URLs change. Implementing safe publication gates, unique slug enforcement, automated 301 redirects, and SEO metadata enables the catalog to transition products from internal drafts into publicly discoverable items without risking invalid product states, broken links, or draft leakage.

## Capabilities

- **CAP-1 (Slug format & uniqueness)**
  - **intent:** Staff or system can assign and edit a unique, normalized, URL-safe slug for each product.
  - **success:** Slugs conform to `^[a-z0-9]+(-[a-z0-9]+)*$`, duplicate slugs are rejected with field errors, and slug generation automatically falls back to product name normalization.
- **CAP-2 (Slug redirects & chain collapsing)**
  - **intent:** System maintains stable URLs by recording a 301 redirect when a published product's slug is updated, avoiding broken links.
  - **success:** Editing a published product's slug creates a `slug_redirects` record; multi-hop redirect chains (A → B → C) automatically collapse to direct redirects (A → C, B → C); circular redirects are prevented.
- **CAP-3 (Publication readiness gate)**
  - **intent:** System evaluates whether a draft product satisfies all required criteria before allowing publication.
  - **success:** Publishing is blocked and returns granular field-level validation errors if the product lacks a valid name, slug, at least one active variant with a positive price and SKU, or if any active gallery image is missing alternative text (FR-15); no partial publish occurs.
- **CAP-4 (Atomic publish & unpublish transitions)**
  - **intent:** Authorized staff can publish an eligible draft product or return a published product to draft status with audited state changes.
  - **success:** Successful publication updates status to `published` and records `published_at`; unpublishing transitions status to `draft`; both write audited events with staff actor and correlation ID.
- **CAP-5 (SEO metadata & canonical fallbacks)**
  - **intent:** Staff can specify custom SEO title and description, or rely on sensible defaults derived from product content.
  - **success:** Custom `meta_title` (<= 70 chars) and `meta_description` (<= 160 chars) persist and validate; if left blank, public views fall back to product name and truncated description.
- **CAP-6 (Public catalog isolation & 301 redirection)**
  - **intent:** Public catalog endpoints resolve products by slug while guaranteeing that unpublished drafts never leak to shoppers (AC-19).
  - **success:** Public query by slug returns 200 for published products, returns 301 with the target location for legacy redirected slugs, and strictly returns 404 for draft or archived products.

## Constraints

- Reuse existing catalog modular boundary, PostgreSQL transactions (`tx.ts`), staff session authentication (`requireCatalogStaffSession`), CSRF protection, and shared audit logging (`audit.ts`).
- Public catalog routes must never disclose draft or archived products, draft images, or private media (AC-19).
- Image publication readiness requires that every active product image has non-empty `alt_text` (FR-15).
- Additive database migration only: add `slug`, `meta_title`, `meta_description`, `published_at` to `products`, and add table `slug_redirects` with unique indexes.
- No client-supplied role bypasses or `x-mock-user` authentication headers.
- Multi-language Arabic RTL UI conventions and accessible form field error summaries must be preserved.

## Non-goals

- Product duplication, archive, and delete lifecycle (deferred to E04-05).
- Storefront Product Detail Page (PDP) frontend rendering or cart/checkout handoff (Epic 06).
- Advanced automated SEO sitemaps, Open Graph dynamic image generators, or JSON-LD structured schema generators for the storefront (deferred to Epic 06 / Storefront).
- Category slug redirects (handled at category management level or subsequent refactor).
- Stock level editing or inventory allocation (Epic 05).

## Success signal

An authorized staff member creates a product draft with variants and images, validates and corrects a missing alt-text error via the readiness gate, publishes the product, edits its slug, and verifies that the public endpoint serves the product at the new slug while immediately issuing a 301 redirect for the old slug. A guest request attempting to fetch an unpublished draft returns 404.

## Assumptions

- Existing drafts without a slug in the database will be assigned a generated slug from their name or ID during migration / initial fetch.
- Single-store tenancy; slug uniqueness is enforced globally within the single deployed tenant database.

