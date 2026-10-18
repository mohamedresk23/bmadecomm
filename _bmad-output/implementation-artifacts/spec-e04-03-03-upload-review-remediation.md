---
title: 'E04-03-03 upload review remediation'
type: 'bugfix'
created: '2026-10-18'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: ed2275bcbb950decd261b29979158308a1d11768
context:
  - AGENTS.md
  - _bmad-output/implementation-artifacts/spec-e04-03-03-upload-draft-image.md
  - _bmad-output/specs/spec-e04-03-product-images/implementation-contract.md
---

<frozen-after-approval reason="human-owned intent">

## Intent

Complete findings 2–13 from the supplied review so authorized staff can upload Draft images once, retry safely, and receive accurate UI feedback. Finding 1 is already fixed in ed2275bcbb950decd261b29979158308a1d11768 and must remain protected.

## Boundaries & Constraints

Always preserve private bytes until transaction failure is certain; enforce actor/product/key ownership, fencing, live authorization and Draft checks on replay. Preserve ten images, twenty attempts per 600 seconds, 24-hour nonreusable keys, existing formats/size/pixel limits, and ten-second processing deadline. Limit actual workers to four per process with FIFO waits of at most fifteen seconds. Catalog body reading uses fifteen seconds and MAX_REQUEST_BODY; generic defaults stay compatible.

Never deploy, migrate production data, add a production storage provider, implement later gallery stories, or overwrite preexisting unrelated edits. Restore tracking evidence without declaring story 03 accepted.

## I/O & Edge-Case Matrix

| State/action | Required result |
|---|---|
| COMMIT succeeds but response fails | Resolve through independent locking transaction; return saved result and preserve bytes |
| COMMIT cannot be resolved | Preserve bytes and lease, log correlation/recovery information, return safe failure |
| Confirmed rollback | Remove only newly staged bytes; record failed cleanup |
| Active key, different payload | Immediate 409, no processing/quota consumption |
| Waited-on lease disappears or request aborts | Retry acquisition promptly or cancel promptly |
| Key older than 24h / stale claim races | Reject expired keys; compare previous token on reclaim; exactly one owner |
| Superseded worker resumes | Lock scope then compare token; reject without attachment/audit/quota duplication |
| Removed high-position attachment | Append after active positions only |
| Four workers active | FIFO wait; cancellation removes waiter; expiry gives 503 SERVER_BUSY |
| Invalid identifiers / storage failure | Safe 400 / 503 MEDIA_UNAVAILABLE with correlation ID |
| UI validation error / product switch | Accurate message; no permanent-error retry; reset state and ignore stale responses |

</frozen-after-approval>

## Code Map

- `src/modules/catalog/products/application/gallery-service.ts`: reservation, processing, product/key locks, persistence and compensation; reuse contracts and ApiError.
- `src/lib/media/{storage,image-process,request}.ts`: storage adapter, child lifecycle and bounded multipart parsing.
- `src/app/api/v1/admin/catalog/products/[id]/images/route.ts`: authenticate before parsing; share one correlation ID throughout request.
- `src/app/admin/(workspace)/catalog/products/{product-gallery,product-manager}.tsx`: upload state, CSRF, create/save/gallery integration.
- `scripts/verify-gallery-upload-concurrency.ts`: existing isolated real PostgreSQL harness; extend rather than using development data.
- `_bmad-output/implementation-artifacts/sprint-status.yaml`: restore 4-301/302 from story_id_map; retain 4-303 review.

## Tasks & Acceptance

- [x] `src/modules/catalog/products/application/gallery-service.ts`: unify bounded abortable acquisition/polling, validate hash and expiry before waiting/reclaim, compare old token on update, and retry after deletion/claim races. Delete only owned incomplete reservations. Lock product then scoped key and compare token before mutation. Recheck Draft/existence on replay. Filter removed positions. Map staging failures to 503.
- [x] Same service: resolve ambiguous commit using a fresh transaction that waits on the scoped key lock; check completed token/result and committed media ownership before deciding compensation. Retain resources on failed resolution. Ensure outer cleanup cannot delete unresolved/successful work.
- [x] `src/lib/media/storage.ts`: add optional recovery metadata, preserve legacy JSONL, additionally log validated storage path/requestId in `.local/orphans.log`; propagate correlation through partial-write cleanup.
- [x] `src/lib/media/image-process.ts`: four-worker FIFO gate, fifteen-second queue expiry, abort removal, release after actual child close or failed spawn; retain processing deadline.
- [x] `src/lib/media/request.ts` and images route: configurable body bounds/deadline, catalog constants, blank/control identifier rejection, one fallback UUID shared by audit/error/headers.
- [x] ProductGallery/Manager: accurate 422 feedback, transient-only same-key retry, reset/cancel or suppress old-product uploads, disable unavailable-gallery controls, load gallery after creation; preserve unrelated form input.
- [x] Corresponding service/API/storage/processor/request/component tests and PostgreSQL harness: cover every matrix row, commit-response loss/unresolved probe, zombie fencing, competing reclaim, same-key retry after transient failure, removed position reuse, CSRF/callback wiring, MIME-extension mismatch, animation, quota rollover/precise Retry-After, revoked/expired replay and hostile Origin.
- [x] `sprint-status.yaml`: restore exact mapped 4-301 and 4-302 done entries. Update original story review checklist and verification evidence only where proven.

