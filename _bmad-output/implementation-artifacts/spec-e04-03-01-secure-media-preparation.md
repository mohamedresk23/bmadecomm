---
title: 'E04-03-01: Secure and validate existing media upload'
type: feature
created: '2026-10-14'
status: done
route: dispatch
story_id: E04-03-01
epic_num: 4
story_num: 301
story_key: 4-301-secure-and-validate-existing-media-upload
baseline_commit: 9fe55993ac7166139c582e0dc06e8aa819ededd6
review_loop_iteration: 0
context:
  - _bmad-output/implementation-artifacts/epic-4-context.md
  - _bmad-output/planning-artifacts/stories/stories-e04-03-product-images/preparation-evidence-01.md
---

<frozen-after-approval reason="owner explicitly authorized E04-03-01 implementation on 2026-10-14; other stories remain unauthorized">

## Intent

**Problem:** Existing media endpoints trust caller-provided identity and lack pre-materialization request bounds. Their tests and foundation record do not establish secure real-session behavior.

**Approach:** Secure existing upload/publish with server-resolved Owner sessions; validate and privately stage supported images; retain legitimate logo uploads. Current owner authorization permits implementing this story only, including tests and required independent review.

## Boundaries & Constraints

**Always:** Preserve exact file limit 5,242,880 bytes. User approved an additional 65,536 bytes for multipart framing, so total request bound is 5,308,416 bytes; it does not enlarge the file limit. Both legacy routes remain Owner-only. Validate exact configured Origin and session-bound CSRF before reading the body. Catalog roles apply to later product-scoped routes, not these routes. Keep storage local for development; production provider/retention remain unresolved.

**Confirmed follow-up decisions:** Each dimension <=4096 pixels AND total pixels <=8,000,000; accept static images only, rejecting animated WebP/APNG without silently flattening them. One store per deployment; separate database and storage between companies, without shared-deployment tenancy. Logo caller CSRF adaptation is a separate prerequisite, not part of this story's execution tasks. These are owner-adopted local policy values, not measured resource guarantees.

**Approved processing deadline:** Ten seconds per server image-processing operation. On expiry the operation must actually stop, return a clear safe error, clean its own temporary resources and commit no partial media result. Returning a Promise timeout while native work continues is unacceptable. Implement the native cancellation path and verify termination before reporting this acceptance as satisfied; no processing code is changed in the prerequisite.

**Never:** Trust x-mock-user or other client identity/permission headers; auto-publish for preview; start 02–07; infer shared-company isolation or production readiness. No schema migrations, shared-auth rewrite, grant subsystem, tenant schema, dependency installation or environment reconfiguration. Preserve the verified logo-CSRF prerequisite and its tests. No push or remote operations.

## I/O & Edge-Case Matrix

| Scenario | Input/state | Expected behavior | Error |
|---|---|---|---|
| Upload | Real Owner, CSRF/Origin, one valid static image | Re-encode without metadata, private pending media; original response shape | 200 |
| Forgery/access | Mock header, guest/customer, nonowner, revoked session | Reject before read/decode/storage | 401/403 |
| Bounds | File or total request exceeds its independent bound | Stop read, no writes | 413 |
| Content | Wrong MIME/extension, corrupt/unsupported image | No attachment/publication | 415 |
| Decode | Either dimension >4096, total >8M pixels, or animation | Reject before full decode | 422 |
| Failure | Abort, timeout, storage/DB failure | Safe correlation; scoped compensation/recovery | 400/408/503/500 |

</frozen-after-approval>

## Dependency Verification

- `PREREQ-E04-03-01-LOGO-CSRF` — implemented and independently reviewed; final parent run passed 33 focused tests including actual profile GET/POST CSRF linkage and real processor/private-storage regression, typecheck and lint. Evidence in `planning-artifacts/stories/stories-e04-03-product-images/prerequisite-logo-csrf.md`. Reuse existing secured upload route; no prerequisite task remains.
- Existing F00-07 baseline now has fresh focused evidence for valid pending/private processing, size/type rejection; its conflicting historical record is not rewritten or called fully complete. New image limits/deadline/recovery are this story's own implementation tasks.

