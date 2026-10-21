---
title: 'E04-04-06: Staff publication checklist and slug/SEO editing'
type: 'feature'
created: '2026-10-21'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'ef3aea55705de78550c3334f6ddff73f1b31e15e'
story_key: '4-406-staff-admin-ui-for-publication-checklist-slug-and-seo-editing'
context:
  - AGENTS.md
  - _bmad-output/specs/spec-e04-04-publish-slug-redirects-and-seo/SPEC.md
  - _bmad-output/specs/spec-e04-04-publish-slug-redirects-and-seo/implementation-contract.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Staff can edit product drafts and galleries but cannot inspect publication blockers, publish/unpublish, or manage slug and SEO metadata in the editor.

**Approach:** Extend the existing staff product editor with saved publication status, a server-backed readiness checklist, confirmed publication actions, and validated slug/SEO fields. Keep published products available in the staff list so staff can reopen and unpublish them.

## Boundaries & Constraints

**Always:**
- Preserve Arabic RTL, visible labels and focus, keyboard access, responsive reflow and LTR slug/SKU text. Checklist issues link to and focus corresponding content, slug, category, variant or gallery controls; ID-based issue paths must resolve against persisted variant/image IDs.
- Show Draft/Published status from server responses. For saved drafts fetch readiness without cache, show loading/error/retry states and grouped checklist results. New unsaved products explain that saving is required first. Refresh assessment after product/gallery saves and publication changes; prevent stale requests from updating another selected product.
- Publishing is available only for a saved draft with a current successful ready assessment and no unsaved product/gallery changes or active mutation. Explain when changes need saving. Readiness remains advisory: the server transaction rechecks it, and publish-time blockers replace the displayed assessment.
- Require explicit confirmation for publish/unpublish, with cancel and keyboard-accessible focus behavior. Cancel sends no mutation. Disable duplicate actions and selection changes while mutations run. Preserve entered values on validation, conflict, session expiry and network failures; offer actionable retry/login feedback.
- Use existing staff authentication, CSRF and API error envelopes. POST empty JSON to existing publish/unpublish routes, then update the selected product, list status and CSRF from the response without reloading the page.
- Provide slug validation (normalized ASCII segments, maximum 255), optional SEO title/description with 70/160 limits and visible character counters. Blank SEO values clear overrides and explain content fallbacks. Blank slug on creation allows existing server generation; saved products require valid slug. Warn that changing a published slug preserves the previous address through redirects.
- Save metadata through existing validated product POST/PUT, including metadata in dirty-state and idempotency fingerprints. Reuse the established slug uniqueness/redirect service and show field-linked errors. Include draft and published products in the staff listing, preserving public published-only filtering and excluding archived products.

**Never:** Add migrations, deploy, mutate live data, introduce storefront rendering/public media, change publication rules or redirect algorithms, or bypass staff authorization. Do not introduce a second SEO mutation implementation where the existing product writer already provides the required behavior.

## I/O & Edge-Case Matrix

| State / action | Expected behavior |
|---|---|
| New product | Save-first guidance; generated or custom slug; optional SEO |
| Saved draft with blockers | Arabic checklist and links to correction controls; publish unavailable |
| Ready clean draft | Confirm then POST publish; show Published immediately |
| Published product | Reopen from list, edit metadata, confirm unpublish; show Draft immediately |
| Unsaved product/gallery or pending operation | Explain save requirement; prevent conflicting publication actions |
| Publish returns readiness failure | Display latest server blockers; preserve editor values |
| Invalid/duplicate slug or SEO overflow | Associated errors; preserve values; no success state |
| Cancel, expired session, network failure | No mutation on cancel; recoverable feedback for failures |
| Product switch or out-of-order readiness result | Ignore obsolete response; assess only current saved product |

</frozen-after-approval>

## Code Map

- `src/app/admin/(workspace)/catalog/products/product-manager.tsx`: existing CRUD, CSRF, dirty signatures, gallery callbacks and error handling; integrate lifecycle and metadata without replacing variant/money behavior.
- `src/app/admin/(workspace)/catalog/products/product-gallery.tsx`: existing persisted attachment IDs and dirty/busy callbacks; add focus targets if needed.
- `src/app/admin/(workspace)/catalog/products/page.tsx`: authenticated staff page; update draft-only heading.
- `src/modules/catalog/products/application/product-service.ts`: existing metadata save/redirect handling; staff list currently filters drafts. Keep public filtering unchanged.
- `src/modules/catalog/products/contracts/product.ts`: reuse slug and metadata validation; ProductDto already includes status and SEO.
- `src/modules/catalog/products/contracts/publication-readiness.ts`: stable issue codes and ID-based field paths. Existing readiness GET returns DTO directly; transition POST returns product and csrf.
- `src/shared/api/client.ts`: reuse ClientApiError/details and request wrapper.
- Installed Next.js layouts/pages and server/client component guides read during investigation; keep interactive state inside the client boundary.

## Tasks & Acceptance

