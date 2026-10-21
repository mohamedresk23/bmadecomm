---
title: 'E04-03-07: Remove gallery images while retaining history'
type: feature
created: '2026-10-19'
status: done
baseline_commit: 850e797c5fe6aabc63b32437f79bb836c1f38f85
route: dispatch
review_loop_iteration: 0
story_key: 4-307-remove-gallery-images-while-retaining-history
context:
  - AGENTS.md
  - _bmad-output/implementation-artifacts/epic-4-context.md
  - _bmad-output/specs/spec-e04-03-product-images/implementation-contract.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Catalog staff cannot detach obsolete or mistaken images from a draft product's gallery. Without a safe, revision-guarded soft removal, staff cannot clean up galleries or might inadvertently destroy historical media rows referenced by orders.

**Approach:** Deliver revision-guarded `DELETE /api/v1/admin/catalog/products/[id]/images/[imageId]` performing soft removal (`removedAt`), clearing mapped variants, compacting remaining positions, updating primary image fallback, and recording audit atomically, with an accessible confirmation dialog and empty/focus handling.

## Boundaries & Constraints

**Always:**
- Require live catalog staff session and Origin/CSRF token validation (`requireCatalogStaffSession(req, true)`).
- Target persisted Draft products only; return 404 for unknown/cross-product product or image, 409 for non-draft lifecycle state.
- Require `expectedRevision` matching current `mediaRevision`; return 409 `STALE_GALLERY` on mismatch.
- Lock product first (`products FOR UPDATE`), then active attachments in canonical `id ASC` order.
- Set `removedAt = clock_timestamp()` on `product_media` (soft delete); never delete the row in `media` or delete physical private files on disk.
- Clear `variant_media` rows pointing to the removed attachment atomically; unmapped variants fall back to the new primary image or null if empty.
- Compact `sortOrder` of remaining active images to contiguous zero-based indices `0, 1, 2...` without violating unique constraints.
- Increment `mediaRevision` by 1 and write transactional audit log `catalog.product.image.detach`.
- Removed image preview (`/{imageId}/content`) must immediately return 404.
- In UI, prompt for confirmation explaining detachment and variant fallback without suggesting media file deletion; lock product and gallery operations while removing; update focus and announce detachment via `aria-live`.
- If dirty local edits exist when user clicks remove, warn that unsaved order/alt edits will be discarded upon removal or require saving first.

**Never:**
- Never physically delete media rows or storage files.
- Never alter historical snapshots or public URLs.
- Never commit partial state (e.g. detachment without compaction or audit).
- Never allow cross-product image removal.
- Never expose private preview URLs in public product DTOs.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Happy path removal | Valid active image, matching `expectedRevision` | 200 with updated gallery DTO; attachment soft-removed, positions compacted, variant mappings cleared, revision incremented, audit logged | Safe 4xx/5xx |
| Remove primary image | Image at position 0 removed, other images remain | Next image (now position 0) becomes new primary; unassigned variants fall back to it | Safe 4xx |
| Remove last image | Only 1 image active in gallery | 200 with `images: []`, `primaryImageId: null`, `variantImages: []`, UI displays "لا توجد صور بعد" and moves focus to upload input | N/A |
| Mapped variant image | Removed image was mapped to 1 or more variants | Mappings cleared from `variant_media`, unmapped variants fall back to primary image | Announced in UI |
| Stale revision | `expectedRevision` does not match DB `mediaRevision` | 409 `STALE_GALLERY`; no mutation, local dirty edits preserved in UI with reload offer | Conflict alert |
| Inactive / foreign image | `imageId` belongs to another product, or already removed | 404 NOT_FOUND without disclosing foreign presence; no mutation | Safe 404 |
| Non-draft product | Product status is not "draft" | 409 CONFLICT; no mutation | Error alert |
| CSRF / Auth failure | Missing/expired staff cookie or invalid CSRF token | 401 UNAUTHORIZED or 403 FORBIDDEN; no mutation | Login / forbidden |
| Audit failure | Database audit trigger or insert fails | Transaction rollback; attachment remains active, revision unchanged | Safe 500 |
| Cancel confirmation | User clicks "إلغاء" in confirmation dialog | Operation cancelled, no request sent, all state and focus preserved | N/A |

</frozen-after-approval>

## Code Map

- `src/modules/catalog/products/contracts/gallery.ts` -- Define `deleteGalleryImageSchema` and `DeleteGalleryImageDto`.
- `src/modules/catalog/products/application/gallery-service.ts` -- Implement `deleteGalleryImage` with canonical lock order, soft removal, mapping cleanup, position compaction, revision increment, and audit.
- `src/app/api/v1/admin/catalog/products/[id]/images/[imageId]/route.ts` -- Export `DELETE` handler with CSRF/auth, bounded JSON parsing, and standard error envelopes.
- `src/app/admin/(workspace)/catalog/products/product-gallery.tsx` -- Add remove button per image card, accessible confirmation prompt, busy state coordination, live announcement, and focus restoration.
- `src/modules/catalog/products/contracts/gallery.test.ts` -- Contract validation tests for `deleteGalleryImageSchema`.
- `src/modules/catalog/products/application/gallery-service.test.ts` / `variant-images.test.ts` -- Service tests for removal, primary fallback, last image, and mapping cleanup.
- `src/modules/catalog/products/application/gallery-remove.postgres.test.ts` -- Real PostgreSQL concurrency, rollback, isolation, and retained-reference tests.
- `src/app/api/v1/admin/catalog/products/[id]/images/route.test.ts` -- API route tests for `DELETE` method.
- `src/app/admin/(workspace)/catalog/products/product-gallery.test.tsx` -- UI tests for removal interaction, confirmation, cancel, focus, and error states.
- `scripts/verify-variant-images-browser.ts` / cumulative browser script -- Authenticated cumulative 7-story browser verification across viewports in RTL.

