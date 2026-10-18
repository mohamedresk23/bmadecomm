---
title: 'Guard generic publication of Draft product media'
type: 'bugfix'
created: '2026-10-18'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent">

## Intent

Prevent generic media publication when any product_media ownership link belongs to a Draft product. Return 409 CONFLICT with "Draft product media cannot be published through generic publish endpoint" before storage publication or the active-media shortcut. Preserve unrelated and non-Draft publication behavior.

</frozen-after-approval>

## Implementation Notes

- No intent gaps, migrations, deployments or irreversible data changes. Small footprint: upload service and regression tests.
- Use existing productMedia/products schema and ApiError.conflict. Include soft-removed links because ownership remains. Preserve existing user edits in other artifacts.
- Verify pending/active Draft rejection, actual HTTP response and private storage, plus existing publication behavior.
- Added real HTTP coverage for shared published/Draft owners, removed Draft links, and active media preserving preexisting public bytes. Published/archived/unowned publication and missing-media 404 remain covered.
- Validation: focused four-file Vitest suite (52 tests), TypeScript no-emit check.

## Review Triage Log

- false: Alleged concurrent attachment of existing media is not reachable in current production code. gallery-service.ts inserts new media and its ownership in the same transaction; product-service.ts exposes no transition back to Draft. Shared locking is not needed for this bounded fix; reassess if those workflows are introduced.
- low, patched: Added a published owner before the Draft owner in every HTTP regression, including the removed-link case, to verify any Draft ownership blocks publication.
- low, patched: Active-media fixture now contains actual public bytes and asserts both public and private bytes survive rejection.
