---
title: E04-04 Product publish, slug redirects and SEO metadata — implementation stories
status: approved-breakdown
created: 2026-10-20
parent: original-E04-04
workflowStep: step-03-create-stories
sources:
  - ../../../specs/spec-e04-04-publish-slug-redirects-and-seo/SPEC.md
  - ../../../specs/spec-e04-04-publish-slug-redirects-and-seo/implementation-contract.md
  - ../../epics/epics-bmadecomm-2026-10-05/epics.md
  - ../../prds/prd-bmadecomm-v2-2026-10-05/prd.md
---

# Epic 04 / E04-04: Product publish, slug redirects and SEO metadata

Staff can safely publish validated products, manage SEO metadata and URL slugs, automatically create 301 redirects when slugs change, and guarantee that unpublished drafts remain strictly invisible to shoppers. Six bounded, vertical stories govern delivery.

The [implementation contract](../../../specs/spec-e04-04-publish-slug-redirects-and-seo/implementation-contract.md) and [SPEC.md](../../../specs/spec-e04-04-publish-slug-redirects-and-seo/SPEC.md) are authoritative for schemas, endpoints, and validation rules.

---

## Delivery sequence

| ID | Outcome | Layers | Prerequisites |
|---|---|---|---|
| E04-04-01 | Migration 0017 introduces slug, meta fields, published_at and slug_redirects | Database | Existing migration 0016 & E04-02 |
| E04-04-02 | Slug generation, uniqueness enforcement and redirect chain collapsing | Backend | E04-04-01 |
| E04-04-03 | Product publication readiness evaluator and readiness API | Backend | E04-04-01, E04-03-04 (alt text) |
| E04-04-04 | Atomic publish & unpublish mutations with audited event logging | Backend | E04-04-02, E04-04-03 |
| E04-04-05 | Public catalog slug lookup, 301 redirect responder and draft isolation | Backend | E04-04-04 |
| E04-04-06 | Staff UI for publication action, readiness alerts and Slug/SEO editor | Frontend | E04-04-04, E04-04-05 |

---

## Detailed Stories

### Story 4.401: Schema migration for slug, SEO fields & slug_redirects
**Story ID:** E04-04-01  
**Objective:** Add persistent storage foundations for URL slugs, SEO meta, publication timestamp, and redirects.  
**Scope:** Migration 0017 adding columns `slug` (unique, format-checked), `meta_title`, `meta_description`, `published_at` to `products`, and creating the `slug_redirects` table with uniqueness on `source_slug`. Backfill unique slugs for any existing draft products.  
**Acceptance Criteria:**
- `products.slug` is unique and enforces regex `^[a-z0-9]+(-[a-z0-9]+)*$`.
- `slug_redirects` enforces foreign key to `products.id` and unique `source_slug`.
- Migration applies and rolls back cleanly on real PostgreSQL 18.6 without data corruption.

---

### Story 4.402: Product slug validation, generation & redirect chain management
**Story ID:** E04-04-02  
**Objective:** Domain logic for validating, normalizing, and editing slugs with automatic redirect management.  
**Scope:** Slug service providing normalization, uniqueness checking, automatic slug generation from product name, redirect row creation when a published product's slug changes, chain collapsing (`A->B` + `B->C` => `A->C`), and loop prevention.  
**Acceptance Criteria:**
- Malformed slugs or duplicate slugs return 400/409 field errors.
- Changing a published product's slug creates a row in `slug_redirects`.
- Multi-step redirects collapse to a single hop.
- Circular redirects are rejected.

---

### Story 4.403: Product publication readiness evaluation service & API
**Story ID:** E04-04-03  
**Objective:** Assess whether a draft product meets all business criteria for publication.  
**Scope:** Domain readiness evaluator and `GET /api/catalog/products/[id]/readiness` endpoint. Checks: non-empty name, valid unique slug, >=1 variant with price>0 and SKU, >=1 active image in gallery, non-empty alt text on all active images (FR-15), and valid category link.  
**Acceptance Criteria:**
- Returns `{ isReady: true, issues: [] }` when all conditions pass.
- Returns `{ isReady: false, issues: [...] }` with exact field error keys if any condition fails (e.g. blank alt text).
- Read-only; causes no state changes or database mutations.

---

### Story 4.404: Publish and unpublish actions with atomic state transitions and audit logging
**Story ID:** E04-04-04  
**Objective:** Allow staff to publish an eligible product or unpublish a live product.  
**Scope:** `POST /api/catalog/products/[id]/publish` and `POST /api/catalog/products/[id]/unpublish`. Runs readiness check within transaction. Updates `status` and `published_at`. Commits audit log entries (`product.publish`, `product.unpublish`).  
**Acceptance Criteria:**
- Ineligible product fails with 422 and structured issue details; status remains `draft`.
- Eligible product transitions to `published`, records timestamp, and writes audit event.
- Unpublish returns product to `draft` and writes audit event.
- Requires live catalog staff session; customer/guest requests are rejected with 401/403.

---

### Story 4.405: Public catalog slug resolution, 301 redirects & draft isolation
**Story ID:** E04-04-05  
**Objective:** Public-facing product resolution by slug with strict draft privacy and redirect support.  
**Scope:** `GET /api/public/products/by-slug/[slug]`. Resolves published products; queries `slug_redirects` and issues HTTP 301 for renamed slugs; returns 404 for drafts, archived products, or non-existent slugs (AC-19).  
**Acceptance Criteria:**
- Published product returns 200 with public product DTO.
- Previous slug returns 301 with new target URL.
- Draft products strictly return 404 to unauthenticated shoppers.

---

### Story 4.406: Staff Admin UI for publication checklist, slug & SEO editing
**Story ID:** E04-04-06  
**Objective:** Complete staff user experience in the product editor for publishing, slug, and SEO metadata.  
**Scope:** Product form enhancements: Slug field with validation, Meta Title / Meta Description fields with character counters, status badge (Draft / Published), Publish/Unpublish action button with confirmation dialog, and inline publication readiness checklist displaying blocking errors.  
**Acceptance Criteria:**
- Accessible in Arabic RTL layout with visible focus and keyboard navigation.
- Blocking issues are displayed with links/focus to the invalid inputs.
- Successful publish/unpublish updates the UI state without full page reload.

