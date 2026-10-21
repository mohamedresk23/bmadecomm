---
title: 'E04-03-06: Map images to variants without losing assignments'
type: feature
created: '2026-10-19'
status: done
baseline_commit: 23054b5e79d1a0eaa39595b4c15310f3042ecf1f
route: dispatch
review_loop_iteration: 0
story_key: 4-306-map-images-to-variants-without-losing-assignments
context:
  - AGENTS.md
  - _bmad-output/implementation-artifacts/epic-4-context.md
  - _bmad-output/specs/spec-e04-03-product-images/implementation-contract.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Staff cannot assign variant images. Existing product saves replace variant rows, so naive associations would disappear or block editing.

**Approach:** Add optional same-product image assignments through Save gallery, with transactional preservation across retained-ID variant edits and explicit primary/null fallback.

## Boundaries & Constraints

**Always:** Preserve existing authorization/CSRF, Draft-only writes, private previews, validation, order/alt and dirty guards. One variant has one optional assignment; images may be shared. Omission clears mappings. Reject duplicate/foreign/inactive references atomically without disclosure. Mapping order cannot trigger a mutation.

Lock product first, then attachments in ID order. Preserve retained-ID mappings across SKU/attribute edits; clear removed IDs. Reconcile replacement/mappings/revision/audit atomically. Increment gallery revision once when explicit mappings change. Gallery PUT commits one revision/audit; no-op/failure adds none. Read one consistent aggregate. Selectors use persisted IDs and SKU/attribute labels; generated rows wait for save. Refresh/announce cleared mappings. Preserve failed/stale local inputs; never silently discard or rebase dirty edits.

**Never:** Add removal, physical deletion, publishing, storefront rendering, production migration/deployment, pricing changes or dependencies. Keep public product DTOs free of private image URLs.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Assign/share/clear | Persisted variants and active images | Reload preserves explicit assignments; omission clears; unmapped resolves primary/null | Field feedback |
| Invalid mapping | Duplicate variant, foreign/missing variant or foreign/removed image | No mutation/revision/audit | Safe 422 |
| No-op | Same order/alt and equivalent mapping set | Unchanged revision/audit | None |
| Retained variant edit | Same ID, changed SKU/attributes | Image assignment survives row replacement | Rollback on failure |
| Removed variant | Assigned ID omitted from product save | Mapping cleared; one revision increment and audited change | Refresh/announce |
| Concurrent edits | Product replacement overlaps gallery save | Valid committed state; stale revision rejected | Preserve local review state |
| Unsaved/dirty UI | Generated rows, pending gallery edits, failed refresh/save | No unsaved-ID assignment or silent loss; explicit save/discard recovery | Accessible status/errors |
| Fallback/privacy | Unmapped variant or empty gallery | Active explicit image, else primary, else null; no public private URL | Preserve Draft filtering |

</frozen-after-approval>

## Code Map

- Files below exist except migration/table, fallback resolver and new verification files.
- `saveProduct` replaces variants for SKU swaps; capture/remove/restore mappings under its product lock.
- `getGalleryByProductId` returns empty mappings; preserve its single-snapshot read without multiplying images.
- ProductManager skips existing-product gallery refresh; ProductGallery resets drafts on revision changes. Both require deliberate reconciliation.
- Reuse story 05 PostgreSQL/browser isolation and existing security/rollback/retained-ID fixtures.

## Tasks & Acceptance

**Execution:**
- [x] `src/db/schema.ts`, `src/db/migrations/0017_variant_media.sql`, `0017_variant_media.down.sql`, `src/db/migrations/meta/_journal.json` — composite unique targets, restrictive same-product FKs, variant PK and attachment index.
- [x] `src/modules/catalog/products/contracts/gallery.ts` — replace deferred restriction with strict duplicate/membership validation.
- [x] `src/modules/catalog/products/application/gallery-service.ts` — mapping snapshot/write/audit/no-op and internal fallback resolver.
- [x] `src/modules/catalog/products/application/product-service.ts` — preserve mappings through replacement; audit clear/revision.
- [x] `src/app/admin/(workspace)/catalog/products/product-gallery.tsx`, sibling `product-manager.tsx` — persisted selectors, dirty state, coordinated writes and safe refresh/announcements.
- [x] Corresponding service/component test files and `src/app/api/v1/admin/catalog/products/[id]/images/route.test.ts` — matrix, actual product edit/save/reload, privacy and dirty regressions.
- [x] `src/modules/catalog/products/application/variant-images.postgres.test.ts` — migration up/down/reapply, FKs, rollback, independent replacement-versus-gallery races and coherent reads.
- [x] `scripts/verify-variant-images-browser.ts`, `_bmad-output/implementation-artifacts/verification-e04-03-06.md` — authenticated RTL browser map/edit/save/reload and evidence; sync sprint transitions.

