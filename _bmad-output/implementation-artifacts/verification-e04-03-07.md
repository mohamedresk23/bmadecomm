# E04-03-07 verification

Date: 2026-10-19. Local development only; no production migration or deployment.

Implemented revision-guarded soft removal of draft product gallery images via `DELETE /api/v1/admin/catalog/products/[id]/images/[imageId]`.
Preserves media rows and private physical storage bytes on disk for historical reference (e.g., past orders), sets `removed_at = clock_timestamp()` on `product_media`, atomically clears associated variant image assignments (`variant_media`), compacts remaining active sort orders into contiguous zero-based indices `0, 1, 2...` without unique constraint violations, advances `products.mediaRevision` by 1, and records transactional audit log `catalog.product.image.detach`.

The admin UI in `ProductGallery` renders a dedicated remove button per image card, accessible confirmation dialog, dirty edit warning when local unsaved edits exist, busy state coordination (`aria-busy`), live announcements (`aria-live`), cancellation preservation of focus, empty state transition ("لا توجد صور بعد") with automatic focus to the file upload input, and error handling for 409 `STALE_GALLERY` conflicts.

## Executed checks

- `npm.cmd test -- src/modules/catalog/products/contracts/gallery.test.ts src/modules/catalog/products/application/variant-images.test.ts "src/app/admin/(workspace)/catalog/products/product-gallery.test.tsx" "src/app/api/v1/admin/catalog/products/[id]/images/route.test.ts"`: **144 passed across four test suites**.
- Real PostgreSQL: `vitest run --config vitest.postgres.config.ts src/modules/catalog/products/application/gallery-remove.postgres.test.ts src/modules/catalog/products/application/gallery-reorder.postgres.test.ts src/modules/catalog/products/application/variant-images.postgres.test.ts`: **24 passed across three suites**. Tests executed against dedicated database `bmadecomm_gallery_reorder_test` in disposable schemas.
- `npm.cmd run typecheck`: **passed** with 0 errors.
- `npm.cmd run lint`: **passed** with 0 errors (1 existing warning in `src/components/Upload.tsx`).
- `npm.cmd run build -- --webpack`: **passed**; Next.js 16.3.8 Webpack production build compiled successfully in under 6 seconds, dynamic route `DELETE /api/v1/admin/catalog/products/[id]/images/[imageId]` properly recognized.
- Authenticated Edge browser: `tsx scripts/verify-variant-images-browser.ts` passed all cumulative 7-slice journeys at **320, 768, 1024, 1440px RTL**. Evidence saved to `.local/variant-images-browser-verification.json`.

## Matrix evidence

| Requirement | Executed evidence |
|---|---|
| Soft removal (`removedAt`) | `gallery-remove.postgres.test.ts` and `route.test.ts` verify `removed_at` is set on `product_media`, excluding the row from future active gallery reads. |
| Media row & physical file retention | `gallery-remove.postgres.test.ts` and browser verification verify the `media` row is untouched in PostgreSQL and physical bytes remain on disk in `storage/private`. |
| Immediate preview 404 | `gallery-remove.postgres.test.ts`, `route.test.ts`, and browser script prove that authenticated staff requests to `GET /{imageId}/content` immediately return HTTP 404 after detachment. |
| Guest privacy | Browser verification verifies unauthenticated guest requests to preview endpoints return HTTP 401/403 (no Draft bytes exposed). |
| Variant mapping cleanup & primary fallback | PostgreSQL, service, and browser tests prove variant mappings pointing to the detached image are deleted from `variant_media`, and unassigned variants fall back to the new primary image (or null if empty). |
| Compaction & unique constraints | `gallery-remove.postgres.test.ts` verifies ascending compaction of remaining active images into contiguous slots `0, 1, 2...` without triggering `product_media_active_sort_order_uq` violations. |
| Bounded 64-bit revision guard | Contract and API tests reject invalid/unbounded `expectedRevision` formats; PostgreSQL tests prove competing operations on the same revision yield 1 winner and 1 HTTP 409 `STALE_GALLERY` rejection. |
| Canonical lock order & concurrency | Product row locked `FOR UPDATE`, then active attachments in `id ASC` order. Competing delete vs delete and delete vs reorder serialize cleanly. |
| Transactional rollback | PostgreSQL and service tests prove injected failures during audit write roll back detachment, compaction, mapping cleanup, and revision increment completely. |
| Accessible UI confirmation & focus | `product-gallery.test.tsx` and Playwright browser tests verify remove button, modal confirmation dialog, cancellation focus restoration, dirty edit warning, empty state transition, and file input focus. |

