---
title: 'A3: Align published gallery controls with draft-only mutations'
type: 'bugfix'
created: '2026-10-22'
status: 'done'
route: 'oneshot'
baseline_commit: '7d48a80e9f458aa68488292d198d8fc02aed9e12'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

Published products currently offer gallery changes that the server rejects, and those local edits can disable unpublish through the editor's dirty guard. Pass persisted publication state into the gallery and disable upload/retry, alt text, order, variant assignment, removal and saving for published products, with clear Arabic guidance to unpublish first. Keep previews/read recovery available and restore editing after successful unpublish. Guard mutation handlers as well as rendered controls so published interactions cannot create an unsavable dirty state.

Verify through the composed product editor with real HTTP handlers that draft editing works, publishing locks the gallery without blocking unpublish, published interactions send no gallery writes, and unpublishing restores editing and saving. Preserve server contracts, existing dirty/busy safeguards and publication behavior. No backend, migration or public image delivery changes are included.

</frozen-after-approval>

## Implementation Notes

- No intent gaps, irreversible actions or new dependencies. Small UI change plus focused regression coverage; oneshot route selected.
- Read installed Next `use-client.md` before implementation. Reuse existing gallery/editor state and real-handler lifecycle test.
- User authorized proceeding with existing untracked E07 planning artifacts; leave them unchanged and exclude them from staging/commit.
- Planned files: `product-manager.tsx`, `product-gallery.tsx`, their focused tests if needed, A3 evidence/spec and A3 action status only. Persisted status is supplied by the selected product snapshot; do not conflate read-only with loading or reset local state on transient busy changes.

- Implemented optional readOnly gallery prop supplied fail-closed from selected persisted status. Added control disabling and local/network guards; cancellation and preview retry remain usable. No status-key remount or read-only loading state.
- Extended composed-editor lifecycle and added two-image/read-only transition regression. Focused suites passed 76 tests; typecheck and focused ESLint passed. See [verification evidence](verification-a3-published-gallery-controls.md).

## Review Triage Log

One-shot Blind Hunter review returned six findings; no review layers required by this route were skipped.

| Finding | Verdict | Evidence and disposition |
|---------|---------|--------------------------|
| Failed upload retry not tested after read-only transition | low | Added a 503 retry fixture, switched read-only and asserted retry disabled with no additional request. Patched coverage. |
| Dirty gallery save guard not tested in read-only | low | Added pending alt text before read-only; saving is disabled and attempts send no request while retaining input. Patched coverage. |
| Published mapping test lacks a known different starting value | low | No mapping was inserted in the lifecycle fixture; explicitly asserted empty before/after attempting the valid image ID. Patched assertions. |
| Reopening a published product lacks direct lock assertions | low | Reopen now asserts read-only notice and disabled alt input using freshly loaded persisted status. Patched coverage. |
| Failed unpublish is not covered in composed editor | low | Added 503 unpublish transport response; status/read-only remain, interactions send no gallery writes or dirtiness, then restored transport and verified successful retry. Patched coverage. |
| Spec metadata still in-progress with loop iteration zero | false | Review ran before the required finalization step. Status becomes done here; iteration zero is correct because no planning loopback occurred. |

No findings deferred. Final focused suites passed 77 tests across 3 files.
