---
title: 'E04-03-02: Read and privately preview a product gallery'
type: feature
created: '2026-10-15'
status: done
route: dispatch
story_id: E04-03-02
epic_num: 4
story_num: 302
story_key: 4-302-read-and-privately-preview-a-product-gallery
baseline_commit: 6ec6dc85adad4d3b551f293feca26733a020c7ed
review_loop_iteration: 1
acceptance:
  date: '2026-10-15'
  decision: accepted
  evidence:
    - _bmad-output/implementation-artifacts/verification-e04-03-02.md
    - _bmad-output/implementation-artifacts/walkthrough-e04-03-02.md
    - scripts/verify-gallery-schema.ts (exit code 0 against local PostgreSQL 18.6)
context:
  - AGENTS.md
  - _bmad-output/implementation-artifacts/epic-4-context.md
  - _bmad-output/planning-artifacts/stories/stories-e04-03-product-images/stories.md
  - _bmad-output/specs/spec-e04-03-product-images/SPEC.md
  - _bmad-output/specs/spec-e04-03-product-images/implementation-contract.md
  - _bmad-output/implementation-artifacts/verification-e04-03-01.md
  - _bmad-output/implementation-artifacts/verification-e04-03-02.md
  - _bmad-output/implementation-artifacts/walkthrough-e04-03-02.md
---

> [!NOTE]
> **Human Acceptance (2026-10-15):** Explicitly approved by user based on real PostgreSQL 18.6 verification (`scripts/verify-gallery-schema.ts`), verification report (`verification-e04-03-02.md`), and walkthrough report (`walkthrough-e04-03-02.md`). Story is marked `done`.

<frozen-after-approval reason="owner approval gates ready-for-dev and execution">

## Intent

**Problem:** Staff can manage Draft products and variants (E04-02) and secure media uploads exist as a private foundation (E04-03-01), but staff have no way to view an authenticated product image gallery, preview staged Draft images securely, or check publication-readiness issues (such as blank alt text) without exposing private draft media to public URLs.

**Approach:** Establish the product gallery persistence schema (`product_media` and `products.media_revision`) via additive migration `0015_product_gallery.sql`, provide an authenticated, strictly read-only GET gallery endpoint (`/api/v1/admin/catalog/products/{productId}/images`) and protected binary preview endpoint (`/api/v1/admin/catalog/products/{productId}/images/{imageId}/content`), implement private storage read adapter capabilities, and integrate a read-only gallery UI with accessible loading, empty, and thumbnail-retry states into the product manager.

## Boundaries & Constraints

**Always:**
- **Strict Read-Only Guarantee:** GET endpoints must never mutate records, increment `media_revision`, create media rows, or touch filesystem bytes.
- **Session & Permissions:** Require live catalog staff session (`requireCatalogStaffSession`) on every request (both metadata and binary preview); deny guest, customer, or invalid/revoked sessions before disclosing data or streaming bytes.
- **Privacy Headers:** All responses (gallery JSON and image binary stream) must send `Cache-Control: private, no-store`. Previews must also send `X-Content-Type-Options: nosniff` and exact `Content-Type` matching the stored media record.
- **Path Traversal & Storage Key Derivation:** Storage filenames are strictly resolved from verified database rows (`media.filename`), never from client input. Path traversal checks (`/^[a-z0-9_-]+\.(jpg|png|webp)$/i`) enforce valid keys. Internal filesystem paths, stack traces, and database connection strings are never leaked in responses or error payloads.
- **Primary Image Derivation:** Follows `implementation-contract.md` Rule 5: active positions are zero-based; the first active attachment (lowest `sort_order`, conventionally `0`) is primary. No independent `is_primary` column exists. When the gallery is empty, `primaryImageId` is strictly `null`.
- **Scope Alignment for DTO Fields:**
  - `variantImages`: Evaluated against active mappings. In this story (before E04-03-06 introduces `variant_media`), no variant mappings exist; the service returns an empty array `[]`.
  - `publicationIssues`: Actively computed read-only. For every active attachment where `btrim(alt_text) = ''`, produce `{ field: "images.<attachmentId>.altText", message: "Alt text is required before publication" }`. This is an informational readiness check; it does not block viewing drafts.