## Code Map (approval baseline)

- `src/app/api/media/upload/route.ts`: now real Owner/CSRF/exact Origin before formData, private responses; preserve this completed prerequisite. `publish/route.ts`: still mock context; secure it within this story.
- `src/modules/content/settings/infrastructure/admin-auth.ts`: reuse Owner/session/CSRF helper; enforce required Origin locally, as helper currently allows missing Origin.
- `src/lib/media/{upload,storage}.ts`: processor/private file adapter; currently no pixel policy or scoped cleanup.
- `src/shared/api/{bounded-json,error-handler,errors}.ts`: shared envelope and bounded-read pattern; avoid global behavior changes.
- `src/components/Upload.tsx`: mock header and auto-publish; local ObjectURL preview replaces publication.
- `src/app/admin/(workspace)/settings/profile-form.tsx`: now sends current CSRF and preserves state on denial; compatibility-only regression coverage in this story.

## Tasks & Acceptance

**Execution, after gates and explicit implementation authorization:**

- [x] `src/lib/media/request.ts` (new) — count streamed bytes before multipart parsing, validate exactly one file, reuse bounded-read abort/deadline semantics; schema-check publish JSON using existing bound.
- [x] `src/app/api/media/upload/route.ts`, `publish/route.ts` — resolve live Owner, strict Origin/CSRF, remove mock authorization, private/no-store errors/success, correlation; preserve pending upload and explicit publish shapes.
- [x] `src/lib/media/upload.ts`, `image-policy.ts` (new) — apply owner-approved dimension/pixel/frame policy to metadata and decode, MIME/extension agreement, re-encode/strip metadata, safe failure mapping; no automatic first-frame truncation.
- [x] `src/lib/media/image-process.ts`, `image-worker.cjs`, `image-process.test.ts` (new) — execute metadata/decode/encode in an isolated child process launched with process.execPath; parent enforces one ten-second wall deadline for the whole processing operation, kills the child on expiry/abort and awaits its exit before completing failure cleanup. The worker has no DB or storage authority and returns validated encoded bytes only; persist only after successful worker completion. Test actual child exit/no late result, not only a rejected Promise. Use an explicit resolved local worker path and test built-app packaging/path resolution before acceptance; no timeout-only background processing.
- [x] `src/lib/media/storage.ts` — inject isolated storage roots, compensate only newly allocated opaque keys on failed persistence; record orphan recovery without secrets or broad deletion.
- [x] `src/components/Upload.tsx`, `Upload.test.tsx` — real CSRF/session flow, private local preview, no publish request, accessible pending/error/retry and URL cleanup.
- [x] `src/app/admin/(workspace)/settings/profile-form.test.tsx` — verify the completed separate prerequisite remains compatible with the secured real-session route; no logo caller modification in this story.
- [x] `src/lib/media/{request,image-policy}.test.ts` (new), existing upload/publish route tests — isolated DB/storage and actual issued staff-session fixtures, all matrix cases; remove global directory cleanup before executing tests.

**Acceptance Criteria:**

- Given valid Owner credentials, when either route executes, then server authorization controls the effect and x-mock-user never grants authority, including in development.
- Given independent request/file boundaries, when each is exceeded by one byte, then its check rejects without success rows/files; exact boundaries remain independently testable.
- Given damaged, falsely labelled, oversized-dimension or animated content, when processed under the approved policy, then safe rejection precedes publication; valid static JPEG/PNG/WebP strips EXIF and remains private.
- Given a DB insert failure after staging, when compensation runs, then only the new object is cleaned or recorded for recovery and unrelated/historical media remains untouched.
- Given existing logo and reusable upload callers, when real-session upload succeeds/fails, then accessible state/retry works without automatic publication or loss of form data.
- Given independently configured store deployments, when deployment A credentials or media identifiers are submitted to deployment B, then B grants no authority from A and resolves no A storage/DB records; no shared-tenant support is claimed.

