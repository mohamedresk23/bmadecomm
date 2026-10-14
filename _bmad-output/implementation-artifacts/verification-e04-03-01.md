# E04-03-01 implementation verification

Scope: approved local-development secure media foundation only. No E04-03-02–07 implementation, application database migrations, dependency installation or production storage/retention decision.

## Checks actually executed

| Check | Actual result |
|---|---|
| First focused media/API/UI/profile run | 78 tests / 12 files passed. |
| Added real production-deadline regression | 1 test passed; already-running noncooperative child killed under the default 10,000 ms deadline, termination observed before rejection, no storage/DB calls. This is process cancellation evidence, not a decoder workload benchmark. |
| Expanded focused run | 79 tests / 13 files passed. |
| First full regression run | 456 passed; 2 failed; 1 skipped and 1 todo. Failures: old shared fixed-name logo fixture collided with exclusive storage creation; owner-provisioning test cleanup EPERM in the sandbox. No passing full-suite claim from this run. |
| Isolated owner provisioning retry outside sandbox | 1 test passed. |
| Isolated logo settings/publication regression after fixture isolation | 9 tests passed. |
| Focused media/API/UI/profile/settings after publication tests | 88 tests / 15 files passed. |
| Typecheck | Passed after implementation and after isolated publication tests. |
| Lint | Zero errors; one next/no-img-element warning for the local ObjectURL preview. |
| Next production build | Initial fork-path Turbopack failure corrected to spawn(process.execPath, explicit worker path); subsequent build passed with Next 16.3.8. Route trace contains the worker and 117 Sharp/native dependency paths. Trace inclusion alone is not packaged execution proof. |
| git diff --check | Passed after removing trailing EOF blanks in the route test files; CRLF conversion notices are informational. |

The first full-suite retry started before the review patches and overlapped edits: 465 passed, two newly added close-failure tests failed, one skipped and one todo. This was not a stable final-tree run and is not claimed as success. Both close-failure tests subsequently passed in the isolated post-patch run. Final verification below supersedes that mixed-run evidence.

## Post-review verification

- Implementer affected checks: 43 tests in 8 files passed, including close/cleanup recovery, safe 5xx diagnostics, input reselection, unread denied/stalled bodies, body timeout/abort and actual isolated deployment B endpoints.
- Parent typecheck passed; lint passed with zero errors and the same one ObjectURL preview warning.
- Parent Next production build passed. The first isolated packaged-worker smoke correctly exposed a missing Sharp runtime dependency (`detect-libc`). Narrow output tracing for installed `detect-libc`/`semver` corrected the packaging defect, without installation.
- Parent `node scripts/test-media-build.cjs` passed: 381 trace/artifact entries copied into a unique temporary deployment root; child worker used that root with no checkout/module fallback and produced a valid 2x3 PNG (95 bytes). Scoped temporary cleanup completed. This verifies the packaged worker, not a production HTTP rollout.
- Parent stable final-tree full regression run passed: 468 tests passed in 68 files; one skipped file/test and one todo (470 total test entries, 69 files). Started 2026-10-14 15:55:00 local, duration 293.08 seconds, exit 0. The run was outside the sandbox to permit test-temporary cleanup. Skipped/todo entries are not passing evidence.
- `git diff --check` passed after review patches; original deferred-work records were preserved and two entries appended.
- Manual tracking check passed: seven supported story states and unique approved-ID aliases; stories 02–07 remained backlog. This is not official sprint validation.

## Resource observations

Actual sequential single-image observations from the real child worker, synthetic solid-red 4000x2000 (8M pixel) RGB images:

| Format | Encoded input bytes | Elapsed processing observation | Child peak RSS |
|---|---:|---:|---:|
| JPEG | 47,145 | 228 ms | 126,596 KiB |
| PNG | 110,821 | 174 ms | 95,472 KiB |
| WebP | 14,314 | 1,261 ms | 158,952 KiB |

These are measured observations on this workstation, not memory limits, worst-case guarantees or concurrency/load results. The adopted policy is an owner decision. No production capacity assurance is claimed.

## Independent review

Three installed Build layers completed: blind hunter (10 findings), edge-case hunter (2), verification-gap (2). All 14 findings have individual verdicts/evidence in the implementation spec. Patches addressed cleanup diagnostics, input reuse and behavioral verification. Two pre-existing publication reliability issues are separately recorded in deferred-work.md: non-atomic public exposure and absent per-record concurrent publication serialization.

## Implementation file inventory

- Server routes: `src/app/api/media/upload/route.ts`, `src/app/api/media/publish/route.ts`.
- Media implementation: `src/lib/media/request.ts`, `image-policy.ts`, `image-process.ts`, `image-worker.cjs`, `http.ts`, `storage.ts`, `upload.ts`.
- Client: `src/components/Upload.tsx`. Existing `src/app/admin/(workspace)/settings/profile-form.tsx` CSRF prerequisite remains preserved; its earlier changes remain present in the baseline diff.
- Packaging: `next.config.ts`; verification script `scripts/test-media-build.cjs`.
- API tests: upload `route.test.ts`, upload `route.integration.test.ts`, publish `route.test.ts`.
- Media tests: `request.test.ts`, `image-policy.test.ts`, `image-process.test.ts`, `http.test.ts`, `storage.test.ts`, `upload.test.ts`, `upload-timeout.integration.test.ts`, `publish.integration.test.ts`, `deployment.test.ts`.
- Client/compatibility tests: `src/components/Upload.test.tsx`, `src/app/admin/(workspace)/settings/profile-form.test.tsx`, `src/modules/content/settings/application/store-settings.test.ts`.
- Handoff records: main implementation spec, this verification report, `sprint-status.yaml`, `epic-4-context.md`, `deferred-work.md`, and an appended current outcome in `planning-artifacts/implementation-readiness.md`. Previous planning/prerequisite artifacts and frozen prerequisite record remain preserved.

## Evidence limits

- Database integration uses isolated in-memory PGlite, not a production PostgreSQL deployment.
- Storage isolation uses independent temporary roots; there is no shared-company tenant model or deployed multi-company infrastructure audit.
- Animation marker tests exercise APNG/WebP container detection; no comprehensive animated-image corpus is claimed.
- Native processing runs in a child with no storage/DB code and no inherited application secrets. This is cancellation isolation, not an operating-system security sandbox.
- Processing deadline cancellation precedes any persistence. The final pre-insert abort check is the persistence commit boundary; a completed database insert represents a complete pending object, not an automatic post-commit rollback guarantee.
- Official sprint generator/validator remains unexecuted: its uv environment requires ruamel.yaml download, outside the no-install/environment-change constraint. Manual tracking consistency checks do not equal official validation success.
- Production provider, region, retention and deployment acceptance remain unapproved.
