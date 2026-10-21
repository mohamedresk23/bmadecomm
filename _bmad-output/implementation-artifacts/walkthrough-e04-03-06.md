# Walkthrough: E04-03-06 Map Images to Variants Without Losing Assignments

**Date:** 2026-10-19  
**Story ID:** E04-03-06 (`4-306-map-images-to-variants-without-losing-assignments`)  
**Status:** Accepted (Approved by Human)  
**Commit:** `65913c36fb4af94c911e47c3eefa1585e740ee3a`  
**Baseline Commit:** `23054b5e79d1a0eaa39595b4c15310f3042ecf1f`

---

## 1. Overview & Intent

Story `E04-03-06` enables catalog staff to map product gallery images to specific product variants and share them across multiple variants, ensuring transactional preservation across variant edits (SKU and attribute swaps) while atomically cleaning up removed variant mappings.

Key capabilities delivered:
- Optional shared image assignment per variant with same-product composite foreign key integrity (`ON DELETE RESTRICT`).
- Unmapped variants resolve safely via fallback: assigned image -> primary image -> null (with signed private URLs isolated from public product DTOs).
- Preservation across variant row replacement in `saveProduct`: retained IDs keep their image mappings even if SKU or attributes change.
- Removed variants automatically clear their mappings with atomic revision increment (`mediaRevision + 1`) and audit logging (`clearedVariantImages`).
- Local dirty state protection: unsaved gallery edits (`mappings`, `altTexts`, `order`) are preserved through background refreshes and API errors (401/422/503/network), with explicit confirmation required to discard.
- UI synchronization: product operations are locked while the gallery is saving/uploading (`galleryBusy`).
- Full accessibility: minimum touch target of 44px (`min-h-11`), keyboard selection via Arrow/Tab, and full RTL layout across 320px, 768px, 1024px, and 1440px viewports.

---

## 2. Key Code Areas

### Database Schema & Integrity
- `src/db/schema.ts:339`: Composite unique index on `variants(product_id, id)`.
- `src/db/schema.ts:368`: Composite unique index on `product_media(product_id, id)`.
- `src/db/schema.ts:375`: Table `variant_media` with primary key `variant_id` and composite foreign keys restricting references to the same product.
- `src/db/migrations/0017_variant_media.sql`: Additive migration for indexes and mapping table.

### Backend Contracts & Application Services
- `src/modules/catalog/products/contracts/gallery.ts:70`: Zod schema `superRefine` validating unique variant IDs and membership within active gallery images.
- `src/modules/catalog/products/application/product-service.ts:103`: `saveProduct` locks attachments (`id ASC`), retains mappings for persisting IDs, deletes removed mappings, atomically increments `mediaRevision`, and logs audit diff.
- `src/modules/catalog/products/application/gallery-service.ts:509`: `updateGallery` checks active variants and images, suppresses no-op writes, and atomically updates `variant_media`.
- `src/modules/catalog/products/application/gallery-service.ts:631`: `resolveVariantImage` helper for explicit/primary/null fallback.

### Frontend Components & State Management
- `src/app/admin/(workspace)/catalog/products/product-manager.tsx:68`: Tracks `persistedVariants` and locks product save/actions when `galleryBusy` is active.
- `src/app/admin/(workspace)/catalog/products/product-gallery.tsx:82`: Computes `mappingDirty` into `isDirty`.
- `src/app/admin/(workspace)/catalog/products/product-gallery.tsx:103`: Preserves dirty local state upon incoming revision change or variant deletion.
- `src/app/admin/(workspace)/catalog/products/product-gallery.tsx:300`: Maps indexed server validation errors to the matching variant selector.
- `src/app/admin/(workspace)/catalog/products/product-gallery.tsx:460`: Accessible dropdown selectors for persisted variants with 44px touch targets.

---

## 3. Verification & Evidence

- **Unit & UI Tests:** 133 tests passed across 5 test suites (`product-gallery.test.tsx`, `product-manager.test.tsx`, `variant-images.test.ts`, `gallery.test.ts`, `route.test.ts`).
- **PostgreSQL Tests:** 17 tests passed against real PostgreSQL 18.6 in isolated disposable schemas.
- **Browser Verification:** Edge browser authenticated test suite passed across 320px, 768px, 1024px, and 1440px RTL viewports with touch and keyboard interaction.
- **Typecheck & Lint:** Passed with zero TypeScript errors.

---

## 4. Acceptance Record

- **Reviewed by:** Human User
- **Decision:** Approved (`Approve`)
- **Sprint Status:** Updated to `done` in `_bmad-output/implementation-artifacts/sprint-status.yaml`

