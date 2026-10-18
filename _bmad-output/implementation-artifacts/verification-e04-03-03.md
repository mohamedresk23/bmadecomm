# Verification Report: E04-03-03 Upload a Draft image with safe retry

**Date:** 2026-10-15  
**Story ID:** E04-03-03 (`4-303-upload-a-draft-image-with-safe-retry`)  
**Status:** Verification Passed (Ready for Human Review)  
**Execution Environment:** Windows, Node.js v20+, PostgreSQL 18.6 Local Server (`127.0.0.1:5432`)

---

## 1. Executive Summary

Story `E04-03-03` implements secure multipart image uploads for draft products (`POST /api/v1/admin/catalog/products/{id}/images`) with actor/product-scoped idempotency keys (`operation_keys`), off-DB private image processing via isolated child workers, transactional append with global deadlock-free canonical lock ordering (`products` FOR UPDATE, then `operation_keys` FOR UPDATE), staff rate limiting (20 attempts / 10 minutes), capacity enforcement (max 10 active attachments), and Option A compensation cleanup with maintenance logging.

All automated acceptance tests, multi-process PostgreSQL 18.6 concurrency tests, type checking, and linting have executed and passed with 0 errors.

---

## 2. Acceptance Criteria Traceability Matrix

| Acceptance Criterion | Verification Method | Result | Evidence / Test Details |
|---|---|---|---|
| **AC 1:** Draft 201 upload, next position append, 1 revision bump, 1 audit event, private thumbnail storage. | `route.test.ts` (Tests 6 & 7) & `verify-gallery-upload-concurrency.ts` | **PASS** | Successfully uploaded PNG; assigned position 0 (then 1 on second upload); `media_revision` incremented; `catalog.product.image.attach` audit row committed; private file stored. |
| **AC 2:** Unsaved UI requires saving first; non-draft writes fail without mutation. | `product-gallery.test.tsx` (Test 1) & `route.test.ts` (Test 5) | **PASS** | UI renders placeholder when unsaved; published and archived product upload requests rejected with `409 Conflict` without mutating state. |
| **AC 3:** Parallel identical keys/files or lost response return single commit; reused key with different file returns 409; expired key rejected. | `route.test.ts` (Tests 8, 9, 10) & `verify-gallery-upload-concurrency.ts` (Test 1) | **PASS** | Replaying identical key returns cached 201 with 0 extra attachments/audit rows; different file returns `409 Conflict ("Idempotency payload mismatch")`; >24h key returns `409 Conflict ("Idempotency key expired")`. |
| **AC 4:** Capacity capped at 10 active attachments; 429 rate limit with Retry-After. | `route.test.ts` (Tests 11, 12, 13), `product-gallery.test.tsx` (Test 7), `verify-gallery-upload-concurrency.ts` (Test 2) | **PASS** | 11th upload rejected with `422 Unprocessable Entity`; UI hides upload form at 10 images; 21st upload within 10 min returns `429 Too Many Requests` with `Retry-After: <seconds>` header; replay does not consume quota. |
| **AC 5:** Injected DB failure triggers compensation cleanup; failed deletion recorded in orphan log without client path disclosure. | `route.test.ts` (Tests 15 & 16) | **PASS** | Injected failure inside Tx #2 deletes staged file via `storage.removePrivate`; if storage removal throws, `storage.recordOrphan` logs orphan record; no internal paths exposed to client. |

---

## 3. Real PostgreSQL 18.6 Multi-Process Concurrency Verification

To fulfill the explicit requirement for testing cross-process concurrency deduplication and capacity races across independent Node.js processes against the real PostgreSQL 18.6 instance, `scripts/verify-gallery-upload-concurrency.ts` was executed:

```
Command: npx.cmd tsx scripts/verify-gallery-upload-concurrency.ts
Exit Code: 0
```

