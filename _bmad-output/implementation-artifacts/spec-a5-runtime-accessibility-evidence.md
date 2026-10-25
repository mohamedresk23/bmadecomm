---
title: 'A5: Record catalog runtime and accessibility evidence'
type: 'chore'
created: '2026-10-22'
status: 'in-progress'
route: 'oneshot'
baseline_commit: 'ef0c9881f692b8adaf85db8e08d23f33d2502ff9'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

Execute and record the available A5 runtime checks for Epic 4: real Edge browser RTL/reflow/keyboard/focus and publication checklist/confirmation journeys, existing gallery/variant browser checks, and dedicated PostgreSQL publication/gallery concurrency suites. Reuse guarded local fixtures, bounded child servers, disposable schemas/files and existing installed dependencies. Add only a narrowly scoped publication browser verifier as needed; change no product behavior.

Verify a committed snapshot isolated from concurrent E07 changes. Distinguish browser DOM/keyboard observations and automated JavaScript-dialog acceptance from a human screen-reader listening session and actual native-dialog keyboard observation. Explicitly record skipped/blocked checks and give reproducible human follow-up instructions. Never fabricate human observation or release acceptance; keep A5 open if required human evidence is still missing. Preserve historical reports and exclude all E07 changes from the commit. No production operations or persistent application-data changes.

</frozen-after-approval>

## Implementation Notes

- Existing gallery/variant Edge runners already exercise four widths and keyboard/touch workflows. Remaining publication browser evidence can reuse their fixture/session/server approach.
- Dedicated local test databases exist; use explicit TEST_DATABASE_URL for an owned database ending in _test, distinct from the development database. Only disposable-schema fixtures may be migrated.
- Human screen-reader listening and rendered native-dialog keyboard behavior cannot be established through Playwright dialog.accept/dismiss. Those checks remain explicitly pending human observation.
- Small verification-only footprint, no product intent gap or irreversible action; one-shot route selected.
