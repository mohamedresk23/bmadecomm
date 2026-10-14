# E04-03-01 preparation evidence

Date: 2026-10-14; planning only. This companion supports the draft Build spec. It does not declare dependency completion, policy adoption or implementation authorization.

## Decisions and readiness

Latest explicit user authorization adopts ten seconds per server image-processing operation, with actual termination, temporary cleanup and no partial persisted result; response-only timeout is insufficient. This supersedes the earlier unconfirmed-timeout notes below. Only the logo-CSRF prerequisite is authorized for implementation; image-processing acceptance remains future E04-03-01 work.

Additional read-only native evidence: node_modules/sharp/src/common.cc:849–871 sets libvips progress signaling and calls vips_image_set_kill on progress timeout; pipeline.cc attaches this to processing. This supports cooperative native cancellation, not a hard wall bound during every metadata/processing stall. The draft's concrete future design therefore isolates all metadata/decode/encode in a child process with parent-enforced ten-second deadline, termination awaited and no worker DB/storage access. No such worker was implemented or benchmarked here.

Follow-up owner decisions supersede the open geometry/animation/company/compatibility choices below: <=4096 pixels per side AND <=8,000,000 pixels total, static-only; separate store deployments with separate databases and storage; logo caller CSRF change documented as a separate prerequisite before execution. No shared-company tenant implementation or automatic first-frame conversion is authorized. Native timeout 10 seconds is still a proposal, not expressly adopted by the conservative-choice answer. No workload measurements were added.

The user approved 64 KiB multipart overhead beyond the unchanged file limit, Owner-only legacy routes, existing catalog roles for later product routes and local-development scope. Decode limits remain explicitly unapproved. Production provider and retention are deferred, not waived. New compatibility and company-isolation questions are recorded in the draft. Sprint story remains backlog and Build spec remains draft until all readiness questions close.

Current branch testanti has relevant catalog history. Pre-existing dirty entries are the planning/tracking artifacts produced and explicitly authorized in this conversation, with no tracked application diff at entry. Continued only their authorized planning scope, preserving all entries; no commit/cleanup/reset inferred. Rendered Build activation succeeded once. A stale epic context was refreshed from current planning, without starting another story.

## Dependency verification and confidence

| Dependency | Evidence | Result and missing proof |
|---|---|---|
| F00-07 intent | spec-f00-07-media-storage-foundation.md: status in-progress; frozen limits JPEG/PNG/WebP, 5MB, local files; original success mentions URL | Approved baseline intent exists; pending upload currently returns id/status, not URL. Preserve private pending behavior and disclose historical contract mismatch |
| F00-07 outcome | bmad-build-auto-result-f00-07-media-storage-foundation.md lines 2–3 duplicate blocked/implemented status; 47/69 say tests not run, 64–74 claim success/checked ACs | Internally contradictory, no trustworthy single acceptance verdict. Preserve original history; do not select favorable sentences or claim rerun |
| F00-07 code | upload.ts magic sniff/sharp/private save/media insert; storage.ts copies to public on explicit publish | Implementation exists, but unknown decode bound, no MIME agreement, global mock trust and no DB-failure compensation; interface alone does not satisfy durable production storage |
| F00-07 tests | upload/route.test.ts and publish/route.test.ts use client x-mock-user; clean shared public/uploads and storage/private recursively | Tests validate obsolete trust model and can delete unrelated fixtures. Do not run unchanged; new isolated roots/DB fixtures and real session tests are prerequisites to useful acceptance evidence |
| F00-03 | spec-f00-03-api-conventions.md status done and review claim; shared errors/error-handler/client/validation code and tests exist | Recorded prior success, not independently repeated here. No numeric run log in this record. Current error handler lacks private cache headers and logs raw thrown errors; media adapter must sanitize safe mapped failures and apply private headers locally |
| Staff sessions | docs/staff-session-foundation.md records eight new tests, 102 total and five PostgreSQL groups, scoped to initial foundation; docs/staff-access.md records later MFA/HTTP/UI checks with final parent run still required | Prior explicitly recorded evidence with scope limits. Current live session resolver/cookie/CSRF helpers exist; no new run claimed, initial counts do not prove later whole login complete |
| Catalog continuity | spec-e04-02.md final 2026-10-14 evidence: 18 focused route/UI tests, four PostgreSQL concurrency groups; current schema/service exists | Strong recorded product evidence; no browser/app DB migration claimed; no bearing on secure image upload acceptance |
| Cross-consumer logo | src/app/admin/(workspace)/settings/profile-form.tsx:118–121 sends upload without CSRF | Securing route would break existing caller unless minimal header/test adaptation is approved; no general settings feature change needed |
| Tenancy | schema has singleton default settings, global media/users, no tenant/company resource key; local storage roots global | Shared-deployment company isolation not established. Do not substitute staff/user isolation for tenant isolation; separate prerequisite if required |

