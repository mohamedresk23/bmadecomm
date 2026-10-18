---
title: 'Refresh migration regression tests for gallery and upload rate migrations'
type: 'bugfix'
created: '2026-10-18'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
baseline_commit: 5984891059c7bd9d49c77100cc390eab14b9d4f0
context: []
---

<frozen-after-approval reason="human-owned intent">

## Intent

Repair the six stale migration assertions identified during upload remediation. Verify that applying the full journal reaches 0016, one-step rollback removes upload rate buckets while preserving gallery/products, and two-step rollback removes rate buckets/gallery while preserving product drafts. The product-draft integration test must roll back through its own migration using the explicit categories target, then reapply dependent migrations. Keep real schema/journal assertions and atomicity protections; do not change production migration SQL or run migrations against application data.

</frozen-after-approval>

## Implementation Notes

- Small reversible change to two existing test files; no intent gaps, schema changes or external side effects.
- Preserve the existing unrelated deferred-work edit. Run the affected PGlite suites, typecheck/lint, and the full suite with suitable filesystem permissions to distinguish the previously observed temporary-directory EPERM.
- Corrected the six stale expectations in migrate.test.ts and product-drafts-migration.test.ts. The initial focused run passed nine tests; TypeScript and file-scoped ESLint passed.
- Independent review suggested explicit media_revision lifecycle assertions, seeded product/variant preservation and restored defaults. Implemented all three before the final full run. No production source or migration SQL changed.
- Final full verification: `npm.cmd test -- --pool=threads` completed outside the sandbox with 541 passed, one skipped and one todo across 72 files, exit 0 (253.12 seconds). The six migration failures and the sandbox-only temporary-directory failure are cleared in this run. Typecheck and file-scoped ESLint also passed. This resolves the migration-test maintenance item recorded by the preceding remediation; human acceptance of E04-03-03 remains separate.

## Review Triage Log

- medium / patched: Table-only rollback assertions could miss an incomplete 0015 down migration; now verify media_revision persists after a one-step rollback, disappears after two steps, and returns with default zero after full reapplication.
- medium / patched: Empty preserved tables cannot detect destructive rollback; seed a product/variant and check name, SKU and price survive rollback/reapplication.
- medium / patched: Checking restored table counts alone misses broken product defaults; insert a fresh product after reapplication and verify draft status plus media_revision zero.