Given concurrent or retried uploads, when one wins, then exactly one attachment/revision/audit commits and stale workers cannot delete it. Given each failure fixture, when rejected, then existing galleries/private media survive and no Draft public promotion occurs. Given successful first Draft save, when gallery loads and uploads, then CSRF reaches the route and returned gallery renders.

## Implementation Notes

Planning: no unresolved intent questions or irreversible actions. This is a cross-layer remediation, requiring dispatch rather than the small-change route. Existing dirty artifacts were authorized for preservation earlier in this session. Three investigation agents confirmed findings and test seams.

Implemented all tasks; independently audited the baseline diff and every matrix row against passing tests. Three review layers completed, with fourteen findings individually triaged below. Review patches add serialized four-second lease renewal during worker queue/processing, one-second lock/two-second statement limits for claim/renewal/recovery, and fresh tokens after database waits. Preserve original key creation time for the 24-hour rule. Replays and failed cleanup remain fenced.

Final related-module review-patch tests: 68 passed; final API rerun: 50 passed. Real PostgreSQL independent-process duplicate/reclaim/capacity and held-original commit-resolution/timeout checks passed and cleaned their isolated schema/storage. TypeScript, ESLint (one preexisting warning) and Webpack production build passed. Full repository run: 534 passed, seven failures (six untouched baseline migration assertions and one sandbox temporary-directory EPERM; the latter passed in an escalated isolated rerun), one skipped and one todo. Default Turbopack remains blocked by access to an old BMAD render directory. These limitations are recorded, not represented as successful checks. Story 4-303 remains review pending human acceptance.

## Spec Change Log

## Review Triage Log

- B1 high / patch: FIFO wait plus processing can exceed the lease age; renew fenced ownership during that demonstrated healthy interval.
- B2 medium / patch: A blocked claim can age its candidate before acquisition; bound claim waits and establish fresh owned lease state.
- B3 medium / defer: General database connection/query cancellation is preexisting; this patch bounds claim/recovery lock waits but does not promise cancellation of every database call or pool checkout.
- B4 medium / patch: The new recovery lock needs a deadline to return a safe unresolved-outcome failure rather than hanging.
- B5 false: Production upload callers (HTTP route and isolated verifier) pass root databases; no active-transaction caller exists. DbContext's broad static type is not evidence of a reachable outer-transaction recovery bug.
- B6 medium / patch: In-progress 409 is transient; preserve its key so retry cannot create a second operation.
- B7 low / patch: Retry availability must match upload availability while the gallery reloads.
- B8 low / patch: The capacity-only fallback is now generic validation feedback. Displaying the server's English message is explicitly requested by the user and is not itself a defect.
- B9 medium / patch: Attempt both recovery logs independently so failure of the new destination cannot suppress the compatible legacy log.
- B10 low / rejected: Repository-wide evidence is being finalized by the parent; a temporary implementation handoff placeholder does not establish false success. Final results and limitations will replace it before completion.
- E1 high / patch: Same healthy-lease expiry defect as B1; preserve the four-worker cap and fifteen-second queue deadline.
- E2 medium / patch: Same temporary 409 key-loss defect as B6.
- E3 medium / patch: Same legacy logging suppression defect as B9.
- G1 high / patch: Existing commit-loss tests probe only completed transactions. Add a held-transaction real PostgreSQL regression that would fail without the recovery lock, including deadline retention.

All patch entries resolved and covered by passing focused tests; B3 is recorded in deferred-work.md. No unresolved issue from findings 2-13 remains. Human/browser acceptance, preexisting migration test maintenance and the general database cancellation policy are separate next actions.

## Design Notes

A plain SELECT showing an incomplete key is insufficient proof of rollback while the original transaction may still resolve. Acquire the scope lock through an independent transaction before deciding; if that fails, retain resources. Current upload inserts media and attachment atomically. Keep cleanup fenced by token and completedAt.

## Verification

- Focused Vitest tests for changed modules, then full `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run lint`, and `npm.cmd run build`.
- Run the extended isolated PostgreSQL concurrency harness; record unavailable dependencies/services explicitly without claiming those checks passed.
- Record reproducible manual checks for first-save upload, product switching during upload, accurate validation feedback and retry. Automated component checks do not imply browser acceptance.

Matrix audit: COMMIT success/unresolved cases run in API tests and the held-transaction PostgreSQL harness; rollback/failed cleanup in API/storage tests; active mismatch, missing lease, abort, expiry, fencing and renewal in API tests; stale claim races/removed positions in PostgreSQL plus API tests; worker capacity/FIFO/abort/timeout in image-process-gate.test.ts; identifier/storage errors in API tests; validation/product-switch/same-key contention in component tests. All covering tests ran and passed.
