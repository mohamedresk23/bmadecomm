# A3 published gallery controls verification

Date: 2026-10-22. Baseline: `7d48a80e9f458aa68488292d198d8fc02aed9e12`.

## Result

The product editor supplies a gallery `readOnly` flag from the selected persisted product status. A published product keeps its gallery visible with Arabic guidance to unpublish before editing. Gallery save, file selection/upload/retry, alt text, reordering, variant mappings and removal/confirmation are disabled. Local change and network mutation handlers also check the flag. Preview retry and read recovery stay available; the flag is independent of loading and does not remount or erase gallery state.

The editor's existing dirty guard remains in place for legitimate draft changes. Published interactions cannot create unsavable local alt/order/mapping edits that disable unpublish. Successful unpublish updates the selected snapshot and enables draft controls again.

## Evidence

- Focused Vitest run of `product-manager.test.tsx`, `product-gallery.test.tsx` and `product-publication.test.tsx`: **3 files, 76 tests passed**, duration 52.65 seconds.
- `npm.cmd run typecheck`: passed.
- Focused ESLint on both changed components and their test files: passed.

The extended composed-editor lifecycle test uses genuine catalog fixture authentication, PGlite and the real product/gallery/publication HTTP handlers behind the in-process test transport. It checks:

1. Draft gallery saving refreshes readiness, then the product publishes successfully.
2. Published upload/file/save/alt/remove/order controls and variant mapping fieldset are disabled and Arabic guidance appears.
3. Attempts to change published alt text/mapping/file or activate mutation controls send no gallery writes, create no dirty badge or removal dialog, and preserve the saved alt text.
4. Unpublish remains enabled, succeeds, and restores editing.
5. Editing alt text and saving after unpublish persists the new value; public catalog resolution returns 404 for the draft.

The component regression additionally uses a two-image gallery, preselected file and open removal confirmation before switching read-only. Confirmation cannot remove an image, cancellation stays usable, nonboundary reorder remains disabled, submitted upload sends no request, previews can be retried, and restoring draft mode re-enables editing without resetting state.

## Scope and limits

No backend policy, migration, publication API or image-serving behavior changed. These are DOM/component and composed-handler tests, not real-browser keyboard, screen-reader, reflow or deployed PostgreSQL evidence. A5 retains those outstanding verification obligations. No deployment or full release acceptance is claimed. E07 planning files pre-existed this change and are excluded from its edits and commit. A4–A5 remain open. A3 does not close Epic 4 or approve its aggregate acceptance. Concurrent E07 sprint edits, including a changed epic-4 status, are not authored or included by this task.

## Review follow-through

The one-shot independent review led to explicit failed-upload retry and dirty-save read-only coverage, persisted mapping value checks, locks after reopening a published product, and failed-unpublish retry coverage. The final run passed 77 tests across 3 files in 29.52 seconds. No findings were deferred. Final typecheck, focused ESLint and diff whitespace validation passed.
