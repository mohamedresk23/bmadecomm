---
title: 'A1: Preserve catalog media privacy across publication and unpublication'
type: 'bugfix'
created: '2026-10-22'
status: 'done'
baseline_commit: 'adf163d0dda40cab7192e481f3fc6db4b430286f'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent â€” do not modify unless human renegotiates">

## Intent

Generic media publication currently copies published-product attachments into static `/uploads`, where they survive product unpublication. Implement retrospective A1 by rejecting generic publication of all catalog-owned media and safely withdrawing existing public copies. Verify the product publication lifecycle through authenticated HTTP handlers and actual storage bytes.

## Boundaries & Constraints

**Always:** Treat every `product_media` link as catalog ownership, including soft-removed attachments and shared ownership, regardless of product status or media status. Preserve private originals, historical references, gallery metadata and noncatalog media/logo publication. Preserve legacy public bytes in a private quarantine before withdrawing their public paths, including when those bytes differ from the private original. Make remediation retryable and observable.

**Never:** Enable public catalog image delivery, delete private originals, alter readiness rules, change gallery UI, fix packaging A2, or claim the full retrospective is accepted. Do not run remediation against persistent user storage or a live database during implementation. No migration, deployment, CDN purge or production readiness claim is included.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Catalog publication | Any ownership link; pending or active media | 409 before storage publication and active shortcut | Safe catalog-specific conflict |
| Noncatalog publication | Pending/active media, including logo | Existing publication/idempotency behavior retained | Existing 404/503 contracts retained |
| Legacy exposure | Catalog public copy exists | Preserve exact public bytes privately; remove static exposure; retain original and DB links | Storage failure is surfaced; no silent success |
| Unpublish | Published product with legacy public copies | Withdraw copies before returning successful draft transition | Failed withdrawal prevents successful transition; retry remains possible |
| Repeated unpublish | Already draft with legacy copies | Still reconcile public exposure without extra status/audit mutation | Missing public copy is a successful no-op |
| Historical ownership | Removed/shared catalog attachment | Same protection and reconciliation | Deduplicate media keys |
| Inventory remediation | Existing copies across all catalog states | Dry-run inventory by default; explicit apply quarantines catalog copies only | Report failures and return unsuccessful exit status |
| Legacy shared public key | Catalog filename also belongs to noncatalog media or current logo | Report conflict; preserve bytes; require operator to separate references before retry | Block successful affected unpublication/remediation rather than silently break unrelated media |

</frozen-after-approval>

## Code Map

- `src/lib/media/upload.ts`: `publishMedia` currently checks only draft owners. Replace with any ownership lookup before the active shortcut; remove unnecessary product join.
- `src/modules/content/settings/application/store-settings.ts`: logo saving calls storage publication independently, including its active shortcut. Apply the same catalog ownership guard here; normal noncatalog logos remain supported.
- `src/lib/media/storage.ts`: local adapter stores originals in `storage/private` and public copies in `public/uploads`; validated keys and exclusive creation are established patterns. Add a preservation-first quarantine operation outside `public`, using separate recovery paths so divergent bytes cannot overwrite originals. Extend adapter mocks as necessary.
- `src/modules/catalog/products/application/publication-service.ts`: aggregate row lock, readiness, status and audit transaction already exist. Invoke scoped catalog reconciliation for draft targets before the same-target shortcut. Keep DB transitions/audit atomic; filesystem quarantine remains independently durable on DB rollback.
- `src/db/schema.ts`: `productMedia.mediaId` reverse index supports ownership; retained links survive removal. `storeSettings.logoMediaId` references generic media. No schema changes needed.
- `src/lib/media/publish.integration.test.ts` and existing media HTTP regression tests: prior published/archived allowance is obsolete. Retain security and noncatalog cases.
- `src/modules/catalog/products/application/publication-service.test.ts`: preserve timestamp, no-op, audit and rollback coverage; add isolated storage lifecycle cases.
- `_bmad-output/implementation-artifacts/epic-4-retro-runtime-harness-2026-10-21.txt`: reuse real authentication/CSRF, handler dispatch and in-memory PGlite patterns.
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/public-folder.md`: installed guide confirms public files are URL-addressable static assets, with default max-age=0.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/media/upload.ts` â€” block all catalog ownership before any publication side effect.
- [x] `src/modules/content/settings/application/store-settings.ts` and its tests â€” reject catalog media as a logo before publication/active shortcut, retaining ordinary logo behavior.
- [x] `src/lib/media/storage.ts` and `src/lib/media/catalog-public-copies.ts` â€” implement retryable private quarantine and DB-scoped catalog inventory/reconciliation, preserving originals and divergent legacy public bytes.
- [x] `src/modules/catalog/products/application/publication-service.ts` â€” reconcile attached historical/active media on unpublish, including draft no-ops; surface failures safely.
- [x] `scripts/reconcile-catalog-public-media.ts` and companion operational documentation â€” provide dry-run inventory and explicit apply for all catalog-owned copies, with storage-root selection, bounded keys, preservation records and retry instructions. Document offline rollout/restart and separate cached/external copies; do not execute against persistent data.
- [x] Media/storage/publication tests and a focused HTTP lifecycle integration test â€” exercise the matrix using isolated temporary storage and PGlite, real handlers, sessions and CSRF.
- [x] `_bmad-output/implementation-artifacts/verification-a1-catalog-media-publication-privacy.md` â€” record commands/results, runtime observations and limitations; link evidence from tracking without rewriting the retrospective verdict.