## Implementation Notes

- Owner explicitly authorized resuming implementation from ready-for-dev. Existing dirty tree consists of the session's approved prerequisite changes and planning artifacts; preserve them. Existing baseline_commit retained. Implementer may run isolated temporary/in-memory tests and resource observations, never application-database migrations or dependency downloads. Do not commit or edit the prior prerequisite spec's frozen record.
- Initial implementation focused run passed 78 tests in 12 files, but parent build failed on Turbopack's analysis of fork's script path (`/ROOT/src/lib/media/image-worker.cjs`). Worker launch/packaging must be corrected before acceptance; keep process.execPath child isolation, adopted deadline and actual kill/exit semantics. This is an implementation compatibility defect, not an owner-policy change; no provider or additional story is introduced.
- Completed implementation and three independent review layers; all patch findings fixed and verified. Parent final stable full suite: 468 passed, one skipped and one todo; typecheck/lint/build and isolated traced-worker smoke passed. Full evidence, failed-run history, measured resource observations and file inventory are in `verification-e04-03-01.md`. Spec done is the Build terminal state; tracked story moves to review for human acceptance, not done.

## Spec Change Log

- 2026-10-14: Owner adopted conservative 4096-per-side/8M-total/static-only policy and separate-store deployment model; moved logo caller adaptation to a separate unmet prerequisite. Draft and sprint backlog retained; native timeout proposal not silently approved.
- 2026-10-14: Owner explicitly adopted ten-second actual-stop processing semantics and authorized execution of the logo-CSRF prerequisite only; removed timeout question without implementing image processing. Dependency completion and ready-for-dev evaluation remain pending evidence.
- 2026-10-14: Logo-CSRF prerequisite accepted with 33 passing tests, typecheck/lint and completed independent review. Owner policy questions are closed; actionable file tasks and Given/When/Then ACs retained; applied the previously requested Approve and stop choice. Status ready-for-dev describes an approved local implementation plan, not implemented product images or production readiness. No 01/02–07 execution began.
- 2026-10-14: Owner explicitly authorized E04-03-01 only; implemented the approved limits and actual-stop child processing, preserved logo-CSRF, completed required independent reviews and final verification. Build spec done and tracked story review; production decisions and later stories remain unapproved. Two pre-existing legacy-publication reliability issues deferred with baseline evidence.

## Review Triage Log

Review round 1 (2026-10-14): all three independent layers completed before triage. Every finding is recorded separately below; related cleanup findings share one patch.

