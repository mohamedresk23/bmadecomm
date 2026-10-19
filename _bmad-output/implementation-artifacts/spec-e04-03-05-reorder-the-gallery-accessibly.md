---
title: 'E04-03-05: Reorder the gallery accessibly'
type: feature
created: '2026-10-19'
status: done
baseline_commit: 6a3db268e92563028d11191e926b7e553e34e6f2
route: dispatch
review_loop_iteration: 0
story_key: 4-305-reorder-the-gallery-accessibly
context:
  - AGENTS.md
  - _bmad-output/implementation-artifacts/epic-4-context.md
  - _bmad-output/specs/spec-e04-03-product-images/implementation-contract.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Staff can edit image descriptions but cannot choose gallery order in the editor. The first image determines the primary product image.

**Approach:** Add accessible local Move earlier/later controls, then persist order and descriptions together through the existing revision-guarded Save gallery contract. Harden ordering and prove atomicity on PostgreSQL.

## Boundaries & Constraints

**Always:**
- Preserve live staff authorization, CSRF, Draft-only writes, strict full membership, bounded DTOs, private previews and private/no-store responses.
- Keep logical array order independent of RTL direction. Show local position and primary immediately; persist only through Save gallery.
- Keep descriptions and field errors attached to stable image IDs. Include order in dirty detection and existing navigation/upload guards.
- Keep operations available by keyboard and touch, with visible focus and polite announcements of new position and primary changes. Preserve focus on the moved image, including boundaries.
- Block conflicting edits during save/upload/loading. Failed saves retain local order and alt values; stale results require explicit review/reload without automatically retrying obsolete payloads.
- Update positions, descriptions, revision and exactly one audit atomically. Readers see a coherent committed revision/order. Unchanged submissions create no revision or audit.

**Never:** Add drag dependency, variant mapping, removal, publishing, new tables, dependencies or production deployment.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Move | At least two images | Adjacent swap; first becomes primary; descriptions follow IDs | Announce position and primary |
| Boundary | Empty, singleton, first/last | Invalid move unavailable; no dirty change | Focus remains usable |
| Save | Local permutation and alt edits | Exact contiguous order survives reload; one revision/audit | Existing validation feedback |
| Undo | Moves restore saved order and descriptions unchanged | Clean state; save unavailable | No request |
| Stale or failed write | Competing revision, network/session/server failure | Preserve reviewable order/descriptions | Explicit recovery; no overwrite |
| Mid-write failure | Failure during temporary/final positions or audit | Original order/alt/revision/audit retained | Transaction rolls back |
| Concurrent read | Writer pauses during reorder | Complete old or new aggregate, never temporary/mixed state | Preserve not-found behavior |

</frozen-after-approval>

## Code Map

- `src/app/admin/(workspace)/catalog/products/product-gallery.tsx`: keyed product state, ID-keyed alt edits, dirty callbacks, unload/upload guards and PUT payload. Currently renders and submits persisted order. Reuse existing save/error handling.
- `src/modules/catalog/products/application/gallery-service.ts`: `updateGallery` already locks product then attachments, validates membership and performs two-phase reorder with fixed `10000+i` positions; select guaranteed free bounded positions instead. `getGalleryByProductId` currently reads revision and images in separate statements; ensure one coherent snapshot.
- `src/app/api/v1/admin/catalog/products/[id]/images/route.ts`: existing authorized GET/PUT adapters; retain DTO and security contract.
- `src/db/migrations/0015_product_gallery.sql`: immediate partial unique active position index and nonnegative integer constraint; retain schema.
- `src/app/admin/(workspace)/catalog/products/product-manager.tsx`: existing gallery dirty integration; preserve unrelated form state.
- `src/test-utils/db.ts`, `vitest.postgres.config.ts`, `scripts/verify-gallery-schema.ts`: reuse isolated database conventions. `playwright-core` and installed Edge support browser verification.

## Tasks & Acceptance