### Execution Output:
```text
[Concurrency Verification] Creating isolated schema gallery_concurrency_b761b6a2414555a720ccba3ae0231d23...
[Concurrency Verification] Applying migrations 0000 through 0016 in isolated schema...
[Concurrency Verification] Seeding test staff user and draft product...

--- TEST 1: Two Independent Node Processes Racing with Identical Idempotency Key ---
[Test 1] Spawning Worker 1 and Worker 2 concurrently with key: idemp_shared_53e615f599360af3...
[Test 1] Worker 1 exit code: 0, result: {
  success: true,
  workerId: 1,
  result: {
    image: {
      id: 'olpwgcf7715ygepd66yeu80f',
      mediaId: 'sfdz9p9olxaz36bnkfbh5efl',
      position: 0,
      previewUrl: '/api/v1/admin/catalog/products/prd_conc_48550442/images/olpwgcf7715ygepd66yeu80f/content'
    },
    gallery: { revision: '1', primaryImageId: 'olpwgcf7715ygepd66yeu80f' }
  }
}
[Test 1] Worker 2 exit code: 0, result: {
  success: true,
  workerId: 2,
  result: {
    image: {
      id: 'olpwgcf7715ygepd66yeu80f',
      mediaId: 'sfdz9p9olxaz36bnkfbh5efl',
      position: 0,
      previewUrl: '/api/v1/admin/catalog/products/prd_conc_48550442/images/olpwgcf7715ygepd66yeu80f/content'
    },
    gallery: { revision: '1', primaryImageId: 'olpwgcf7715ygepd66yeu80f' }
  }
}
[Test 1 PASS] Concurrency deduplication across independent Node processes verified successfully!

--- TEST 2: Slot 10 Capacity Race (Two Processes Racing for Slot 10) ---
[Test 2] Seeding gallery up to 9 active attachments (slots 0..8)...
[Test 2] Spawning Worker 3 (key_race_A) and Worker 4 (key_race_B) racing for the 10th slot...
[Test 2] Worker 3: exitCode=42, result: {
  success: false,
  workerId: 3,
  statusCode: 422,
  message: 'Product gallery cannot exceed 10 active images'
}
[Test 2] Worker 4: exitCode=0, result: {
  success: true,
  workerId: 4,
  result: {
    image: { id: 'kv8ef9p57p49fpnoyzhrd78l', position: 9 },
    gallery: { revision: '10' }
  }
}
[Test 2 PASS] Capacity race condition enforced: exactly 10 images active in PostgreSQL!

=======================================================
  ALL REAL POSTGRESQL CONCURRENCY CHECKS PASSED (EXIT 0)
=======================================================

[Concurrency Verification] Dropping isolated schema "gallery_concurrency_b761b6a2414555a720ccba3ae0231d23"...
[Concurrency Verification] Isolated schema dropped cleanly.
```

---

## 4. Test Suite Execution Summary

### 1. Route API Integration Tests (`src/app/api/v1/admin/catalog/products/[id]/images/route.test.ts`)
- **Total Tests:** 24 passed (100%)
- **Coverage:**
  - 8 GET tests: Session auth (401/403), 404 unknown/soft-removed/foreign isolation, derived primary, blank alt issue flagging, private preview streaming, 503 missing storage.
  - 16 POST tests: Session auth (401/403), invalid/missing CSRF (403), invalid/oversized Idempotency-Key (400), non-draft rejection (409), 201 successful upload with sort_order 0, revision bump and audit, successive upload at position 1 and revision 2, idempotent replay returning cached 201 with zero duplicate attachments, 409 payload mismatch, 409 expired key (>24h), 422 capacity limit (10 images), 429 staff rate limit (20 attempts / 10 min) with `Retry-After`, quota exemption on replay, 415 corrupt image rejection, staged file compensation on DB failure, and orphan logging on storage removal failure.

### 2. Frontend UI Unit Tests (`src/app/admin/(workspace)/catalog/products/product-gallery.test.tsx`)
- **Total Tests:** 9 passed (100%)
- **Coverage:**
  - Unsaved product placeholder.
  - Loading skeleton indicators.
  - Error alert with retry button.
  - Empty gallery placeholder.
  - Populated thumbnails with primary badge and alt text issues.
  - Broken preview image retry.
  - File selection, in-flight state, POST request with `Idempotency-Key` and `X-CSRF-Token`.
  - Max capacity badge disabling upload when gallery has 10 images.
  - Localized error message display and upload retry reusing the exact same client idempotency key.

### 3. Media Regression Suite
- **Total Tests:** 106 passed across 14 test files (100%)
- All upload, processing deadline, deployment DB isolation, publish, request bounding, and storage tests pass cleanly.

---

## 5. Static Analysis & Code Quality

- **TypeScript Typecheck (`npm.cmd run typecheck`):** Exit Code 0 (0 errors).
- **ESLint (`npm.cmd run lint`):** Exit Code 0 (0 errors).

---

## 6. Verification Verdict

**Verdict:** **PASSED**  
The implementation satisfies all architectural, security, and acceptance criteria for Story `E04-03-03`. The story is placed in `review` status awaiting human sign-off.



## Upload review remediation evidence - 2026-10-18

Implementation follows spec-e04-03-03-upload-review-remediation.md. Story remains review; browser/human acceptance is outstanding.

