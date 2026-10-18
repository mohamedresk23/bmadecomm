# Walkthrough: E04-03-04 Save Alt Text and Show Publication Readiness

**Date:** 2026-10-18  
**Story ID:** E04-03-04 (`4-304-save-alt-text-and-show-publication-readiness`)  
**Status:** Ready for Human Review  
**Commit:** `3c85f38`

---

## 1. Overview & Intent

Story `E04-03-04` delivers safe, revision-guarded gallery editing and publication readiness reporting for draft products:
- Staff can edit plain-text alt descriptions (up to 500 characters) for any active attachment.
- The gallery is saved atomically via `PUT /api/v1/admin/catalog/products/[id]/images` with optimistic concurrency control (`expectedRevision`).
- Edits are validated against strict active gallery membership; no-op submissions (unchanged alt text and order) suppress revision increments and audit logging.
- Active images with empty or whitespace-only alt text are dynamically reported as publication issues (`publicationIssues`), rendering visible readiness warnings without blocking draft persistence.
- Local dirty state is tracked, with user confirmation protecting against accidental data loss when switching products, uploading new images, or navigating away.

---

## 2. Changes Implemented

### Backend & Database Services:
- `src/modules/catalog/products/contracts/gallery.ts`: Defined `updateGallerySchema` and `UpdateGalleryDto`, bounding `expectedRevision` to signed 64-bit integer limits, bounding alt text to 500 characters without control characters, and rejecting non-empty `variantImages` in this slice.
- `src/modules/catalog/products/application/gallery-service.ts`: Implemented `updateGallery` with product row lock (`FOR UPDATE`), active `product_media` row locks in stable `id ASC` order, `expectedRevision` check (raising 409 `STALE_GALLERY`), strict membership validation, no-op suppression, atomic revision increment, and transactional audit event recording (`catalog.product.gallery.update`).
- `src/app/api/v1/admin/catalog/products/[id]/images/route.ts`: Exported `PUT` handler with live catalog staff session authentication, CSRF validation, bounded JSON parsing (64 KiB), and field error mapping.

### Frontend UI & State Management:
- `src/app/admin/(workspace)/catalog/products/product-gallery.tsx`: Added editable alt text inputs with test IDs and inline errors, dirty tracking badge (`isDirty`), "حفظ المعرض" button, conflict error alerts with reload button, accessible live region announcement on save success, disabled states while saving, and upload confirmation on dirty edits.
- `src/app/admin/(workspace)/catalog/products/product-manager.tsx`: Connected `isGalleryDirty` into `canReplace()` so switching products or resetting prompts confirmation before discarding unsaved gallery edits.

### Verification & Testing:
- `src/app/api/v1/admin/catalog/products/[id]/images/route.test.ts`: Added tests for happy-path alt text save, no-op audit suppression, 409 stale revision, non-draft rejection, membership mismatch, 422 alt text bounds, 64-bit revision bounds, and concurrent update races.
- `src/app/admin/(workspace)/catalog/products/product-gallery.test.tsx`: Added unit tests for alt inputs, dirty badges, save submissions, readiness warning toggle, conflict reload, dirty upload prompt, and unmount cleanup.
- `src/app/admin/(workspace)/catalog/products/product-manager.test.tsx`: Added integration test for dirty gallery replacement protection.

---

## 3. How to Run the Verifications

```powershell
npx.cmd vitest run "src/app/api/v1/admin/catalog/products/[id]/images/route.test.ts" "src/app/admin/(workspace)/catalog/products/product-gallery.test.tsx" "src/app/admin/(workspace)/catalog/products/product-manager.test.tsx"
npm.cmd run typecheck
npm.cmd run lint
```

Expected output:
- Route, Gallery, and Manager tests: 106 passed (100%).
- Typecheck: 0 errors.
- Lint: 0 errors.