## Identity and request plan

Remove x-mock-user parsing from both legacy HTTP entry points in every runtime. Test-only identity setup stays inside isolated test harnesses issuing actual server-backed cookies; never a production code branch or public test header. Reuse requireOwnerSession and require current session/account/Owner on each request. Validate exact Origin even when absent (helper presently tests origin only when supplied) and current X-CSRF-Token before reading bytes. Role denial occurs before storage/decoder work. Caller-supplied company/user/permissions and forwarded headers never select identity or storage scope.

Upload response remains pending id/status; explicit Owner publication remains the legacy feature, not a preview side effect. Product-owned Draft promotion guard is story 03 when attachment ownership exists; do not silently introduce its tables in 01. Reusable Upload obtains CSRF via its legitimate owner caller/props, renders safe local preview, and never calls publish automatically. Logo caller already possesses settings CSRF: proposed adjustment sends it on upload and retains normal profile save.

Limit streamed body before formData: independent exact file maximum 5,242,880 and total multipart maximum 5,308,416 bytes. Count actual chunks, not just Content-Length; cancel/abort with bounded deadline; reject malformed/multiple/unexpected parts. Bounded buffering is acceptable locally at this size, but copies and multipart parser allocations must be accounted for. Reuse boundedJson for publish validation; no dependency installation or a new multipart library required in planning. HTTP abort/decode deadlines are distinct; JS Promise timeout alone does not stop native decoding.

## Decode recommendation and evidence

