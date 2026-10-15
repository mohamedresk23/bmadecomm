---
title: 'Fix local product listing 500'
type: 'bugfix'
created: '2026-10-15'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval>

## Intent

**Problem:** The local admin products GET fails with PostgreSQL 42703 because the application selects products.media_revision while the local database has not applied migration 0015.

**Approach:** Apply the existing additive gallery migration through the local migration runner, then verify both product listing and form metadata against the same database. Preserve all existing worktree changes and product data.

</frozen-after-approval>

## Implementation Notes

- Server and PostgreSQL logs confirm the missing column. A read-only local check reproduced error 42703 and confirmed that 0015_product_gallery is the only pending migration.
- No intent gaps; no new application API or source changes required. Existing migration adds a defaulted column, a new table, and indexes; a down migration exists. Do not roll back or delete data.
- Run the existing guarded local migration runner and repeat the database reads. Authentication through the browser is outside the diagnostic script; do not bypass it or expose session credentials.
- User authorized continuing with the existing dirty worktree; existing changes are outside this fix and must not be committed as part of it.
- Applied only 0015_product_gallery using `node --import tsx scripts/migrate-local.ts`. Repeated diagnostic: pending migrations `[]`, product read passed with four products, form metadata read passed.
- Authenticated HTTP recovery has not been exercised; refresh the products page using the existing browser session to confirm it. No session credentials were read or authentication bypassed.
- Data preservation was assessed from the additive migration SQL; no before/after data snapshot was recorded. The migration does not delete or update existing product rows.

## Review Triage Log

- Low, resolved: recorded completed migration and verification evidence and finalized status.
- Low, documented limitation: service reads pass but authenticated HTTP smoke verification remains for the user's browser session.
- Low, documented limitation: four products after migration is not a before/after data comparison; preservation assessment is based on the additive SQL.
- No application code review layers beyond the operational repair review were needed; no application source was changed. No unrelated findings deferred.