## Tasks & Acceptance

**Execution:**
- [x] `src/modules/catalog/products/contracts/gallery.ts` -- Add `deleteGalleryImageSchema` -- Enforce 64-bit bounded `expectedRevision`.
- [x] `src/modules/catalog/products/application/gallery-service.ts` -- Implement `deleteGalleryImage` -- Provide atomic soft removal, mapping cleanup, compaction, and audit under product lock.
- [x] `src/app/api/v1/admin/catalog/products/[id]/images/[imageId]/route.ts` -- Implement `DELETE` endpoint -- Authenticate, validate CSRF, and handle deletion requests.
- [x] `src/app/admin/(workspace)/catalog/products/product-gallery.tsx` -- Add remove button, confirmation, and focus/announcements -- Enable staff to remove images safely with accessible feedback.
- [x] Corresponding service, API route, and component test files -- Add unit and integration tests covering the I/O matrix -- Prevent regressions and verify edge cases.
- [x] Real PostgreSQL and browser verification suites -- Add integration and browser tests -- Verify physical media retention, preview 404, concurrency, and cumulative 7-slice workflow.

### Review Findings

- [x] [Review][Patch] Modal keyboard escape listener, focus restoration on error, and defensive imageId check [`src/app/admin/(workspace)/catalog/products/product-gallery.tsx`]
- [x] [Review][Patch] Sequential removal announcement prefix to ensure aria-live re-triggers on consecutive removals [`src/app/admin/(workspace)/catalog/products/product-gallery.tsx`]
- [x] [Review][Patch] Deterministic tie-breaker in remainingRows sort order compaction [`src/modules/catalog/products/application/gallery-service.ts`]
- [x] [Review][Patch] Remove dead fallback code in boundedJson call [`src/app/api/v1/admin/catalog/products/[id]/images/[imageId]/route.ts`]
- [x] [Review][Patch] Assert adjacent button focus on non-terminal removal [`src/app/admin/(workspace)/catalog/products/product-gallery.test.tsx`]
- [x] [Review][Patch] Add route test coverage for MAX_DELETE_BODY (413) and malformed JSON [`src/app/api/v1/admin/catalog/products/[id]/images/route.test.ts`]
- [x] [Review][Patch] Add postgres integration tests for non-draft product and already soft-deleted image [`src/modules/catalog/products/application/gallery-remove.postgres.test.ts`]
- [x] [Review][Defer] Canonical lock order in updateProduct [`src/modules/catalog/products/application/product-service.ts:104`] — deferred: pre-existing from E04-03-06, updateProduct should lock product row FOR UPDATE before activeAttachments.

#### Rejected Findings
- [Rejected] ECH-1 (Max signed 64-bit boundary increment): low, 9 quintillion edits boundary, PostgreSQL native overflow protection.
- [Rejected] ECH-2 (Target image check before stale revision check): false, foreign/missing image must return 404 without disclosing foreign revision.
- [Rejected] BH-7 (AbortSignal propagation on DELETE): low, sub-10ms atomic transaction, cancellation unneeded.

**Acceptance Criteria:**
- Given a primary or mapped active attachment, when staff confirms removal using current revision, then it is soft-removed, relevant assignments clear, remaining positions compact and primary fallback changes in one audited transaction.
- Given the last image or a cancelled confirmation, when removal finishes or is cancelled, then the empty/null state is correct or all previous state remains intact, with sensible focus and feedback.
- Given retained media/historical references, when removing the attachment, then media row/bytes survive, no physical-delete operation runs and removed current-preview access returns 404.
- Given stale revision, simultaneous map/reorder or injected cleanup/audit failure, when removal executes, then stale work fails or a single valid outcome commits; no partial detach/order/mapping state persists.
- Given the seven completed slices, when staff uploads two images, edits alt, reorders, maps, reloads, edits a retained variant and removes the mapped image, then all persistence, privacy, fallback and audit outcomes meet the spec; guest requests expose no Draft bytes.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Design Notes

- Attachment soft deletion updates `removed_at = clock_timestamp()` and excludes the row from active index `product_media_active_sort_order_uq`.
- Compacting sort orders in ascending order into vacated lower slots avoids unique constraint conflicts on active positions.
- Variant mappings to the detached image are deleted from `variant_media`, allowing unmapped variants to automatically fall back to the newly calculated primary image (or null if the gallery becomes empty).
- Media records and private storage files are intentionally retained to protect historical references (e.g. past orders).

## Verification

**Commands:**
- `npm.cmd test -- src/modules/catalog/products/contracts/gallery.test.ts src/modules/catalog/products/application/variant-images.test.ts "src/app/admin/(workspace)/catalog/products/product-gallery.test.tsx" "src/app/api/v1/admin/catalog/products/[id]/images/route.test.ts"` -- expected: All unit/UI/API tests pass.
- `vitest run --config vitest.postgres.config.ts src/modules/catalog/products/application/gallery-remove.postgres.test.ts` -- expected: Real PostgreSQL concurrency, rollback, and constraint tests pass.
- `npm.cmd run typecheck` -- expected: 0 TypeScript errors.
- `npm.cmd run lint` -- expected: 0 lint errors.
- `npm.cmd run build -- --webpack` -- expected: Production Webpack build succeeds.
- `tsx scripts/verify-variant-images-browser.ts` -- expected: Full cumulative browser workflow passes across 320/768/1024/1440px RTL.

