# A1 catalog media publication privacy verification

Date: 2026-10-22. Scope: implementation and disposable-fixture verification of [the A1 spec](spec-a1-catalog-media-publication-privacy.md). Operational procedure: [catalog media privacy](../../docs/catalog-media-privacy.md).

## Commands and results

- Final independent post-review run: `npx.cmd vitest run src/lib/media src/modules/content/settings/application/store-settings.test.ts src/modules/catalog/products/application/publication-service.test.ts src/app/api/media "src/app/api/v1/admin/catalog/products/[id]/images/route.test.ts" scripts/reconcile-catalog-public-media.test.ts "src/app/api/catalog/products/[id]/publish/route.test.ts" "src/app/api/public/products/by-slug/[slug]/route.test.ts"` — **21 files, 215 tests passed**, 82.69 seconds. Final `npm.cmd run typecheck`, `npm.cmd run lint` and `git diff --check` passed.
- Three independent review lenses completed. Patched catalog filename aliases in both publication paths, platform-independent conservative case matching, invalid deployment root detection, bounded failure reason codes and corrupt-existing-quarantine regression coverage. No findings were deferred. Per-finding dispositions are recorded in the spec's Review Triage Log.

- `npx.cmd vitest run src/lib/media src/modules/content/settings/application/store-settings.test.ts src/modules/catalog/products/application/publication-service.test.ts src/app/api/media "src/app/api/v1/admin/catalog/products/[id]/images/route.test.ts" scripts/reconcile-catalog-public-media.test.ts` — **19 files, 197 tests passed**, 65.14 seconds. Includes real local storage, PGlite, existing media/auth/security regressions, quarantine/reconciliation, settings, service transitions and authenticated loopback HTTP.
- After adding isolation to existing publication/public-slug tests: `npx.cmd vitest run src/modules/catalog/products/application/publication-service.test.ts "src/app/api/catalog/products/[id]/publish/route.test.ts" "src/app/api/public/products/by-slug/[slug]/route.test.ts"` — **3 files, 9 tests passed**, 11.21 seconds.
- `npm.cmd run typecheck` — passed after the final code and test changes.
- `npm.cmd run lint` — passed.
- `git diff --check` — passed.

PowerShell blocks the `npx.ps1`/`npm.ps1` shims here; verification used their `.cmd` equivalents. Vitest reports the repository's existing Vite native-config compatibility warning; it does not fail the tests. Initial fixture failures (duplicate retained ownership, a media ID rejected by the real HTTP input validator, a bound spy and repeated JSONL records) were corrected before the passing runs. Typecheck also caught an incorrectly shaped parameterized argument test, which was corrected to exercise actual arrays.

## Runtime observations

`src/lib/media/catalog-privacy.http.integration.test.ts` issues a real encrypted-MFA staff account, owner role, session and session-bound CSRF token. A loopback HTTP server dispatches requests to production handlers; neither authorization nor the publication service is mocked. The test starts with ready draft metadata and private image bytes, publishes successfully, observes generic media publication return 409 before storage publication, observes current public slug 200 and historical slug 301, and introduces a legacy public copy with bytes different from the private original.

An injected public-file withdrawal failure returns safe 503 without exposing the injected secret; product status remains published and no success audit commits. A retry returns 200 and a repeated draft request succeeds. Both product slugs then return 404, generic media publication still returns 409, and the local public file is absent. Exact divergent bytes are read back from the private preservation path; the original private bytes and attachment history remain unchanged. This is handler dispatch over real loopback HTTP, not a Next server or browser test.

The storage implementation syncs a private staging object, installs it exclusively at a content-addressed recovery path, verifies exact bytes, writes and syncs the preservation record, verifies the public bytes have not changed, then removes the public path. The tests also cover removal failure/retry, preservation installation failure/retry and database audit rollback after independently durable filesystem withdrawal.

## Matrix coverage

| Spec scenario | Passing evidence |
| --- | --- |
| Any catalog ownership before publication/active shortcut | `publish.integration.test.ts`: draft/published/archived × current/removed ownership, each pending and active; settings tests reject pending/active historical catalog logos; authenticated HTTP 409 |
| Noncatalog media/logo publication and 404/503 contracts | Existing publish integration tests, settings logo activation test, media route security and deployment suites |
| Legacy copy preserved before withdrawal | `catalog-public-copies.test.ts`: exact divergent recovery bytes, original bytes and retained/shared attachment history |
| Unpublish fails safely and retries | Service/storage lifecycle failure cases and authenticated HTTP 503 → 200, with unchanged status/audit on failure |
| Already-draft reconciliation without extra mutation | Lifecycle tests recreate a public copy on draft, reconcile, repeat absent no-op and compare product rows/audits |
| Historical/shared ownership and deduplication | Historical shared links and inventory tests; removed-only generic publication rejection |
| Inventory dry-run and explicit apply across catalog states | Inventory tests parameterized over draft/published/archived; dry-run exposes without withdrawal; apply withdraws once per key, retains unrelated logo bytes; missing-copy retries succeed; failures return 1 |
| Shared key with unrelated media/current logo | Parameterized conflict tests preserve public bytes, return unsuccessful command result and block unpublication with 409; Windows filename aliases are compared without case sensitivity |

The command's exported runner executes real PGlite queries and the real local adapter with an explicit temporary root. Its subprocess smoke test compiles and runs the entry point using `tsx/cjs`, memory-only PGlite and invalid arguments, asserting exit 1 and the safe message. Restricted Windows workers deny `os.userInfo()` used by tsx's IPC namespace; the subprocess test supplies a fixed fixture username only for that unrelated runtime lookup. No command apply was executed against a real deployment.

## Isolation and limitations

All reconciliation writes used uniquely named `mkdtemp` directories under the system temporary root. Cleanup validates the resolved root is beneath that directory before recursive removal. Publication and public-slug regression suites now install isolated adapters too, including the dedicated PostgreSQL test file for future runs. The repository fixture path `public/uploads/private.png` and `storage/catalog-quarantine` were confirmed absent; no persistent storage reconciliation, live database mutation, migration or deployment was performed.

PGlite does not establish real PostgreSQL locking/concurrency behavior; the dedicated PostgreSQL suite was not run. The implementation assumes trusted storage directories and no concurrent external filesystem writers during offline remediation. Tests do not establish power-loss guarantees on every filesystem or prove behavior of a deployed Next/static server, old replicas, packaged assets, CDN/browser/proxy caches or downloaded/external copies. Those require the documented controlled rollout, restart and separate cache/external-copy handling.

No public catalog-image delivery, readiness change, gallery UI change, packaging A2 fix or full retrospective acceptance is claimed. The historical retrospective verdict remains unchanged; tracking links this evidence for review.
