---
title: "Epic 04 — Sellable catalog management: implementation stories"
status: proposed
created: 2026-10-11
sources:
  - ../stories-bmadecomm-2026-10-05/stories.md (coarse E04-01..05)
  - ../../epics/epics-bmadecomm-2026-10-05/epics.md (Epic 04)
  - ../../prds/prd-bmadecomm-v2-2026-10-05/prd.md (FR-13..16, FR-56, FR-57, AC-19, AC-20)
note: "No dedicated Epic 04 spec exists under _bmad-output/specs; decomposed from the coarse stories, epic and PRD. Replaces coarse E04-01..05 (mapping at the end)."
---

# Epic 04 — Sellable catalog management

## Conventions
- IDs `E04-nn`. Dependencies refer only to earlier IDs; external deps use existing IDs (E02-02 permissions, E03-01 store currency, F00-07 upload).
- Layers: FE / BE / DB. Each story ships its own migration, DTOs, permission checks, audit events and tests.
- Global DoD from the P0 stories file applies (server-side validation/authz, audit on state change, error envelope, a11y/RTL for new screens, no PII in logs).
- **Out of Epic 04:** stock editing (Epic 05), Brands/Reviews, storefront rendering of products (later epics).
- Seed DB names follow the architecture spine; not approved DDL.

---

### E04-01 — Category CRUD and slug uniqueness
- **Objective:** Staff create, edit and list categories.
- **Scope:** `categories` migration; create/update/list endpoints; slug generation and uniqueness; flat list screen (A-05) with create/edit form. Out: parents, ordering, delete.
- **Dependencies:** E02-02.
- **Layers:** FE, BE, DB.
- **Acceptance criteria:** category created with name + unique slug; duplicate slug rejected with field error; requires catalog permission; audit event written.
- **Tests:** API tests (create/update/duplicate slug/403); migration up/down; FE form test.

### E04-02 — Category hierarchy, ordering, cycle prevention and delete rule
- **Objective:** Organize categories as an ordered tree.
- **Scope:** `parent_id`, `sort_order`; move/reorder endpoint; cycle detection; tree UI; delete blocked if children/products exist (offer archive).
- **Dependencies:** E04-01.
- **Layers:** FE, BE, DB.
- **Acceptance criteria:** A→B→A rejected; self-parent rejected; reorder persists; delete with children/products blocked with clear error.
- **Tests:** unit cycle detection; API tests; FE tree reorder/move test.

### E04-03 — Product draft create/edit (simple product)
- **Objective:** Create a product as Draft with core fields and one default variant.
- **Scope:** `products`, `variants` (default variant with SKU, price, compare price); A-03 form: name, description, price, compare price, SKU, category links (`product_categories`), tags; Draft by default; money type in store currency. Out: multiple attributes, images, publish.
- **Dependencies:** E04-02, E03-01.
- **Layers:** FE, BE, DB.
- **Acceptance criteria:** status=Draft; SKU unique; compare price must be ≥ price (FR-13); price uses money type/store currency; category link validated; no stock fields; audit event.
- **Tests:** API tests (SKU uniqueness, compare-price rule, validation); money rounding unit test; FE form test.

### E04-04 — Variant attributes and variant matrix
- **Objective:** Add multiple variants with attribute combinations.
- **Scope:** `variant_attributes`; add/edit/remove variants; per-variant SKU, price, compare price; A-04 variant matrix UI. 🚧 Check OQ-02/05/06 for attribute limits.
- **Dependencies:** E04-03.
- **Layers:** FE, BE, DB.
- **Acceptance criteria:** duplicate attribute combination rejected; SKU unique across all variants; removing a variant keeps the others valid; product with no variants cannot be saved as multi-variant.
- **Tests:** API tests for combo/SKU uniqueness; FE matrix generation test.

### E04-05 — Draft/Archived isolation from public catalog queries
- **Objective:** Guarantee non-published products never leak (AC-19).
- **Scope:** Public catalog read query/repository with status filter; Draft and Archived excluded from list and by-slug lookups; staff reads unaffected. Out: public UI.
- **Dependencies:** E04-03.
- **Layers:** BE.
- **Acceptance criteria:** Draft/Archived return 404 on public by-id/slug and are absent from public lists; staff API still sees them.
- **Tests:** integration tests per status for both public and staff access.