**Execution:**
- [x] `product-manager.tsx` in the mapped directory: integrate metadata, dirty guards, status updates and publication control callbacks.
- [x] `product-publication.tsx` alongside the manager: implement checklist, request cancellation/stale guards, confirmation and transition handling.
- [x] `product-gallery.tsx` and `page.tsx` in the mapped directory: provide necessary issue focus targets and accurate page labels.
- [x] `src/modules/catalog/products/application/product-service.ts`: expose draft/published staff list while retaining public isolation.
- [x] `product-manager.test.tsx`, new `product-publication.test.tsx`, and `src/modules/catalog/products/application/product-service.test.ts`: verify matrix, payloads, guards, stale responses and listing isolation; extend gallery tests if its behavior changes.

**Acceptance Criteria:**
- Given authorized staff and an incomplete saved draft, when inspecting readiness, then blockers guide keyboard users to the corresponding correction controls.
- Given a clean eligible draft or published product, when staff confirm the applicable transition, then server-confirmed status updates throughout the editor without navigation.
- Given metadata edits or failed requests, when saving or switching products, then validation and dirty protection preserve entered work and published slug changes retain existing redirects.

## Implementation Notes

Implemented metadata validation/payloads and dirty/idempotency fingerprints in the existing writer flow. Staff list includes draft/published only; public filtering remains published-only. Checklist targets reuse existing gallery attachment IDs and add persisted variant/content targets in the manager, so no gallery implementation change was needed. Publication uses uncached readiness, explicit native confirmation, mutation/selection locks and server-returned state/CSRF. Review patches refresh authenticated CSRF before transition and reconcile the clean editor through fill(product).

Matrix audit: new-product guidance/custom metadata and validation are covered by manager/publication tests; blockers, real persisted-control focus, gallery refresh, ready publication, published reopening, metadata persistence/clearing, redirects and unpublication/public isolation are covered by the integrated lifecycle test; dirty/pending guards, cancellation, session/network retry, transaction blockers and stale product responses are covered by focused component/manager tests. Existing slug-service tests cover duplicate slug conflicts.

All eleven findings were individually triaged. Accepted findings were fixed and their integration gaps covered; no work was deferred. Browser visual/reflow and native confirmation keyboard checks were unavailable and remain unexecuted.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence and route |
|---|---|---|
| Blind 1: published retry permanently locks publishing | false | After unpublish changes status to draft, the effect starts readiness and its finally clears loading; no permanent lock occurs. |
| Blind 2: readiness loading semantics | low | The current assessment is invalidated by ID/revision and publishing is disabled, but aria-busy only reports mutations. Patch the busy indication directly. |
| Blind 3: re-login retains old CSRF | medium | sessionCsrf derives from the session token; publication does not refresh the token after a new login. Patch by reading current authenticated CSRF before transition POST; preserve form values. |
| Blind 4: ambiguous POST failure cannot recover | false | transitionPublication returns the authoritative product when already at the target status, making retry safe and reconciling status without a second state change. |
| Blind 5: transition response diverges from editor | medium | onTransition updates selected/list only while the next PUT includes unchanged stale editor values. Patch by using the existing fill function on the authoritative response; publication requires a clean editor. |
| Blind 6: identical correction link names | low | Repeated SKU/image links lack distinguishing text, but activate the correct persisted IDs. Reject: enriching them requires additional lookup/formatting complexity for a cosmetic distinction. |
| Blind 7: real transition wiring lacks UI verification | medium | Manager transport only handles readiness and fabricates publication success in its new test. Patch tests to exercise existing real publish/unpublish handlers and public isolation. |
| Blind 8: metadata persistence/redirect UI verification | medium | New metadata test checks payload but does not reload overrides or exercise published slug changes. Patch persistence and redirect integration assertions. |
| Verification 1: actual checklist targets untested | medium | Pre-verified regression gap: standalone tests supply their own matching IDs and do not verify manager controls. Patch manager integration focus assertions. |
| Verification 2: gallery save readiness refresh untested | medium | Pre-verified regression gap: gallery callback tests assert gallery state, not readiness refresh. Patch manager integration coverage. |
| Edge 1: CSRF after re-login | medium | Same verified session-token defect as Blind 3. Grouped into the same minimal CSRF refresh patch. |

## Design Notes

No unresolved intent gaps or irreversible operations. Existing product PUT already supports SEO and slug redirects; no dedicated SEO route exists, so reuse the existing writer. Previous completed story supplies public isolation and uncached resolution; preserve both. Footprint is staff UI plus staff listing and focused tests.

## Verification

Run focused component, gallery, product-service, readiness, publication and slug tests; `npm run typecheck`, `npm run lint`, and `npx next build --webpack`. Verify Arabic RTL, keyboard confirmation/focus, issue navigation and narrow-screen reflow in a browser when available; explicitly report any unexecuted checks. No production operations or database migration execution.

Final verification (2026-10-21): 7 focused suites / 104 tests passed; npm run typecheck, npm run lint, npx next build --webpack, and git diff --check passed.
