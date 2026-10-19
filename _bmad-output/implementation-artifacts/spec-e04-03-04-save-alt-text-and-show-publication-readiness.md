---
title: 'E04-03-04: Save alt text and show publication readiness'
type: feature
created: '2026-10-18'
status: done
baseline_commit: 5896558439f00ff4599c57f60e4625dac26132a4
route: dispatch
review_loop_iteration: 0
context:
  - AGENTS.md
  - _bmad-output/implementation-artifacts/epic-4-context.md
  - _bmad-output/planning-artifacts/stories/stories-e04-03-product-images/stories.md
  - _bmad-output/specs/spec-e04-03-product-images/SPEC.md
  - _bmad-output/specs/spec-e04-03-product-images/implementation-contract.md
  - _bmad-output/implementation-artifacts/walkthrough-e04-03-03.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Catalog staff can view and upload draft product images (E04-03-02, E04-03-03), but cannot save accessible image descriptions (alt text) or see publication blockers. Without safe, revision-guarded gallery editing, concurrent updates risk silent overwrites or inconsistent audit history.

**Approach:** Implement `PUT /api/v1/admin/catalog/products/[id]/images` with strict full membership validation, `expectedRevision` optimistic concurrency control, plain text alt text editing (trimmed, max 500 chars), blank-alt publication readiness reporting, no-op detection for unchanged submissions, transactional audit logging, and frontend dirty-state protection against accidental data loss.

## Boundaries & Constraints

**Always:**
- Enforce live catalog staff authentication and CSRF validation on all mutation requests.
- Restrict gallery edits to draft products only; reject published or archived products with 409 Conflict.
- Require `expectedRevision` matching current `products.media_revision` under product row lock (`FOR UPDATE`); reject mismatches with 409 `STALE_GALLERY`.
- Require strict full membership: `images` array must contain every currently active attachment exactly once with no extra, missing, or duplicate IDs.
- Validate alt text: plain Unicode text, trimmed, maximum 500 characters, no NUL or control characters.
- Detect no-op updates: if alt text and order are identical to persisted active attachments, return 200 without incrementing `media_revision` or emitting an audit event.
- If changes occur, increment `products.media_revision` by 1 and write a `catalog.product.gallery.update` audit entry within the same database transaction.
- Update `publicationIssues` dynamically: flag each active image whose trimmed alt text is empty with field `images.<id>.altText` and message "Alt text is required before publication".
- Preserve entered user inputs and dirty state in the UI upon submission failures (409, 422, 500, network error, or session expiry).
- Guard dirty gallery state on navigation, tab close, product switching, and new image upload with explicit confirmation.

**Never:**
- Never promote or publish draft media or products as part of alt text editing.
- Never delete physical media files or remove attachments during a PUT gallery call.
- Never invent an invariant requiring at least one image before a draft can be saved.
- Never accept non-empty `variantImages` in this story (variant image mapping is reserved for E04-03-06).
- Never mutate unrelated product fields (name, description, variants) when saving gallery alt text.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| **Valid Alt Text Update** | Valid draft, matching `expectedRevision`, updated alt text on active images | 200 OK with updated `GalleryDto`, revision incremented by 1, audit logged, updated `publicationIssues` | N/A |
| **No-Op Submission** | Valid draft, matching `expectedRevision`, identical alt text and order | 200 OK with unchanged `GalleryDto`, revision unchanged, 0 audit rows emitted | N/A |
| **Stale Revision Conflict** | `expectedRevision` !== current `media_revision` (concurrent save) | 409 Conflict (`STALE_GALLERY`) | UI retains entered alt text, shows localized reload/review prompt |
| **Non-Draft Product** | Product status is 'published' or 'archived' | 409 Conflict | UI displays "Only drafts can be edited" |
| **Missing/Extra Image ID** | `images` array missing an active attachment or containing unknown ID | 422 Unprocessable Entity | Atomically rejected; no DB mutation |
| **Duplicate Image ID** | `images` contains duplicate attachment IDs | 422 Unprocessable Entity | Atomically rejected; no DB mutation |
| **Oversized Alt Text** | Alt text > 500 characters or contains control characters | 422 Unprocessable Entity with field error on `images.<id>.altText` | UI shows inline validation message |
| **Non-Empty Variant Mappings** | `variantImages` contains entries | 422 Unprocessable Entity | Rejected; mapping deferred to E04-03-06 |
| **Dirty Navigation / Upload** | Alt text modified locally, user triggers upload or product switch | Confirmation prompt displayed before proceeding | Cancel retains local edits; confirm proceeds |

