# E04-03-02 Walkthrough Evidence Report

**Date:** 2026-10-15  
**Story:** E04-03-02: Read and Privately Preview a Product Gallery  
**Workflow:** `bmad-walkthrough`  
**Baseline Commit:** `6ec6dc85adad4d3b551f293feca26733a020c7ed`  
**Current Status:** `review` (awaiting explicit human approval; not promoted to `done`)  
**Recommendation:** **قابلة للقبول (Ready for Human Acceptance)**

---

## 1. Walkthrough Stops

1. **Database Schema & Additive Migration**
   - `src/db/migrations/0015_product_gallery.sql:1`: Adds `media_revision` (bigint, default 0) to `products` and creates `product_media` table with `sort_order >= 0` check.
   - `src/db/migrations/0015_product_gallery.sql:17`: Defines partial unique index `product_media_active_sort_order_uq` on `(product_id, sort_order) WHERE removed_at IS NULL`.
   - `src/db/migrations/0015_product_gallery.down.sql:1`: Reversible rollback dropping `product_media` and `products.media_revision` without touching baseline tables `products` or `media`.
   - `src/db/schema.ts:350`: Drizzle ORM table schema definitions for `productMedia` and `products.mediaRevision`.
   - `scripts/verify-gallery-schema.ts:32`: Real PostgreSQL 18.6 automated schema verification (UP -> Constraints -> DOWN -> RE-UP -> CASCADE schema cleanup).

2. **Secure Media Storage & Private Content Streaming**
   - `src/lib/media/storage.ts:45`: `readPrivate(filename)` validates filename strictly against `/^[a-z0-9_-]+\.(jpg|png|webp)$/i` to prevent directory traversal and reads file directly from private storage.
   - `src/modules/catalog/products/application/gallery-service.ts:61`: `getGalleryImageContent` verifies attachment belongs to product and `removed_at IS NULL`, fetches trusted filename from `media` table, and reads bytes.
   - `src/app/api/v1/admin/catalog/products/[id]/images/[imageId]/content/route.ts:24`: GET binary preview endpoint enforcing `requireCatalogStaffSession`, `Cache-Control: private, no-store`, and `X-Content-Type-Options: nosniff`. Never exposes storage keys or paths in headers or payloads.

3. **Read-Only Gallery Metadata Service & Endpoint**
   - `src/modules/catalog/products/contracts/gallery.ts:1`: Zod contracts for `GalleryDto`, `GalleryImageDto`, and `PublicationIssueDto`.
   - `src/modules/catalog/products/application/gallery-service.ts:8`: `getGalleryByProductId` executes read-only query ordering active images by `sort_order ASC`, derives `primaryImageId` from the first item (`sort_order = 0` or null when empty), computes blank alt text `publicationIssues`, and returns `variantImages: []`.
   - `src/app/api/v1/admin/catalog/products/[id]/images/route.ts:22`: GET endpoint wrapped with `privateHandler` and `requireCatalogStaffSession`.
   - `src/modules/catalog/products/application/product-service.ts:22`: Sanitized `ProductDto` to exclude BigInt `mediaRevision` to ensure JSON serializability for `writeAudit`.

4. **Accessible Read-Only UI Presentation**
   - `src/app/admin/(workspace)/catalog/products/product-gallery.tsx:1`: Accessible React component rendering empty state, skeleton loading, image thumbnails with primary badge on first image, missing alt text warning badge, and retry button on network error.
   - `src/app/admin/(workspace)/catalog/products/product-manager.tsx:125`: Loaded gallery data hook inside draft product manager.

---

## 2. Acceptance Criteria Traceability & Detailed Scenarios

### Scenario A: Image Ordering, Primary Derivation & Empty Gallery
- **Requirements:** Ordered by `sort_order ASC`; `primaryImageId` derived from first active attachment; returns `null` for empty gallery; returns `200` with `images: []`.
- **Implementation:** `src/modules/catalog/products/application/gallery-service.ts:30` (`orderBy(asc(productMedia.sortOrder), asc(productMedia.createdAt))`), `:42` (`images.length > 0 ? images[0].id : null`).
- **Evidence:**
  - `src/app/api/v1/admin/catalog/products/[id]/images/route.test.ts:114`: GET empty gallery returns `200` with `images: []`, `primaryImageId: null`, `revision: "0"`, and `publicationIssues: []`.
  - `src/app/api/v1/admin/catalog/products/[id]/images/route.test.ts:133`: GET populated gallery returns images in ascending position, `primaryImageId` matching first image (`pos 0`), and blank alt text creating an issue.
  - `src/app/admin/(workspace)/catalog/products/product-gallery.test.tsx:44`: Empty state renders accessible message `لا توجد صور للمنتج بعد.` without badges.
  - `src/app/admin/(workspace)/catalog/products/product-gallery.test.tsx:55`: Populated state renders primary badge `صورة رئيسية` on the first thumbnail only.