**Acceptance Criteria:**
- Given retained variant IDs, when product edits save, then their image assignments survive and removed IDs lose mappings atomically.
- Given concurrent gallery/product edits, when transactions overlap, then stale writes cannot restore deleted/foreign IDs.
- Given keyboard/touch and persisted or generated variants, when selecting images, then accessible controls permit persisted IDs only and refresh announces cleared assignments.

## Implementation Notes

- Added 0017 mapping schema, transactional gallery mapping replacement/fallback, retained-ID reconciliation, persisted selectors and safe dirty refresh recovery.
- Three independent review layers completed; all actionable findings patched. Final parent checks: 141 application tests, 17 PostgreSQL tests, typecheck, lint, Webpack build and authenticated four-width browser verification passed. No new deferred findings.
- Applied additive 0017_variant_media to local development successfully. Production remains untouched. Sprint is review pending human acceptance.

## Spec Change Log

## Review Triage Log

- Blind 1 — medium / patch: loadGallery retains another product's DTO on switching; clear only cross-product snapshots while retaining same-product refresh state.
- Blind 2 — medium / patch: Mapping selectors omit the product ownership guard used by writes; add ownership guard and reject incoming snapshots for other products.
- Blind 3 — medium / patch: A wrong-product dirty snapshot can reject the correct response as stale; same ownership correction as Blind 1/2.
- Blind 4 — low / patch: Discard confirmations omit assignments that upload/reload clears; correct the confirmation text.
- Blind 5 — medium / patch: Indexed mapping errors appear only as detached alerts; connect them to the affected selector and retain unmatched feedback.
- Blind 6 — low / patch: Blank descriptions yield an image option such as '1:'; add an Arabic image-position fallback label.
- Blind 7 — medium / patch: Constructing secondWrite does not prove it waited before lock release; observe the independent wait before releasing either test schedule.
- Blind 8 — low / rejected: Browser runner intentionally consumes an explicitly prepared build, as predecessor runners do; current-source builds were executed before verification. Requiring source provenance adds infrastructure beyond a direct correction with negligible everyday harm.
- Blind 9 — low / patch: Browser records fallback:true without asserting resolved fallback; remove the unsupported browser flag and distinguish service evidence.
- Blind 10 — medium / patch: Removing a locally assigned but persistently unmapped variant leaves hidden invalid mapping at unchanged revision; expose explicit reload recovery without discarding drafts.
- Edge 1 — medium / patch: Same hidden-assignment recovery defect as Blind 10, confirmed by same-revision membership removal.
- Edge 2 — medium / patch: Same cross-product snapshot defect as Blind 1, including failed gallery requests.
- Verification 1 — medium / patch: Filed integration-test gap for gallery busy coordination; defer PUT/POST responses and prove product actions/submission remain blocked then recover.

## Design Notes

No intent gaps. Footprint: schema, two services/components, contract and tests. Down migration loses mapping metadata: test only in disposable schemas. Existing attachment-product cascade remains unchanged.

Use persisted variants separately from editable rows. Preserve dirty order/alt during ordinary product saves. Mapping-changing edits retain local review state/original revision until explicit reconciliation/discard; refresh-null cannot clear drafts. Restore retained active assignments before audit.

## Verification

- Targeted contracts/API/service/UI regressions and real PostgreSQL tests must pass, including each matrix row.
- Run typecheck, lint and production build; document default Turbopack ACL limitation and use verified Webpack fallback if necessary.
- Browser: map/share/clear, edit retained SKU, remove a variant, reload, verify fallback/dirty recovery, keyboard and 320/768/1024/1440px RTL.