### E04-06 — Product image upload and gallery
- **Objective:** Attach, remove and display images on a product.
- **Scope:** `product_media`; upload via F00-07 (type/size/magic-byte checks); remove image; gallery UI with preview. Out: reorder, variant mapping.
- **Dependencies:** E04-03, F00-07.
- **Layers:** FE, BE, DB.
- **Acceptance criteria:** spoofed file (wrong content type) rejected (AC-20); valid image stored and linked; removing an image does not break historical order references (soft-remove/snapshot).
- **Tests:** integration upload tests (valid/spoofed/oversize); FE upload component test.

### E04-07 — Image ordering, alt text and variant image mapping
- **Objective:** Control image order, accessibility text and per-variant images.
- **Scope:** reorder endpoint; alt text edit; map image to variant(s); gallery editor drag/keyboard reorder.
- **Dependencies:** E04-04, E04-06.
- **Layers:** FE, BE, DB.
- **Acceptance criteria:** order persists; first image is primary; alt text stored; variant mapping only to variants of same product.
- **Tests:** API tests; FE reorder (keyboard accessible) and alt-text test.

### E04-08 — Publish / unpublish with validation
- **Objective:** Safely publish products.
- **Scope:** publish/unpublish endpoints and button; validation: price set, ≥1 variant with SKU, all images have alt text; error list shown in UI; audit.
- **Dependencies:** E04-05, E04-07.
- **Layers:** FE, BE.
- **Acceptance criteria:** incomplete product cannot publish and returns per-rule errors; published product visible via public query; unpublish returns to Draft; Out of Stock does not hide product (FR-14).
- **Tests:** API validation matrix tests; public-visibility integration test; FE error display test.

### E04-09 — Slug editing with redirects and SEO metadata
- **Objective:** Stable URLs and basic SEO fields (FR-16).
- **Scope:** edit product/category slug; `slug_redirects` record on change of published items; unique slug enforced; meta title/description fields; redirect lookup endpoint.
- **Dependencies:** E04-08.
- **Layers:** FE, BE, DB.
- **Acceptance criteria:** slug change on published product creates a redirect old→new; redirect chains collapse; duplicate slug rejected; meta length limits validated.
- **Tests:** redirect record test; chain collapse unit test; API tests; FE SEO form test.
- **Note:** Canonical, Open Graph, sitemap, robots and JSON-LD (rest of FR-16) are storefront output; confirm with owner which epic carries them.

### E04-10 — Duplicate product
- **Objective:** Clone a product as a new Draft.
- **Scope:** duplicate endpoint and action; new slug, SKUs cleared, unpublished, images referenced/copied per storage rule.
- **Dependencies:** E04-08.
- **Layers:** FE, BE.
- **Acceptance criteria:** copy is Draft, has new unique slug, no SKUs (FR-14); categories/attributes copied; original unchanged.
- **Tests:** API test; FE confirm dialog test.

### E04-11 — Archive and restore product
- **Objective:** Remove from sale while preserving history.
- **Scope:** archive/restore endpoints and UI; archived hidden from public.
- **Dependencies:** E04-08.
- **Layers:** FE, BE.
- **Acceptance criteria:** archived hidden publicly; order, category and slug relations kept; restore returns to Draft; audit event.
- **Tests:** API tests; public-visibility test; FE confirm test.

### E04-12 — Delete only never-referenced products
- **Objective:** Prevent history corruption (FR-56/57).
- **Scope:** delete endpoint with reference check; UI shows "archive instead" when blocked. Reference check is an extension point (orders/carts/inventory) completed as those epics land.
- **Dependencies:** E04-11.
- **Layers:** FE, BE.
- **Acceptance criteria:** unreferenced Draft deleted; referenced product rejected with reason; delete removes media/variant rows consistently; audit event.
- **Tests:** API tests both paths; transactional cleanup test; FE dialog test.

---

## Dependency order
`E04-01 → 02 → 03 → 04 → 07` ; `03 → 05` ; `03 → 06 → 07` ; `05+07 → 08 → 09 / 10 / 11 → 12`

Each story is a vertical slice; E04-05 is BE-only (guard rail), E04-10..12 need no migration.

## Mapping from coarse stories
| Coarse | New |
|---|---|
| E04-01 | E04-01, E04-02 |
| E04-02 | E04-03, E04-04, E04-05 |
| E04-03 | E04-06, E04-07 |
| E04-04 | E04-08, E04-09 |
| E04-05 | E04-10, E04-11, E04-12 |