### Scenario B: Private Preview & Security Headers
- **Requirements:** Authenticated streaming of raw image bytes; correct MIME type; `Cache-Control: private, no-store`; `X-Content-Type-Options: nosniff`; internal storage keys or paths never leaked in responses.
- **Implementation:** `src/app/api/v1/admin/catalog/products/[id]/images/[imageId]/content/route.ts:50`.
- **Evidence:**
  - `src/app/api/v1/admin/catalog/products/[id]/images/route.test.ts:233`: Streams raw buffer with `content-type: image/png`, `cache-control: private, no-store`, and `x-content-type-options: nosniff`. Response body contains only binary content.

### Scenario C: Rejection of Invalid Session & Unauthorized Staff
- **Requirements:** Any unauthenticated request returns `401 Unauthorized`; authenticated request from staff without `catalog` permission returns `403 Forbidden`.
- **Implementation:** `requireCatalogStaffSession` helper enforcing staff role and catalog permission.
- **Evidence:**
  - `src/app/api/v1/admin/catalog/products/[id]/images/route.test.ts:178`: Metadata GET without session cookie returns `401`.
  - `src/app/api/v1/admin/catalog/products/[id]/images/route.test.ts:186`: Metadata GET with staff session lacking `catalog` permission returns `403`.
  - `src/app/api/v1/admin/catalog/products/[id]/images/route.test.ts:194`: Content GET without session returns `401`.
  - `src/app/api/v1/admin/catalog/products/[id]/images/route.test.ts:202`: Content GET with staff session lacking `catalog` permission returns `403`.

### Scenario D: Isolation — Rejection of Foreign Product Image or Deleted Image
- **Requirements:** Requests for an image belonging to a different product, or an image that has been soft-deleted (`removed_at IS NOT NULL`), or a nonexistent image ID must return `404 Not Found` without disclosing metadata.
- **Implementation:** `src/modules/catalog/products/application/gallery-service.ts:74` (INNER JOIN on `productId` and `removed_at IS NULL`).
- **Evidence:**
  - `src/app/api/v1/admin/catalog/products/[id]/images/route.test.ts:210`: Unknown product ID returns `404`.
  - `src/app/api/v1/admin/catalog/products/[id]/images/route.test.ts:217`: Requesting Image A under Product B returns `404 Not Found`.
  - `src/app/api/v1/admin/catalog/products/[id]/images/route.test.ts:224`: Requesting a soft-deleted attachment returns `404 Not Found`.

### Scenario E: Missing Storage File & Retry Behavior
- **Requirements:** If database record exists but underlying file bytes are absent from disk, service returns safe `503 Service Unavailable` without crashing; UI presents error and provides retry capability.
- **Implementation:** `src/modules/catalog/products/application/gallery-service.ts:87`, `src/app/admin/(workspace)/catalog/products/product-gallery.tsx:75`.
- **Evidence:**
  - `src/app/api/v1/admin/catalog/products/[id]/images/route.test.ts:246`: Missing storage file on disk returns `503 Service Unavailable`.
  - `src/app/admin/(workspace)/catalog/products/product-gallery.test.tsx:88`: Error state renders error message with `إعادة المحاولة` button that triggers retry handler.

### Scenario F: Read-Only Invariance & Revision Stability
- **Requirements:** GET requests must make zero mutations to database; `media_revision` must not increment; `products` and `product_media` tables must not alter.
- **Implementation:** No SQL `INSERT`, `UPDATE`, or `DELETE` in GET routes.
- **Evidence:**
  - `src/app/api/v1/admin/catalog/products/[id]/images/route.test.ts:168`: Product `media_revision` and attachments queried before and after consecutive GET requests; asserted to remain identical (`revision: "0"`, 0 mutations).

### Scenario G: UI States & Zero Regression on Media/Logo Protection
- **Requirements:** UI supports skeleton loading, thumbnail badges, accessibility attributes; Story 01 media upload, 10s deadline kill, and logo CSRF protection must remain 100% operational.
- **Evidence:**
  - `src/app/admin/(workspace)/catalog/products/product-gallery.test.tsx`: All 6 UI tests passed (skeleton, empty, populated, badges, retry).
  - Media & Upload regression run (`src/lib/media`, `src/app/api/media`, `src/components/Upload.test.tsx`, `profile-form.test.tsx`): **89 tests in 14 files passed** (exit code 0, 58.69 s).
  - 10-second child-process kill test passed: `src/lib/media/upload-timeout.integration.test.ts:10066ms`.
  - Logo CSRF and storage isolation tests passed.

