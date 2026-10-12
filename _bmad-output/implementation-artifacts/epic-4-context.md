# Epic 4 Context: Sellable catalog management

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Enable staff to manage product categories, products, and variants in draft and published states with strict uniqueness, slug redirection, media associations, and isolation of unpublished items from public discovery.

## Stories

- Story 4.1: Category CRUD and slug uniqueness
- Story 4.2: Category hierarchy, ordering, cycle prevention and delete rule
- Story 4.3: Product draft create/edit (simple product)
- Story 4.4: Variant attributes and variant matrix
- Story 4.5: Draft/Archived isolation from public catalog queries
- Story 4.6: Product image upload and gallery
- Story 4.7: Image ordering, alt text and variant image mapping
- Story 4.8: Publish / unpublish with validation
- Story 4.9: Slug editing with redirects and SEO metadata
- Story 4.10: Duplicate product
- Story 4.11: Archive and restore product
- Story 4.12: Delete only never-referenced products

## Requirements & Constraints

- Products and variants support drafts: newly created products default to `Draft` and are strictly excluded from public storefront APIs and queries (FR-13, FR-14, AC-19).
- Uniqueness guarantees: SKU uniqueness enforced globally across all active variants; duplicate attribute combinations per product are rejected; category and product slugs must be unique (FR-13, FR-14, FR-57).
- Pricing: Price must be stored as a monetary value using the store default currency (`E03-01`). Compare price (if present) must be greater than or equal to standard price (FR-13).
- Lifecycle integrity:
  - Duplicating a product clears SKUs, creates a fresh slug, and sets status to Draft (FR-14).
  - Archiving hides the product from the public catalog while preserving relational integrity with categories and past orders (FR-14, FR-56).
  - Deletion is forbidden if a product or variant has ever been referenced by orders, carts, or transactions (FR-56, FR-57).
  - Category deletion is rejected if child categories or assigned products exist (or triggers archival).
- SEO & URL stability: Slug changes on published items create 301/canonical redirects in `slug_redirects`; duplicate slugs rejected (FR-16).
- Media validation: Media uploads must validate MIME types/magic bytes via storage service (`F00-07`), reject executable/spoofed files, require alt text for publication, and preserve historical references upon removal (FR-15, AC-20).

## Technical Decisions

- Data entities: `categories`, `products`, `variants`, `variant_attributes`, `product_categories`, `product_media`, `slug_redirects`.
- Public queries filter strictly on published status (`status = 'published'`).
- Staff APIs enforce catalog action and field permissions per `E02-02` policy framework and write audit events on every mutation.
- Relational integrity enforced via PostgreSQL foreign keys, unique constraints (on SKU and slug), and transactional boundaries.

## UX & Interaction Patterns

- Staff Admin Catalog UI: A-03 (Product draft form), A-04 (Variant matrix editor), A-05 (Category tree and list editor).
- Server-side error validation and feedback for SKU collisions, cyclic category assignment, and publishing readiness checklist.
- Support RTL layout and accessible keyboard interactions (NFR-08, NFR-09).

## Cross-Story Dependencies

- Foundation storage adapter (`F00-07`) for image upload and validation.
- Store currency and locale settings (`E03-01`) for money handling.
- Staff permission enforcement and audit framework (`E02-02`).
- Out of scope for Epic 04: Stock balances, ledger, and manual adjustments (handled in Epic 05).

