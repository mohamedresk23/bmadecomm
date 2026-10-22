---
title: 'A2: Package the gallery image-processing runtime'
type: 'bugfix'
created: '2026-10-22'
status: 'done'
baseline_commit: '02815f256d4381417943c3642f1e14497e4ff3ca'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

The built gallery upload route omits the dynamically spawned image worker and its native Sharp dependencies from its deployment trace. Deliver retrospective A2 so an authorized staff member can upload a product image using the packaged gallery route without relying on files from the development checkout.

Add narrowly scoped tracing includes and verify both the traced worker and an actual authenticated upload from an isolated package of the built route. A successful source-level upload or worker-only smoke test does not establish the latter.

## Boundaries & Constraints

**Always:** Preserve the generic upload route's existing dependencies. Reuse the existing worker, processing limits, private storage, staff authentication, CSRF and idempotency behavior. Package trace-listed dependencies with their relative paths intact. Use disposable image bytes, a unique temporary deployment directory and an isolated local database schema. Validate cleanup targets and terminate child processes before deleting their files. Report test scope and skipped checks precisely.

**Never:** Enable standalone output as an incidental deployment change, add production runtime dependencies, alter upload policies, expose catalog images publicly, change application authentication, migrate persistent application tables, deploy, or address A3–A5. Do not close Epic 4 or change its rejected retrospective verdict. Do not inherit checkout module resolution through NODE_PATH or run the child worker from the checkout.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Gallery package | Fresh production gallery route trace | Contains worker and installed Sharp native runtime; copied package executes processing | Missing files or processing failures fail verification |
| Authorized upload | Draft fixture, genuine staff session, CSRF, valid PNG and fresh key | HTTP 201; one attachment and private processed image with expected dimensions | Safe existing route errors remain unchanged |
| Retry | Same fixture, image and idempotency key | Same image identity; no duplicate attachment | Fail verification on duplication |
| Incomplete package | Worker omitted from copied fixture | Verification detects missing runtime rather than falling back to checkout | Expected failure is asserted explicitly |

</frozen-after-approval>

## Code Map

- `next.config.ts`: only `/api/media/upload` currently includes `src/lib/media/image-worker.cjs`, `sharp`, `@img`, `detect-libc` and `semver`. Share that dependency list with the gallery route using a narrowly matched route glob.
- `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md`: installed Next documentation; include keys use picomatch route globs, values resolve from project root, and NFT file entries resolve relative to their trace.
- `src/app/api/v1/admin/catalog/products/[id]/images/route.ts`: POST authenticates catalog staff, validates the idempotency header, reads multipart bytes and calls `uploadGalleryImage`; response is 201.
- `src/lib/media/image-process.ts`: resolves the worker from process.cwd() and spawns plain Node. `image-worker.cjs` loads Sharp dynamically. Keep both implementations unchanged.
- `scripts/test-media-build.cjs`: existing trace-copy and isolated worker verification for generic upload; extend it to cover gallery assets without confusing worker smoke with HTTP verification.
- `scripts/verify-gallery-reorder-browser.ts`: reuse local database guard, unique schema/migration/session fixtures and bounded loopback child-server lifecycle. Its checkout-based server and persistent storage fixture are unsuitable for this package-isolation check.
- `scripts/local-database-config.ts`: existing strict guard for a dedicated local development database. Use it before any schema mutation; never print credentials.
- `_bmad-output/implementation-artifacts/sprint-status.yaml`: A2 is an action item, not a numbered story; update only its action evidence after verification succeeds.

## Tasks & Acceptance

