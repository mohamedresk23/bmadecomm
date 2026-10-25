---
title: E07 Homepage content publishing — implementation stories
status: approved-breakdown
created: 2026-10-22
parent: original-E07
workflowStep: step-03-create-stories
sources:
  - ../../../specs/spec-e07-homepage-content-publishing/SPEC.md
  - ../../../specs/spec-e07-homepage-content-publishing/implementation-contract.md
  - ../../epics/epics-bmadecomm-2026-10-05/epics.md
  - ../../prds/prd-bmadecomm-v2-2026-10-05/prd.md
---

# Epic 07: Homepage content publishing

Staff can safely compose homepage sections, preview drafts under strict authorization, publish them atomically to the public storefront, and ensure that unpublished or archived products are dynamically filtered out. Three vertical stories govern delivery.

The [implementation contract](../../../specs/spec-e07-homepage-content-publishing/implementation-contract.md) and [SPEC.md](../../../specs/spec-e07-homepage-content-publishing/SPEC.md) are authoritative for schemas, endpoints, and validation rules.

---

## Delivery sequence

| ID | Outcome | Layers | Prerequisites |
|---|---|---|---|
| E07-01 | Migration 0019 introduces `homepage_drafts` and `homepage_publications`, draft validation/service/API, and `A-12` editor UI | Database, Backend, Frontend | E02-02, E04-04 |
| E07-02 | Authorized preview route rendering draft with `S-01` components, `noindex`, and `private, no-store` headers | Backend, Frontend | E07-01 |
| E07-03 | Atomic publish mutation, `homepage_publications` snapshot creation, cache invalidation, and public `S-01` rendering with live catalog filtering | Database, Backend, Frontend | E07-02 |

---

## Detailed Stories

### Story 7.101: Homepage sections draft editor
**Story ID:** E07-01  
**Objective:** Staff compose, enable/disable, and order homepage sections in a persistent draft.  
**Scope:**
- Migration 0019 adding `homepage_drafts` (singleton key `'default'`) and `homepage_publications`.
- Schema validator for approved section types (`hero`, `featured_categories`, `featured_products`, `best_sellers`, `new_arrivals`, `promotions`).
- Backend service and APIs (`GET /api/v1/admin/content/homepage`, `PUT /api/v1/admin/content/homepage`) gated by `content.read`/`content.manage` with optimistic concurrency (`expectedRevision`) and audit logging.
- Admin UI `A-12` at `/admin/content/homepage` with section toggles, category/product pickers, and keyboard-accessible Move Up / Move Down reordering controls (WCAG 2.5.7) in Arabic RTL.
**Acceptance Criteria:**
- Unapproved section types or malformed payloads return 400/422 with structured field issues.
- Product/category reference IDs are validated against existing records; non-existent IDs return 422.
- Stale revision returns 409 Conflict.
- Successful save writes `audit_events` and increments draft revision.
- Customer and guest sessions receive 401/403.

---

### Story 7.102: Authorized draft preview
**Story ID:** E07-02  
**Objective:** Staff preview the draft before publishing using storefront components.  
**Scope:**
- Preview API and `/admin/content/homepage/preview` route rendering current draft with `S-01` presentation components.
- Protected by active staff session with `content.read` or `content.manage`.
- Enforces `Cache-Control: private, no-store`, `Pragma: no-cache`, `X-Robots-Tag: noindex, nofollow`, and `<meta name="robots" content="noindex, nofollow" />`.
**Acceptance Criteria:**
- Unauthenticated or customer sessions receive 401/403.
- Preview displays current draft sections without altering database state.
- Preview is never cached in public/shared caches.

---

### Story 7.103: Publish and public storefront homepage
**Story ID:** E07-03  
**Objective:** Shoppers see a consistent published homepage backed by live published catalog items.  
**Scope:**
- `POST /api/v1/admin/content/homepage/publish` creating immutable `homepage_publications` snapshots (`version = N + 1`) and writing audit event.
- Next.js cache invalidation (`revalidatePath("/")`).
- Storefront homepage root (`/`, `S-01`) and `GET /api/v1/store/homepage` reading latest publication snapshot.
- Live catalog filtering at render: drafts/archived products and inactive categories are dynamically filtered out.
**Acceptance Criteria:**
- Draft edits remain strictly invisible on public `/` until explicit publish.
- Unpublished or archived products are omitted at render time without breaking layout (`AC-19`).
- Empty publication or no enabled sections renders a clean, accessible empty state.
- Public `/` displays responsive RTL layout across 320px–1440px without P1 controls (`UX-10`).