</frozen-after-approval>

## Code Map

- `src/modules/catalog/products/contracts/gallery.ts` -- define `updateGallerySchema`, `updateGalleryImageItemSchema`, and `UpdateGalleryDto`
- `src/modules/catalog/products/application/gallery-service.ts` -- implement `updateGallery` with row locking, revision check, strict membership validation, no-op detection, transaction audit, and publication issues calculation
- `src/app/api/v1/admin/catalog/products/[id]/images/route.ts` -- add `export const PUT` handler wrapped with `privateHandler`, session authorization, CSRF validation, and body bounds
- `src/app/admin/(workspace)/catalog/products/product-gallery.tsx` -- add alt text input fields, Save Gallery button, dirty tracking, dirty-upload confirmation, and localized error banner
- `src/app/admin/(workspace)/catalog/products/product-manager.tsx` -- integrate dirty gallery state into `canReplace()` to prevent silent loss on product switching
- `src/app/api/v1/admin/catalog/products/[id]/images/route.test.ts` -- add integration tests for PUT gallery endpoint
- `src/app/admin/(workspace)/catalog/products/product-gallery.test.tsx` -- add unit tests for alt text editing, saving, readiness badges, and dirty guards

## Tasks & Acceptance

**Execution:**
- [x] `src/modules/catalog/products/contracts/gallery.ts` -- export `updateGallerySchema` and `UpdateGalleryDto` validating `expectedRevision`, `images`, and empty `variantImages`
- [x] `src/modules/catalog/products/application/gallery-service.ts` -- implement `updateGallery(db, params)` within `withTransaction` using product row lock, revision check, membership validation, no-op detection, and audit write
- [x] `src/app/api/v1/admin/catalog/products/[id]/images/route.ts` -- implement `PUT` route handler parsing JSON body within 64 KiB bound and delegating to `updateGallery`
- [x] `src/app/admin/(workspace)/catalog/products/product-gallery.tsx` -- wire editable alt text inputs, dirty tracking, "حفظ المعرض" button, readiness warnings, and dirty upload confirmation
- [x] `src/app/admin/(workspace)/catalog/products/product-manager.tsx` -- connect `isGalleryDirty` to product switching and reset confirmation
- [x] `src/app/api/v1/admin/catalog/products/[id]/images/route.test.ts` -- test PUT happy path, no-op audit suppression, 409 stale revision, 422 membership/alt text errors, non-draft 409, and competing transaction races
- [x] `src/app/admin/(workspace)/catalog/products/product-gallery.test.tsx` -- test alt text input rendering, dirty badge/save button states, save submission, readiness warning toggle, and error retention

**Acceptance Criteria:**
- Given current gallery revision, when trimmed valid alt text is saved, then it persists after reload with one revision and audit change; an unchanged PUT creates neither.
- Given blank alt in a Draft product, when saved, then save succeeds and readiness helper returns one issue per affected active image (`images.<id>.altText`).
- Given duplicate, missing, foreign attachment, unknown fields, invalid text (>500 chars/controls), or stale revision, when PUT executes, then it fails atomically with field/409 feedback and retains entered values in the UI.
- Given dirty gallery edits and navigation, upload, or product replacement, when the action is requested, then explicit save/discard handling prevents silent loss and cancellation keeps gallery and unrelated product fields.

