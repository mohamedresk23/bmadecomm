# Walkthrough: E04-03-03 Upload a Draft image with safe retry

**Date:** 2026-10-15  
**Story ID:** E04-03-03 (`4-303-upload-a-draft-image-with-safe-retry`)  
**Status:** Ready for Human Review  

---

## 1. Overview & Intent

Story `E04-03-03` completes the upload capability for draft products in the admin catalog workspace:
- Authorized staff can upload JPEG, PNG, or WebP images to a draft product directly from the product workspace.
- Uploads append images at the next position (`sort_order = max + 1`), bump `media_revision`, and record a `catalog.product.image.attach` audit event.
- Concurrent and retried uploads are safeguarded by actor/product-scoped idempotency keys (`operation_keys`), lease fencing, and canonical row lock ordering.
- Staff members are protected from flood attacks by a shared rate limit of 20 attempts per 10 minutes returning `429 Too Many Requests` with a `Retry-After` header.
- Galleries are strictly capped at 10 active attachments.
- Failures during storage or persistence trigger immediate Option A compensation deletion, with failed deletions safely recorded in orphan logs without exposing internal paths.

---

## 2. Changes Implemented

### Database & Migrations:
- `src/db/migrations/0016_upload_rate_limit.sql` & `.down.sql`: Created `upload_rate_buckets` table for staff-wide upload rate throttling.
- `src/db/migrations/meta/_journal.json`: Registered migration 0016.
- `src/db/schema.ts`: Added `uploadRateBuckets` table definition with positive attempts constraint.

### Backend Infrastructure & Services:
- `src/modules/catalog/products/infrastructure/upload-rate-limit.ts`: Implemented `throttleStaffUpload` (20 attempts / 600s).
- `src/modules/catalog/products/contracts/gallery.ts`: Added `UploadImageResponse`, byte bounds constants (`MAX_FILE_SIZE = 5,242,880`, `MULTIPART_OVERHEAD = 65,536`, `MAX_REQUEST_BODY = 5,308,416`, `MAX_ACTIVE_IMAGES = 10`, `IDEMPOTENCY_WINDOW_MS = 86,400,000`), and exported `GalleryDto`, `GalleryImageDto`, and `GalleryResponse`.
- `src/modules/catalog/products/application/gallery-service.ts`: Implemented `uploadGalleryImage`:
  - Request footprint hashing based on raw incoming bytes.
  - Phase 1: Fast key reservation and completed replay detection (< 5ms).
  - Phase 2: Off-DB private image processing (0 DB connections held).
  - Phase 3: Atomic persistence transaction (< 15ms) under `products` row lock (`FOR UPDATE`) then `operation_keys` row lock (`FOR UPDATE`).
  - Active lease wait/poll loop for concurrent duplicate requests.
  - Option A compensation cleanup in `catch`.
- `src/app/api/v1/admin/catalog/products/[id]/images/route.ts`: Added `POST` endpoint with staff session authentication, CSRF validation, body stream bounding, and `Retry-After` header mapping.

### Frontend UI:
- `src/app/admin/(workspace)/catalog/products/product-gallery.tsx`: Added file selection input (`image/jpeg,image/png,image/webp`), "رفع الصورة" upload button, in-flight state ("جارٍ الرفع…"), client idempotency key generation and reuse on retry, capacity limit badge ("تم بلوغ الحد الأقصى (10 صور)"), localized error alert, and retry button.
- `src/app/admin/(workspace)/catalog/products/product-manager.tsx`: Passed `csrf={collection?.csrf}` and `onUploadSuccess={(updated) => setGallery(updated)}` to `ProductGallery`.

### Verification & Testing:
- `scripts/verify-gallery-upload-concurrency.ts`: Dedicated multi-process script launching independent Node.js processes against real PostgreSQL 18.6 in an isolated schema to prove cross-process deduplication and slot-10 capacity race conditions.
- `src/app/api/v1/admin/catalog/products/[id]/images/route.test.ts`: Added 16 integration tests for POST upload (auth, CSRF, key validation, draft status, append, revision bump, audit, replay, payload mismatch, key expiry, capacity limit, rate limiting, corrupt images, staged compensation, orphan logging).
- `src/app/admin/(workspace)/catalog/products/product-gallery.test.tsx`: Added UI unit tests for file selection, upload submission, capacity badge, and error retry.
- `_bmad-output/implementation-artifacts/deferred-work.md`: Recorded entry for Production Orphan Media Discovery & Automated Reaper.

---

## 3. How to Run the Verifications

### 1. Run the Real PostgreSQL 18.6 Multi-Process Concurrency Test:
```powershell
npx.cmd tsx scripts/verify-gallery-upload-concurrency.ts
```
Expected output:
- Test 1: Spawns Worker 1 and Worker 2 concurrently; both exit 0 with identical image IDs; PostgreSQL records 1 attachment and 1 audit event.
- Test 2: Spawns Worker 3 and Worker 4 racing for slot 10; Worker 3 succeeds (position 9); Worker 4 fails with 422; PostgreSQL records exactly 10 attachments.
- Clean isolated schema drop.
- Exit code 0.

### 2. Run Route & UI Integration Tests:
```powershell
npx.cmd vitest run "src/app/api/v1/admin/catalog/products/[id]/images/route.test.ts"
npx.cmd vitest run "src/app/admin/(workspace)/catalog/products/product-gallery.test.tsx"
```
Expected output:
- `route.test.ts`: 24 passed (100%).
- `product-gallery.test.tsx`: 9 passed (100%).

### 3. Run Static Analysis:
```powershell
npm.cmd run typecheck
npm.cmd run lint
```
Expected output:
- Typecheck: 0 errors (Exit code 0).
- Lint: 0 errors (Exit code 0).

---

## 4. Current State & Next Steps

- Story `E04-03-03` is currently in **`review`** status.
- In accordance with project instructions, Story 03 will **not** be marked `done` until explicit human sign-off is granted by the user.
- Stories 04 through 07 remain untouched in the backlog.