| ID / layer | Verdict / route | Evidence and disposition |
|---|---|---|
| B1 blind: non-atomic public copy | medium / defer | Baseline `storage.publish` already copied directly into the public destination (`fs.copyFile`). The new exclusive write prevents overwrite but does not introduce exposure during copy. Atomic exposure is a pre-existing publication limitation, recorded for a separate change; no later product-gallery story is started. |
| B2 blind: close failure orphan | medium / patch | `handle.close()` runs outside the protected write block; private staging flag remains false on close failure. Move close into protected cleanup and verify injected failures. |
| B3 blind: recovery tier ambiguity | medium / patch | Both private and public compensation call the same key/time-only recorder. Record the internal storage location so manual recovery preserves retained originals; no recovery/retention policy is adopted. |
| B4 blind: simultaneous publish race | medium / defer | Baseline already selected pending status then copied/updated without locking. Exclusive creation now fails safely on a collision instead of overwriting; sequential idempotency is verified, concurrent idempotency is not claimed. Serialization/transaction design remains a separate pre-existing publication reliability issue. |
| B5 blind: unlogged handled 503 | medium / patch | `mediaHandler` logged only non-ApiError; wrapped storage/DB/processor availability errors lost correlated diagnostics. Log safe code/correlation for 5xx without exception details. |
| B6 blind: abort during DB insert | false / reject | The last signal check marks the persistence commit boundary. An insert that completes produces a complete pending row and private object, not a partial processing result; cancellation after committing cannot guarantee undo. Actual processing cancellation and pre-insert cancellation are enforced. No post-commit rollback guarantee is claimed. |
| B7 blind: duplicated policy literals | false / reject | Actual child-processing tests already accept 4096x1 and 4000x2000 and reject 4097x1 and 4000x2001. These contract tests exercise production worker enforcement of both exported policy values; a policy-change mismatch fails the boundary tests. No present divergence is demonstrated. |
| B8 blind: deployment handler coverage | medium / patch | Existing two-DB test verified session resolver/absence of media only. Add actual B upload/publish handler assertions for A credential/media submission using isolated test dependencies. |
| B9 blind: packaged worker execution | medium / patch | Successful build and route trace inclusion prove packaging references, not execution without the checkout. Add isolated traced-artifact worker smoke verification. |
| B10 blind: same-file reselection | low / patch | File input retains its selected value. Clear the input after retaining the File in component state and verify repeated selection. |
| E1 edge: private close failure | medium / patch | Same verified root cause as B2, private path; protected cleanup must include close errors. |
| E2 edge: public close failure | medium / patch | Same verified root cause as B2, public path; pending row must not leave an unrecorded new public object. |
| V1 verification: unused parser spy | medium / patch | Pre-verified: multipart reader never calls Request.formData. Denial tests must assert bodyUsed=false and reject a stalled stream before reading. |
| V2 verification: body read timeout/abort | medium / patch | Pre-verified: existing request fixtures all finish immediately. Add deadline408, abort400 and cancellation/release assertions for stalled reads. |

All patches retain adopted limits, true Owner authorization, no automatic publication, local storage and the ten-second actual-stop policy. No frozen owner decision changes.

## Design Notes

Installed Sharp uses cooperative libvips progress callbacks for timeout; this is real native kill signaling but not proof of a hard wall deadline across metadata parsing and stalls. Therefore the local-development plan uses process isolation for processing, with actual child termination observed by the parent, rather than relying solely on sharp.timeout. This is an internal implementation choice within the adopted deadline requirement, not an additional story or current implementation. Package the worker with the existing build output and trace it explicitly if needed; deployment to production remains separately gated.

Filename intentionally does not trigger sprint's automatic story-file promotion. The explicit story_key is manually advanced only after this documented readiness check. Official sprint validator is still unavailable without its dependency; this known tracking-tool limitation is not represented as official success and does not add a product-policy gap.

## Verification

**Executed outcome (2026-10-14):** 468 full-suite tests passed; one PostgreSQL-only test skipped under the default PGlite config and one pre-existing outbox todo. Typecheck passed; lint zero errors/one local-preview warning; Next build passed; isolated packaged-worker execution passed with 381 copied trace/artifact entries. All review patch tests passed. Actual default-ten-second noncooperative-child termination/no-persistence proof passed. See `verification-e04-03-01.md` for exact runs, failures, recovery, resources, remaining limits and files. Manual sprint checks passed; official sprint validation remains unexecuted, not a claimed success.

Approved verification plan: isolated affected Vitest suites, profile upload regression, lint/typecheck/build; real-session HTTP and metadata-stripping checks. Resource observations are recorded without claiming worst-case or production safety. No app tests or decode measurements were run during the earlier preparation phase. Official sprint validator remains unexecuted; dependency installation is outside current authorization.

Implementation checks: `npm.cmd test -- src/lib/media src/app/api/media src/components/Upload.test.tsx "src/app/admin/(workspace)/settings/profile-form.test.tsx"`, `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run build`; broaden only for unresolved integration/regression concern. Verify actual deadline termination and no writes, both independent input bounds, corrupt/animated/oversized decoding, real session denial, isolated deployment identity/storage, DB/storage-failure compensation and preserved profile behavior. Record exact results and limitations; do not count skipped tests as passing evidence. Inspect installed output-tracing docs for worker packaging and verify built-app worker path. Request-tool/network/dependency limitations must not be represented as successful official sprint validation.