## Implementation Notes

## Spec Change Log

## Review Triage Log

- [x] [Review][Patch] Lock active `product_media` rows in deterministic `id ASC` order with `.for("update")` under the product transaction lock [`src/modules/catalog/products/application/gallery-service.ts:479-485`]
- [x] [Review][Patch] Record `previousRevision`, `nextRevision`, `before`, and `after` in audit event diff [`src/modules/catalog/products/application/gallery-service.ts:580-598`]
- [x] [Review][Patch] Bound `expectedRevision` string to signed 64-bit integer ceiling (`<= 9223372036854775807n`) in `updateGallerySchema` [`src/modules/catalog/products/contracts/gallery.ts:28-36`]
- [x] [Review][Patch] Guard upload execution and disable controls while gallery save is in progress (`uploading || saving`) [`src/app/admin/(workspace)/catalog/products/product-gallery.tsx:173,197,352`]
- [x] [Review][Patch] Clear `saveError` and reset `isStale` on reload click and when a new gallery revision prop arrives [`src/app/admin/(workspace)/catalog/products/product-gallery.tsx:55-64,286-291`]
- [x] [Review][Patch] Add unmount cleanup to `onDirtyChange` effect calling `onDirtyChange?.(false)` [`src/app/admin/(workspace)/catalog/products/product-gallery.tsx:66-70`]
- [x] [Review][Patch] Align `isDirty` calculation with server-side trimming semantics [`src/app/admin/(workspace)/catalog/products/product-gallery.tsx:51-54`]
- [x] [Review][Patch] Fall back to default preview alt when alt text contains whitespace only [`src/app/admin/(workspace)/catalog/products/product-gallery.tsx:490`]
- [x] [Review][Patch] Announce save success to screen-readers via accessible live region (`role="status" aria-live="polite"`) [`src/app/admin/(workspace)/catalog/products/product-gallery.tsx:252-257,320`]
- [x] [Review][Patch] Add regression test verifying `ProductManager.canReplace()` triggers `window.confirm` when only gallery edits are dirty [`src/app/admin/(workspace)/catalog/products/product-manager.test.tsx:210-235`]
- [x] [Review][Reject] Disproved claim that product selection changes without unmounting gallery state; `ProductGallery` is keyed by `productId` forcing a complete remount on change [`src/app/admin/(workspace)/catalog/products/product-gallery.tsx:17`]

## Design Notes

### Optimistic Concurrency & No-Op Detection
1. **Locking & Revision:**
   - Execute `SELECT id, status, media_revision FROM products WHERE id = productId FOR UPDATE`.
   - If `product.mediaRevision.toString() !== payload.expectedRevision`, abort with 409 `STALE_GALLERY`.
2. **Membership Check:**
   - Query active rows: `SELECT id, sort_order, alt_text FROM product_media WHERE product_id = productId AND removed_at IS NULL ORDER BY sort_order ASC`.
   - Ensure payload has identical size and exact same IDs as active rows.
3. **No-Op Suppression:**
   - Compare each item: `trimmedAlt === currentRow.altText` and `item.id === currentRow.id`.
   - If all match, return current `GalleryDto` without modifying DB, incrementing revision, or writing audit.

## Verification

**Commands:**
- `npx.cmd vitest run "src/app/api/v1/admin/catalog/products/[id]/images/route.test.ts"` -- expected: all PUT route tests pass (100%)
- `npx.cmd vitest run "src/app/admin/(workspace)/catalog/products/product-gallery.test.tsx"` -- expected: all gallery UI tests pass (100%)
- `npm.cmd run typecheck` -- expected: 0 TypeScript errors
- `npm.cmd run lint` -- expected: 0 ESLint errors

**Manual checks (if no CLI):**
- Verify editing alt text on a product in admin UI updates the input, displays dirty status, saves on button click, clears dirty status, and updates publication readiness badges.