- Upload API/service focused suite: 49 tests passed. Includes lost COMMIT response returning the committed result, unavailable independent locking probe preserving media and lease, confirmed audit rollback cleanup, superseded-token fencing, immediate active-payload mismatch, disappeared lease reacquisition, abort without duplicate quota, static-only validation/MIME mismatch, expired incomplete key, revoked/expired session replay, Draft replay, storage same-key retry, hostile Origin, correlation IDs, removed positions, and precise rate rollover/Retry-After. Final delayed-waiter regression verifies a newly won lease receives its acquisition timestamp and a following duplicate cannot immediately reclaim it.
- ProductManager: 11 tests passed, including first-save gallery load, CSRF forwarding, upload gallery callback, and retaining unrelated local form edits. The upload response in this component wiring fixture is simulated; API byte processing is verified separately.
- ProductGallery, FIFO processor gate and storage focused tests passed; post-lint-fix UI/gate rerun: 2 files, 13 tests. FIFO gate final suite: 3 tests passed; verifies four actual children, two ordered waiters, abort removal, next child starting only after close, fifteen-second queue expiry, and safe synchronous spawn failure with slot release. Existing processor tests retain actual-child deadline/abort verification.
- Configurable multipart request test covers catalog fifteen-second timeout and custom byte bound while generic ten-second behavior remains covered.
- Extended real PostgreSQL harness passed exit 0 with independently spawned processes: identical-key deduplication, competing stale lease reclaim with one quota consumption, retained removed position 999 ignored on append, and slot-ten capacity race. Final run used isolated schema gallery_concurrency_9a841f19686df0989242829b7463803a and temporary per-run media storage; schema and temporary files were removed. Three known files from the earlier harness run were individually removed after confirming matching filenames, timestamps and 132-byte sizes.

Lease tokens now carry an opaque UUID plus acquisition epoch milliseconds. Original created_at remains unchanged across reclaim so the 24-hour nonreusable-key policy is preserved. Legacy UUID tokens use created_at for lease age. No schema migration is required.

Manual checks still required: create and first-save a Draft then upload a valid image; switch products during an upload and verify no old result enters the selected gallery; submit an animated/oversized image and verify accurate feedback without permanent-error retry; simulate transient failure and retry the same file/key. Verify private thumbnails/reload and keyboard/screen-reader behavior. Automated component tests do not establish browser acceptance.

Parent verification before review patches: 130 related tests passed across fourteen files; TypeScript passed; ESLint passed with one existing Upload.tsx image warning. Webpack production build (`npm.cmd run build -- --webpack`) passed, including TypeScript and static page generation. Default Turbopack build failed while reading an inaccessible old BMAD render directory; its earlier sandbox attempt also could not fetch Google Fonts.

The full default Vitest run completed with 523 passed, eight failed, one skipped and one todo (72 files). Six failures are unchanged baseline migration expectations for 0014 despite existing 0015/0016. One provision-owner test hit sandbox EPERM removing its temporary directory; its isolated escalated rerun passed. One processor gate test ran against the earlier in-flight source; the final three-test gate and fourteen-file rerun passed. This is not a claim that the full repository suite is green. Review patch verification is recorded below when complete.

### Final review patch results

- Three edited-module suites: 68 tests passed, including healthy-worker lease renewal, transient 409 same-key retry, unavailable-gallery retry disabling, generic 422 fallback and independent recovery-log failures. Final API rerun after the post-lock expiry/hash guards: 50 tests passed.
- Real PostgreSQL held-original fixture passed: recovery waits while the original transaction owns its key lock, preserves bytes before resolution, and returns the committed result after release. Its timeout variant returns 503 with bytes/reservation intact; committing the original and retrying returns the same single attachment. Final schema `gallery_concurrency_ec7947a6a5ba8ba03d835540a1544ddb` and temporary storage were cleaned.
- Final full run `npm.cmd test -- --pool=threads`: 534 passed, seven failed, one skipped, one todo, 72 files, 243.12 seconds. The failures are the six previously identified baseline migration assertions plus the sandbox-only provision-owner temporary-directory removal failure. No upload/remediation test failed. The isolated escalated provision-owner rerun passed.
- Typecheck passed, ESLint passed with one existing Upload.tsx image warning, and the final Webpack production build passed after review patches. Default Turbopack's inaccessible old BMAD directory remains an environment/build limitation.
- All review patch groups are resolved. General database/pool cancellation and old migration-test expectations are recorded as deferred work. Story remains review; the manual checks above still require human/browser acceptance.