**Execution:**
- [x] `src/app/admin/(workspace)/catalog/products/product-gallery.tsx` — implement local ordering, dirty detection, ordered payload/rendering, position/primary feedback, accessible controls and focus, safe success/reload reconciliation.
- [x] `src/modules/catalog/products/application/gallery-service.ts` — harden temporary position selection against occupied positions/overflow, and make gallery reads coherent without changing response contracts.
- [x] `src/app/admin/(workspace)/catalog/products/product-gallery.test.tsx` — test permutations/boundaries, undo, alt retention, focus/announcements, busy state, failed saves and confirmed recovery.
- [x] `src/app/api/v1/admin/catalog/products/[id]/images/route.test.ts` — test reorder persistence, primary, no-op and strict invalid membership through existing HTTP adapter.
- [x] `src/modules/catalog/products/application/gallery-reorder.postgres.test.ts` — add independent-connection PostgreSQL swaps, competing writes, temporary/final/audit failure rollback and reader snapshot tests using isolated fixtures.
- [x] `scripts/verify-gallery-reorder-browser.ts` — verify actual authenticated reorder/save/reload with keyboard at 320px and desktop RTL, touch controls and reflow; reuse server-side session fixtures.
- [x] `_bmad-output/implementation-artifacts/verification-e04-03-05.md` — record checks, evidence and actual limitations; update sprint tracking at workflow transitions.

**Acceptance Criteria:**
- Given multiple active images, when reordered and saved, then reload returns contiguous logical order with the first image primary in RTL.
- Given keyboard or touch use, when moving images, then every operation is reachable with visible focus and announced results without dragging.
- Given stale or mid-transaction failure, when saving, then no partial mutation commits and local order/alt remain reviewable.

## Implementation Notes

- Implemented local accessible order and atomic persisted order/alt editing without API/schema/dependency additions. Product saves preserve the independent gallery draft.
- Completed three review layers; patched announcement identity/repetition, dirty gallery retention, snapshot regression proof and browser verification/cleanup. Final checks: 141 catalog tests, 9 PostgreSQL tests, typecheck, lint, Webpack build and four-width browser verification passed. Default Turbopack remains blocked by existing ACL errors; see verification-e04-03-05.md.
- Review is complete; the owner explicitly accepted the story on 2026-10-19 after the walkthrough. Sprint state is done. One agent-context documentation finding remains deferred.

## Spec Change Log

## Review Triage Log

- Blind 1 — medium / patch: ProductManager.save calls loadGallery, whose null prop now clears dirty order/alt without confirmation; preserve dirty gallery during unrelated product saves and cover that reachable path.
- Blind 2 — medium / patch: Different images moved to the same destination produce identical live-region text; add image identity and a sequence so each operation changes text.
- Blind 3 — low / patch: Loading assertion is satisfied by the persistent empty reorder status; assert actual loading labels instead.
- Blind 4 — low / patch: Browser nonempty status assertion cannot prove announced destination or primary; assert their content.
- Blind 5 — low / patch: Browser directly focuses the button and does not prove tab reachability; add traversal verification. Focus restoration after a full page reload is not an existing requirement.
- Blind 6 — medium / patch: Old two-query reader passes the paused-writer test; add controlled cross-commit reader interleaving.
- Blind 7 — low / patch: Sequential browser cleanup aborts after a close/unlink failure; independent teardown attempts preserve disposable-resource cleanup.
- Blind 8 — low / patch: Fixed-port readiness can accept another process before observing spawned-server failure; allocate a loopback port and verify spawned readiness.
- Blind 9 — low / defer: Refreshed agent context omits explicit prerequisite security decisions. The implementation contract remains loaded and product code preserves controls; context-file changes route to deferred work under the build review rules.
- Edge 1 — medium / patch: Same live-region text for different image moves reproduces Blind 2; same correction.
- Edge 2 — low / patch: Registering a filename before a failed write can make unlink throw ENOENT and prevent remaining cleanup; same teardown correction as Blind 7.
- Verification 1 — medium / patch: Filed regression gap confirms the snapshot test does not reject the old two-statement reader; same controlled-interleaving correction as Blind 6.

## Design Notes

Intent gaps: none found. Footprint: existing component/service and tests plus dedicated verification artifacts; no public API or schema additions. Irreversibles: no deployment/migration; tests use isolated disposable fixtures. Temporary slots must avoid every currently occupied active slot and fit PostgreSQL integer bounds; fixed offsets alone do not prove this. Focus handling must account for the invoked control becoming unavailable at a boundary.

## Verification

- Targeted Vitest gallery UI, product-manager, gallery route and real PostgreSQL reorder checks must pass.
- `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run build` must pass; run applicable catalog regression tests.
- Browser verification must exercise persisted Draft images with real server-resolved staff session; record widths, focus, announcements and reload results. Report any unavailable environment honestly.