---

## 3. Real PostgreSQL 18.6 Live Verification Results

The automated script `scripts/verify-gallery-schema.ts` was executed against local PostgreSQL 18.6 with exit code 0:

```text
[PostgreSQL Verification] Creating isolated schema gallery_e04_03_ffe86ce6546345607e7d7cbb5b1d4475...
[PostgreSQL Verification] Applying migrations 0000 through 0014...
[PostgreSQL Verification] Applying migration 0015_product_gallery (UP)...
[PostgreSQL Verification] Verified products.media_revision column (bigint, default 0).
[PostgreSQL Verification] Verified product_media table exists.
[PostgreSQL Verification] Verified partial unique index (product_id, sort_order) WHERE removed_at IS NULL.
[PostgreSQL Verification] Verified unique index product_media_product_media_uq exists.
[PostgreSQL Verification] Testing constraints and index behaviors on real PostgreSQL engine...
[PostgreSQL Verification] Verified partial unique index blocks duplicate active sort_order (23505).
[PostgreSQL Verification] Verified partial unique index allows reusing sort_order when removed_at IS NOT NULL.
[PostgreSQL Verification] Verified ON DELETE RESTRICT prevents deleting referenced media (SQLSTATE 23001).
[PostgreSQL Verification] Verified ON DELETE CASCADE removes product_media rows when product is deleted.
[PostgreSQL Verification] Verifying migration 0015_product_gallery (DOWN)...
[PostgreSQL Verification] Verified DOWN migration cleanly drops product_media & media_revision while preserving products & media.
[PostgreSQL Verification] Re-applying migration 0015_product_gallery (RE-UP)...
[PostgreSQL Verification] Verified RE-UP migration restores schema successfully.
[PostgreSQL Verification] ALL REAL POSTGRESQL CHECKS (UP -> CONSTRAINTS -> DOWN -> RE-UP) PASSED.
[PostgreSQL Verification] Cleaning up isolated schema gallery_e04_03_ffe86ce6546345607e7d7cbb5b1d4475...
[PostgreSQL Verification] Cleaned up schema gallery_e04_03_ffe86ce6546345607e7d7cbb5b1d4475.
```

### Key Technical Findings from Live Database Run:
1. **Engine-enforced Constraints:**
   - Duplicate active position conflict: correctly returns SQLSTATE `23505`.
   - Soft-deleted position reuse: PostgreSQL successfully allowed inserting a new record with the same `sort_order` once the prior record had `removed_at = NOW()`.
   - Foreign key restrict on `media_id`: attempting to delete media while attached returned SQLSTATE `23001` (`RESTRICT_VIOLATION`), verifying active protection.
   - Foreign key cascade on `product_id`: deleting the product cleanly removed all associated `product_media` records.
2. **Reversible Migration:**
   - Down migration `0015_product_gallery.down.sql` dropped only `product_media` and `products.media_revision`. Tables `products` and `media` remained intact.
   - Re-up migration restored `0015_product_gallery.sql` without error.
3. **Safety & Isolation:**
   - Run executed in isolated random schema `gallery_e04_03_ffe86ce6546345607e7d7cbb5b1d4475`.
   - Cleaned up with `DROP SCHEMA ... CASCADE` in `finally` block; base development database remained untouched.

---

## 4. Defect & Regression Assessment

- **Defects Identified:** 0 application defects.
- **Application Code Changes during Walkthrough:** 0 (strictly adhered to the rule of no application code edits during walkthrough).
- **Typecheck & Lint:**
  - `npm run typecheck`: Passed (exit code 0).
  - `npm run lint`: Passed (0 errors, 1 pre-existing warning in `Upload.tsx`).
- **Regression:** 0 regressions across catalog products and media foundations.

---

## 5. Walkthrough Recommendation

**Recommendation:** **قابلة للقبول (Ready for Human Acceptance)**.

- All acceptance criteria are met, documented, and substantiated with automated tests and live PostgreSQL engine evidence.
- The story is kept in `review` status in [`sprint-status.yaml`](file:///c:/Users/User/Documents/bmadecomm/_bmad-output/implementation-artifacts/sprint-status.yaml) and [`spec-e04-03-02-gallery-read-and-private-preview.md`](file:///c:/Users/User/Documents/bmadecomm/_bmad-output/implementation-artifacts/spec-e04-03-02-gallery-read-and-private-preview.md).
- It will NOT be moved to `done` or followed by Story 03 until explicit human approval is provided.