**Acceptance Criteria:**
- Given a ready draft with private image bytes, when staff publishes the product, attempts generic media publication, then unpublishes, then generic publication returns 409, current/historical public product URLs are unavailable after unpublish, and catalog bytes have no readable local public path.
- Given legacy public bytes and a retained private original, when unpublication or explicit remediation succeeds, then exact legacy bytes remain privately recoverable, the public path is absent, and attachment history and original bytes remain unchanged.
- Given a quarantine failure, when staff unpublishes, then the response does not report successful unpublication and no success audit/status transition commits; a later retry can complete safely.
- Given unrelated public media and logos, when catalog remediation runs, then their public paths and publication behavior remain unchanged.

## Implementation Notes

Planning: no unresolved intent gaps. Footprint spans storage, media policy, publication service, an operator tool and focused tests. Implementing code is reversible; applying legacy reconciliation moves public data and is an operational side effect. This run prepares and tests that operation only in disposable fixtures. Existing downloaded or externally cached bytes cannot be recalled by local storage changes.

Implemented and audited all tasks and matrix rows. Independent blind, edge-case and verification-gap reviews completed; all surviving findings were patched, with no deferred items. Final post-patch verification: 215 tests across 21 suites passed, TypeScript and ESLint passed, and diff whitespace checks passed. Actual storage files and authenticated loopback HTTP prove local withdrawal and preservation; persistent remediation and deployed/static-server verification remain operational work explicitly outside this execution.

## Spec Change Log

## Review Triage Log

- BH1 — medium, patch: CLI accepted nonexistent absolute roots, treating all files as absent. Validate the deployment/private-storage directories before inventory; an existing unrelated deployment cannot be identified automatically, so retain the documented operator requirement to pair DB and storage.
- BH2 — high, patch: Media IDs are not filename-unique; generic/logo writers can publish a catalog filename via an unrelated row. Extend existing ownership lookup to filename aliases before either shortcut, retaining noncatalog-only keys.
- BH3 — medium, patch: Windows-only case folding misses supported case-insensitive filesystems. Compare legacy keys conservatively without case sensitivity; generated application filenames are lowercase.
- BH4 — false: The cited external replacement race requires an external filesystem writer during reconciliation. Controlled offline remediation explicitly stops writers; application catalog writers only create unique private keys and the publication guards reject retained ownership (including aliases after BH2). No application path replacing catalog public bytes was demonstrated. General external-writer atomicity is explicitly outside the recorded evidence.
- BH5 — false: This implementation does not claim power-loss durability on every filesystem. Both the operator guide and verification artifact explicitly require backups and state this limit. Exact-byte preservation under ordinary successful execution and retry is covered; directory-sync portability would add a guarantee not made here.
- BH6 — low, rejected: Full-table inventory on each unpublish is real, but no harmful size/latency is demonstrated for this repository. SQL scoping/indexing would require additional query branches and retains a separate whole-catalog operator path. Revisit with measured catalog scale rather than add complexity for unmeasured harm.
- BH7 — false: Reachable application media writes enforce a 5 MB source cap and controlled image processing; legacy copies were created by those same writers. The hypothesized arbitrarily large externally replaced object was not demonstrated and contradicts trusted-storage assumptions. No claim of accepting arbitrary malformed filesystem data is made.
- BH8 — medium, patch: A bare failed result loses useful recovery diagnostics. Add bounded safe reason codes, retaining error redaction and unsuccessful exit/status semantics.
- BH9 — false: The approved acceptance criterion is absence of a readable local public path; tests inspect that actual path after authenticated HTTP unpublish. Deployed Next/static-server and cached/external-copy behavior are explicitly unverified and documented, not asserted by this change.
- EC1 — high, patch: Independently confirms BH2 for generic publication: an alias row can recreate the catalog public path. Same filename ownership fix and regression.
- EC2 — high, patch: Independently confirms BH2 for logo publication before the active shortcut. Same filename ownership fix with settings-specific regression.
- EC3 — medium, patch: Independently confirms BH1 for nonexistent/wrong roots. Add root validation and invalid-root tests; operator DB/root pairing remains an explicit operational prerequisite.
- VG1 — medium, patch: Existing tests never corrupt a pre-existing content-addressed recovery object. Add the requested fixture and assert public bytes, product state and audit survive failed withdrawal; this protects the existing equality check.

## Verification

- Focused Vitest suites covering storage, media publication, authenticated HTTP lifecycle, publication service and remediation command: all pass.
- `npm run typecheck` and `npm run lint`: pass.
- `git diff --check`: pass.
- Verify temporary-root cleanup, no persistent storage mutation, exact quarantine byte preservation and idempotent retries. PGlite evidence does not establish real PostgreSQL concurrency or deployed/CDN revocation.