**Execution:**
- [x] `next.config.ts` — share worker/native includes across generic upload and the gallery upload route, preserving unrelated configuration.
- [x] `scripts/test-media-build.cjs` — exercise isolated traced processing for both consumers, and prove an incomplete fixture cannot silently use checkout files.
- [x] `scripts/verify-gallery-packaged-upload.ts` — assemble a temporary runtime from built route/server traces plus required build manifests; use a disposable schema and authenticated multipart HTTP upload. Assert attachment/media persistence, private processed bytes, expected dimensions and retry identity. Bound execution and clean up the schema, processes and temporary directory on success or failure.
- [x] `_bmad-output/implementation-artifacts/verification-a2-gallery-worker-packaging.md` — record build command, trace inventory, actual checks, outcomes and limitations.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` — record A2 completion/evidence only after its required checks pass; otherwise retain it as open.

**Acceptance Criteria:**
- Given a fresh production build, when both upload traces are inspected, then each contains the worker and the native dependencies installed for the host platform.
- Given an isolated traced runtime with no checkout fallback, when authenticated staff upload the fixture PNG, then HTTP 201 corresponds to a persisted attachment and a decodable private image; replay creates no duplicate.
- Given missing required runtime assets, when verification runs, then it fails clearly rather than claiming upload success.
- Given verification ends or fails, when cleanup completes, then fixture processes, temporary files and the unique schema are removed without touching existing application records or media.

## Implementation Notes

Investigation found a clean working tree on branch `testanti`, with A1 committed at the baseline above. No user-facing intent gaps remain. Changes are reversible; database writes are limited to a disposable verification schema. The footprint includes configuration, a verification harness and delivery evidence, so the dispatch route applies.

Implementation completed: shared route tracing, two isolated worker smoke checks with missing-worker assertions, and a real packaged HTTP upload/replay check. See [verification evidence](verification-a2-gallery-worker-packaging.md). Build, typecheck, focused lint and 125 existing tests passed. The disposable PostgreSQL fixture reuses historical idempotency DDL omitted from the current journal; application migrations were unchanged.

## Spec Change Log

## Review Triage Log

Three independent review layers completed: Blind Hunter (six findings), Edge Case Hunter (no findings), Verification Gap (no gaps).

| Finding | Verdict | Evidence and disposition |
|---------|---------|--------------------------|
| Header metadata does not establish complete pixel decoding | medium | Sharp metadata reads headers only. Patch: decode persisted PNG to raw pixels and assert dimensions/length. |
| Only the server PID is terminated; an externally interrupted in-flight worker might remain | low | Current single-upload fixture awaits the route response, whose processor settles only after child close and has a ten-second deadline, below the 25-second request deadline. No descendant leak occurred in the exercised paths. Reject additional process-tree tracking for abnormal external termination: infrequent for this local harness and requires new platform-specific guards. |
| No SIGINT/SIGTERM cleanup handlers | low | Default external interruption bypasses asynchronous finally. Reject signal orchestration for this local verification script: ordinary exceptions use finally; forced termination handling adds branches and cannot establish cleanup after SIGKILL/power loss. Document interruption limitation instead of promising it. |
| Attachment product association is not asserted | low | Identity/count assertions omit productId. Patch: assert attachment.productId equals requested fixture productId. |
| No negative test removes the native Sharp binary | low | Native dependency is required in the trace and actually loaded in both isolated successful worker runs; missing worker is the declared incomplete-package matrix row and is already tested. Reject extra native-library failure fixtures: no missing current acceptance coverage, and platform-specific binary removal adds test branches. |
| Cleanup failure can replace the primary failure | medium | A finally throw hides setup/upload error. Patch: retain the primary error and include its bounded sanitized message alongside cleanup failures. |

No findings were deferred to another feature. Runtime interruption limitations are recorded in verification evidence.

## Verification

- `npm.cmd run build -- --webpack` — production build succeeds; inspect fresh generic/gallery NFT files. Existing artifacts document a default Turbopack cache-access problem, so record the bundler used.
- `node scripts/test-media-build.cjs` — both isolated worker checks and the incomplete-package assertion succeed.
- `npx.cmd tsx scripts/verify-gallery-packaged-upload.ts` — actual packaged HTTP upload and replay succeed against disposable fixtures. If guarded local PostgreSQL is unavailable, record the blocker and do not mark A2 done.
- `npm.cmd run typecheck` and focused ESLint on changed code — pass.
- Relevant existing upload/processing tests — pass without weakening their assertions.
- `git diff --check` — clean.
