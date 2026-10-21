---
title: 'Fix products listing missing slug column'
type: 'bugfix'
created: '2026-10-21'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval>

## Intent

**Problem:** Products request 9dc4e639-8cf4-4842-b39c-8d086a53f652 fails because local PostgreSQL lacks products.slug. Migration 0018 is pending while application code already selects the new fields.

**Approach:** Apply the existing migration to the guarded local development database and verify product reads and preservation of existing product data. Preserve unrelated worktree edits.

</frozen-after-approval>

## Implementation Notes

- User authorized continuing with the dirty worktree. No application source changes are needed.
- Read-only diagnosis confirmed PostgreSQL 42703, six products, and only 0018_product_publish_slug_seo pending.
- Reviewed migration: adds slug/SEO/publication columns, fills newly added slugs, adds redirect table/indexes/constraints and autofill trigger. A down migration exists. Existing product fields must remain identical.
- scripts/local-database-config.ts guards the database destination. Use the same dotenv precedence and Drizzle PostgreSQL migrator as scripts/migrate-local.ts.
- tsx cannot initialize in this sandbox (uv_os_get_passwd ENOMEM). Node 24 native TypeScript loading supports the local destination guard; the Drizzle migrator can run directly from JavaScript without modifying application code.
- Verify pending migration set before applying; compare full pre-existing product fields before/after in memory, and execute the exact aggregate SELECT from the request log.
- Applied only 0018 using the Drizzle PostgreSQL migrator and existing local destination guard. A fresh connection confirmed no pending migrations, six products with valid slugs, and successful execution of the exact formerly failing aggregate SELECT (six drafts).
- The before/after comparison reported a mismatch. Its in-memory baseline is unavailable after process exit, so complete field preservation is NOT verified. Migration SQL only updates newly introduced slug values; this supports the expected behavior but does not replace a successful comparison. No additional data changes were attempted.
- Existing authenticated browser session is unavailable to this tool session. Products HTTP/page recovery requires refreshing the user's signed-in page; successful SQL verification does not establish HTTP success.
- No application source files or unrelated worktree edits changed. Review covered the operational repair and evidence; application code review layers were skipped because no application code changed.

## Review Triage Log

- Low, documented limitation: full preservation comparison failed and cannot be reconstructed from the discarded baseline. Six rows and valid slugs only confirm counts and new field population.
- Low, documented limitation: authenticated HTTP verification is pending in the user's browser. The precise missing-column SQL failure is resolved; no claim of complete HTTP verification is made.