Installed package.json reports **sharp 0.35.5**. The actual package layout is dist/*.cjs, not historical lib/*.js. dist/input.cjs:54–61 defines default limitInputPixels `0x3FFF ** 2` = 268,402,689, failOn warning, limitInputChannels 5, unlimited false and sequentialRead true; explicit pixel overrides are validated at 142–151. Animation/pages mapping is at 244–256. dist/output.cjs:1565 onwards documents native timeout and excludes time waiting for a libuv worker. dist/utility.cjs documents cache memory as cache-only and concurrency as threads per image, not maximum simultaneous images.

Primary documentation corroborates pixel and frame controls: [Sharp constructor](https://sharp.pixelplumbing.com/api-constructor/). Frame inspection must precede loading all frames; setting animated false alone can silently select a first frame rather than reject animation. Library metadata dimensions are a guard, not proof against every malformed file; full strict decoding remains required.

**Proposed owner policy:** width and height each <=8192, total pixels <=16,000,000, one static frame only, reject animated WebP and APNG, failOn warning/unlimited false/sequentialRead true, native decode/encode timeout 10 seconds. GIF/SVG/other formats already remain unsupported. Do not resize an over-limit upload into compliance or silently flatten animation. Explicit dimension and pixel checks are cumulative: 8192×8192 is rejected by the total-pixel cap.

Rationale: 4000×4000 gives up to 16M pixels for high-resolution product photographs; the separate dimension cap prevents long narrow pathological inputs. Re-encoding strips EXIF but must preserve intended orientation by applying approved normal auto-orientation before removal. Rejecting animation removes multi-frame amplification and surprising first-frame conversion. APNG requires container animation detection as well as decoded metadata because all decoders do not expose its animation consistently; include acTL/fcTL fixtures and do not trust the filename.

Alternative conservative policy: 4096 per side, 8M pixels, static-only; lower memory exposure but rejects more large images. Alternative allowing animation/first-frame conversion changes user-visible semantics and needs an owner decision, not an implementation default.

**Actual resource observation:** a read-only Node os query returned totalMemoryBytes 16,871,817,216 (~15.71 GiB), freeMemoryBytes 3,852,849,152 (~3.59 GiB), 8 logical CPUs/availableParallelism. This is a transient host snapshot, not a process/container allowance. CIM inspection was denied. No decode workload, CPU/latency benchmark, peak RSS or concurrency stress measurement was performed.

**Estimates only:** 16M × 4 channels × 1 byte = 64,000,000 bytes (~61 MiB) for one 8-bit RGBA representation. 16-bit input doubles that; internal copies, compression, color conversion, output buffers and cache can add substantially. A rough 128–256 MiB planning envelope per active image is not a measured maximum or hard memory guarantee. Eight CPUs do not justify eight simultaneous uploads. Start future measurement at one active decode per process, with bounded admission, and do not globally change sharp cache/concurrency for unrelated callers. If a hard RSS cap or reliable process-kill isolation is required, propose a separate worker/process sandbox prerequisite; the current in-process library cannot promise it from a pixel cap.

For the adopted conservative policy, one 8-bit RGBA representation at 8M pixels is 32,000,000 bytes (~30.5 MiB); 16-bit doubles it. This arithmetic remains an estimate of one representation only, not measured native peak RSS. Both caps apply: 4096×4096 still exceeds 8M and must fail.

Future measurement matrix: representative JPEG/PNG/WebP, EXIF rotation, 8-/16-bit where accepted, highly compressible files within 5 MiB but just below/above dimension/pixel caps, corrupt/truncated chunks, animated WebP/APNG. Capture actual RSS peak and elapsed time including queued/admitted cases. No synthetic measurement result is supplied here.

## Required acceptance evidence at implementation

- Real Owner cookie versus guest/customer/catalog-only/disabled/revoked cookies; both routes, forged header alone and alongside valid unauthorized identity; bad/missing Origin and CSRF. Assert no read/decode/storage before denial.
- Independent file and total-body exact boundary/one-byte-over; missing Content-Length, false small Content-Length, malformed multipart, duplicate file, disconnect and bounded timeout. Exceeding file limit still fails even when request remains below file+overhead.
- Declared MIME versus actual bytes/extension, unsupported executable/PDF/SVG, truncated/valid-header-corrupt images, pixel/dimension cap exact/above, multi-frame WebP/APNG rejection, metadata stripping/orientation.
- Private staging and valid response shapes; no automatic public preview/copy; explicit authorized legacy publish remains operational. Orphan cleanup failure is recorded with opaque identifiers, never broad filesystem deletion.
- Isolated logo/component regression, accessible errors/loading/retry/objectURL cleanup and shared-session revocation checks. All fixture paths remain inside per-test allocated roots; preserve existing public media fixtures.
- Company boundary tests depend on the owner-selected model. For independent deployment isolation, test cookie/session/Origin/DB/storage namespaces separately without claiming SaaS tenant support. For shared tenants, current story is blocked on the separate auth/data/storage prerequisite.

## Official validator limitation

Earlier sprint generate --dry-run attempted a network download of ruamel.yaml and failed. No official generator or YAML validator success is established. Prior field/key checks were narrow local text checks, not YAML semantics or official script validation. Full completion needs an already available compatible Python+ruamel.yaml environment, or separately authorized dependency installation; then run installed sprint_plan.py validate and scoped adapter generate --dry-run, inspect valid/problems/illegal/orphans and preserve all existing statuses. This run does not install or rerun an operation that would require download. Official validation remains a tracking-confidence gap, not evidence that the application tests failed.

## Historical approval boundary (before follow-up decisions)

Build's rendered Plan requires Open Questions empty before CHECKPOINT 1 and ready-for-dev. Approve and stop is the user's intended terminal choice after those conditions; it cannot override their explicit refusal to approve decode limits yet. Current outcome: reviewable draft prepared; no ready-for-dev transition, implementation handoff or tests run. Once policy/tenant/compatibility questions are answered, update this draft and recheck it; only then use the existing Approve and stop instruction, without entering implementation.

## Current readiness outcome

All owner policy questions for 01 are now resolved: conservative decode/static policy, deployment isolation, multipart overhead, legacy Owner roles and actual-stop ten-second deadline. Separate logo-CSRF prerequisite is implemented and verified: final parent 33-test run, typecheck, lint (one pre-existing warning), three completed review layers and fixed verification gaps. Historical blocked/conditional observations above are not current state.

The plan now records actual child-process termination for future metadata/decode/encode, concrete files/tasks, acceptance and failure tests with no remaining Open Questions or unmet dependencies. Applied the user's previously specified Approve and stop: main spec and its explicit tracking key ready-for-dev, no image-story implementation begun. Unknown production provider/retention and later count/rate/alt/JSON decisions remain outside 01 local scope. Official YAML validator is still unexecuted; local/manual tracking checks are not equivalent to it.