- **PostgreSQL Test Environment Gate:** Schema migration and constraint verification require an explicit, accessible PostgreSQL connection. The presence of a test plan or script is not proof of success. If the database engine is offline (e.g. `ECONNREFUSED`), verification cannot be claimed as passing.

**Never:**
- Never implement upload (POST), reorder/alt editing (PUT), or detach (DELETE) in this story (reserved for 03, 04, 05, 07).
- Never introduce the `variant_media` table in this story (reserved for E04-03-06).
- Never copy private files to `public/uploads` or call `storage.publish` for previews.
- Never trust `x-mock-user` or client-supplied actor/roles.
- Never modify existing product Draft persistence behavior or erase variant IDs.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Behavior | Error / Code |
|---|---|---|---|
| Read empty gallery | Authorized staff GET `/.../products/{id}/images`, product has 0 attachments | 200 `{ success: true, gallery: { productId, revision: "0", primaryImageId: null, images: [], variantImages: [], publicationIssues: [] } }` | 200 |
| Read populated gallery | Authorized staff GET `/.../products/{id}/images`, product has active attachments | 200 with sorted `images`, derived `primaryImageId` (first active item), active `publicationIssues` for blank alt | 200 |
| Unknown product | GET `/.../products/{unknownId}/images` | 404 NOT_FOUND (`Product not found`) | 404 |
| Unauthenticated read | Guest / revoked / customer session | 401 UNAUTHORIZED or 403 FORBIDDEN before querying DB | 401 / 403 |
| Preview active image | Authorized staff GET `/.../images/{imageId}/content`, file exists in private storage | 200 binary stream, `Content-Type: image/{png\|jpeg\|webp}`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store` | 200 |
| Preview foreign image | Image ID belongs to product B, requested under product A | 404 NOT_FOUND (safe isolation, no cross-product disclosure) | 404 |
| Preview removed image | Attachment has `removed_at IS NOT NULL` | 404 NOT_FOUND | 404 |
| Missing storage bytes | Attachment active in DB, but file missing on disk | 503 MEDIA_UNAVAILABLE with correlation ID; DB row remains untouched | 503 |
| Migration idempotency | Apply `0015_product_gallery.sql` -> revert `.down.sql` -> reapply in isolated schema | Pre-existing products, variants, and media survive intact; dropped `product_media` table data is wiped by design on rollback | Clean exit |

</frozen-after-approval>

## Constraints Compatibility Analysis (Future Stories 03–07)

1. **`UNIQUE(product_id, media_id)` vs Soft-Remove & Re-Add (Stories 03 & 07):**
   - The contract specifies `UNIQUE(product_id, media_id)` across the entire table.
   - *Impact:* If an image is soft-removed (`removed_at IS NOT NULL`) in Story 07, re-attaching the exact same `media_id` to the same product in Story 03 would hit this unique constraint.
   - *Compatibility design:* E04-03-03 always generates a fresh `media` record per upload (`id = createId()`). Re-uploading the same image creates a new distinct `media_id`, so no constraint violation occurs. If reactivation of historical media is ever desired in the future, the application can either un-remove the row or use a partial unique index `(product_id, media_id) WHERE removed_at IS NULL`. For Story 02, we adhere strictly to the approved contract definition: `UNIQUE(product_id, media_id)`.
2. **`UNIQUE(product_id, sort_order) WHERE removed_at IS NULL` vs Reordering (Story 05):**
   - *Impact:* Immediate unique index on `sort_order` prevents in-place swapping of positions within a single statement without transient collisions.
   - *Compatibility design:* As explicitly prescribed in `implementation-contract.md` line 98: reordering in Story 05 will use two-phase distinct temporary negative positions (e.g., `-1, -2`) or deferred-safe multi-row updates within a transaction before writing contiguous final non-negative positions. The partial unique constraint in Story 02 is 100% compatible with this design.

## Migration & Rollback Strategy

1. **Sequential Numbering:** Next unused migration index in `src/db/migrations` is verified as **`0015`** (`0015_product_gallery.sql` and `0015_product_gallery.down.sql`).
2. **Rollback Data Loss Distinction:**
   - **Pre-existing Data Preservation:** Applying and rolling back `0015` preserves existing `products`, `variants`, `categories`, and `media` tables and records intact.
   - **New Table Drop:** Executing `0015_product_gallery.down.sql` executes `DROP TABLE IF EXISTS "product_media";` and `ALTER TABLE "products" DROP COLUMN IF EXISTS "media_revision";`. This permanently wipes any data created in `product_media`. This distinction must be explicitly documented; rollback is non-destructive to historical data, but destructive to new gallery attachments.
3. **Isolated Test Execution:**
   - Verification tests for migrations must run inside a uniquely named temporary schema (e.g. `gallery_test_<random_hex>`).
   - The schema must be dropped in a `finally` block on both success and failure, leaving zero orphaned schemas.

## PostgreSQL Environment Readiness

- **Current Status:** Testing the local database connection (`DATABASE_URL` / `TEST_DATABASE_URL`) on `127.0.0.1:5432` currently returns **`ECONNREFUSED`** (PostgreSQL daemon is not running).
- **Evaluation:** As established in project rules, PGlite provides memory tests, but real PostgreSQL verification is mandatory for additive migrations and schema constraint enforcement.
- **Readiness Gate:** The local PostgreSQL service must be started before executing the verification script `scripts/verify-gallery-schema.ts`. Running the test plan is blocked on this environment dependency; existence of the script cannot be claimed as passing verification.

## UI & State Specifications

- **Loading State:** Skeletons for gallery thumbnails; buttons disabled; `aria-busy="true"`.
- **Empty State:** When `images.length === 0`, display neutral box: "لا توجد صور بعد." If product is unsaved (new create mode), display informational note: "احفظ المسودة أولاً لإضافة صور."
- **Populated State:** Grid of image cards showing:
  - Thumbnail loaded via `/api/v1/admin/catalog/products/{id}/images/{imageId}/content`.
  - "الصورة الرئيسية" badge on the item where `id === primaryImageId`.
  - Alt text indicator (badge if filled, warning badge if blank matching `publicationIssues`).
- **Thumbnail Failure & Retry:** If an individual image fails to load (e.g. 503 storage unavailable), replace broken image with a placeholder icon, an error message "تعذر تحميل المعاينة", and a "إعادة المحاولة" button that refreshes that specific image element without reloading the form.
- **Product Not Found:** 404 response displays an alert banner "المنتج غير موجود" with a link back to the products list.

## Code Map

- `src/db/schema.ts`:
  - Add `mediaRevision: bigint("media_revision", { mode: "bigint" }).notNull().default(sql`0`)` to `products`.
  - Export `productMedia` table: `id` (text PK), `productId` (text FK -> `products.id`), `mediaId` (text FK -> `media.id`, restrict), `altText` (text notNull default ""), `sortOrder` (integer notNull), `removedAt` (timestamp with tz, nullable), `createdAt`, `updatedAt`.
  - Indexes: unique `(productId, mediaId)`, partial unique `(productId, sortOrder)` where `removedAt IS NULL`, index `(productId, sortOrder)`.
- `src/db/migrations/0015_product_gallery.sql` and `0015_product_gallery.down.sql`:
  - Additive DDL with partial index on `(product_id, sort_order) WHERE removed_at IS NULL`.
- `src/lib/media/storage.ts`:
  - Add `readPrivate(filename: string): Promise<Buffer>` to `StorageAdapter` interface and `LocalFileSystemAdapter` with key validation and path traversal sanitization.
- `src/modules/catalog/products/contracts/gallery.ts` (new):
  - Gallery DTO Zod schema and TypeScript types: `GalleryImageDto`, `GalleryDto`, `GalleryResponse`.
- `src/modules/catalog/products/application/gallery-service.ts` (new):
  - `getGalleryByProductId(db: DbContext, productId: string): Promise<GalleryDto>`: single SQL query or transaction snapshot reading product revision and active attachments ordered by `sort_order`.
  - `getGalleryImageContent(db: DbContext, productId: string, productMediaId: string): Promise<{ buffer: Buffer; mimeType: string }>`: verifies active ownership and reads private bytes.
- `src/app/api/v1/admin/catalog/products/[id]/images/route.ts` (new):
  - Strictly read-only GET handler requiring `requireCatalogStaffSession`, returning gallery DTO with private headers.
- `src/app/api/v1/admin/catalog/products/[id]/images/[imageId]/content/route.ts` (new):
  - Strictly read-only GET handler returning validated binary bytes with nosniff and private cache headers.
- `src/app/admin/(workspace)/catalog/products/product-gallery.tsx` (new):
  - Accessible component rendering thumbnail grid, loading skeleton, empty state, primary badge on first image, alt text indicator/warning, and thumbnail retry.
- `src/app/admin/(workspace)/catalog/products/product-manager.tsx`:
  - Embed `ProductGallery` inside the draft edit form (disabled when creating a new unsaved product).

## Open Questions

None. All seven architectural and security areas have been resolved against the approved specifications.

## Tasks & Acceptance Criteria

**Tasks:**
- [ ] `src/db/schema.ts`, `src/db/migrations/0015_product_gallery.sql`, `.down.sql`: Add `media_revision` column and `product_media` table with partial unique index.
- [ ] `src/lib/media/storage.ts`: Implement `readPrivate(filename: string)` with path traversal sanitization and file existence checks.
- [ ] `src/modules/catalog/products/contracts/gallery.ts`: Define `GalleryDto`, `GalleryImageDto`, and schema validation.
- [ ] `src/modules/catalog/products/application/gallery-service.ts`: Implement read-only `getGalleryByProductId` and `getGalleryImageContent`.
- [ ] `src/app/api/v1/admin/catalog/products/[id]/images/route.ts`: Implement authenticated GET gallery endpoint.
- [ ] `src/app/api/v1/admin/catalog/products/[id]/images/[imageId]/content/route.ts`: Implement authenticated GET preview endpoint.
- [ ] `src/app/admin/(workspace)/catalog/products/product-gallery.tsx`: Build accessible gallery preview UI with thumbnail retry.
- [ ] `src/app/admin/(workspace)/catalog/products/product-manager.tsx`: Integrate gallery section for saved drafts.
- [ ] `scripts/verify-gallery-schema.ts`: Automated PostgreSQL verification script checking migration up/down/re-up, partial index constraints, and RESTRICT FK on media.

**Acceptance Criteria (Given / When / Then):**
1. **Given** an existing product Draft, **When** authorized staff requests its gallery via GET `/api/v1/admin/catalog/products/{id}/images`, **Then** a 200 response returns an ordered gallery DTO with current revision string, primary image derived, and no removed items, without modifying any database records.
2. **Given** an unsaved product or a product without attachments, **When** the gallery UI renders, **Then** an accessible empty state is displayed, primaryImageId is null, and upload remains unavailable until the product is saved.
3. **Given** a seeded active attachment, **When** staff requests its preview content via GET `.../images/{imageId}/content`, **Then** raw bytes stream with matching `Content-Type`, `X-Content-Type-Options: nosniff`, and `Cache-Control: private, no-store`, without creating any public file in `/uploads`.
4. **Given** a guest, customer, cross-product image request, or deleted attachment, **When** preview is requested, **Then** access is denied (401/403/404) without leaking bytes or filesystem paths.
5. **Given** an isolated PostgreSQL database, **When** migration `0015_product_gallery.sql` is applied, reverted, and reapplied, **Then** pre-existing data survives, new constraints reject duplicate active positions and media deletion, and the temporary test schema is cleaned up.

## Implementation Notes

- E04-03-01 is explicitly approved and in status `done`.
- Testing must include both PGlite unit/integration tests and real PostgreSQL isolation via `scripts/verify-gallery-schema.ts`.
- Local PostgreSQL service must be running for live verification; failure to connect (`ECONNREFUSED`) blocks verification completion.
- No UI mutations or edit actions are implemented in this story.

## A4 completion evidence reconciliation — 2026-10-22

The existing acceptance frontmatter and Human Acceptance note record explicit user approval on 2026-10-15, supported by the linked verification/walkthrough and local PostgreSQL schema verification. The nine unchecked implementation boxes above are historical checklist entries that were not reconciled when lifecycle completion was recorded; they are retained rather than checked retrospectively without task-specific records. Their presence does not reopen the accepted story. The walkthrough's review recommendation is an earlier stage, superseded by the acceptance already recorded here. See the [A4 evidence index](e04-contract-reconciliation-2026-10-22.md). No new test run or human acceptance is claimed.

The earlier "PostgreSQL Environment Readiness" section's `ECONNREFUSED`/blocked wording is a historical pre-verification snapshot. It is superseded for recorded story completion by the subsequent successful PostgreSQL verification and explicit acceptance already cited above; it does not describe the current database service state. No database connection was attempted for A4.
