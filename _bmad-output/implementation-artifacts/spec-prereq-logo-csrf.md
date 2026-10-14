---
title: Owner-authenticated logo upload CSRF prerequisite
type: bugfix
created: '2026-10-14'
status: done
route: dispatch
baseline_commit: 9fe55993ac7166139c582e0dc06e8aa819ededd6
review_loop_iteration: 0
context:
  - AGENTS.md
  - _bmad-output/planning-artifacts/stories/stories-e04-03-product-images/prerequisite-logo-csrf.md
---

<frozen-after-approval reason="User explicitly authorized prerequisite implementation and verification only">

## Intent

**Problem:** Logo upload omits CSRF; its server route trusts mock identity and does not validate CSRF. Header-only adaptation cannot satisfy the authorized positive/negative security verification.

**Approach:** Secure the existing upload route with real Owner sessions, session CSRF and strict Origin; send existing CSRF from the profile caller and test both layers.

## Boundaries & Constraints

**Always:** Reuse requireOwnerSession and real issued sessions. Require exact configured Origin before multipart processing. Remove x-mock-user authority from upload in every environment. Denied requests never process files. Preserve successful pending id/status response and private/no-store responses. Caller missing token or denied upload keeps existing profile/logo state and provides actionable reload/login feedback. Isolate tests; never delete shared media directories. Read installed Next.js route docs before code.

**Never:** Alter media processing limits/storage/schema or migrations; change publish route, reusable Upload component, product image routes, grant management, dependencies/environment, or implement E04-03-01/02–07. No commits/push. The user adopted ten-second server processing with actual cancellation and no partial result; record it in 01 planning only.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected | Error |
|---|---|---|---|
| Owner upload | Issued session, exact Origin, correct CSRF, file | Existing processor called once; pending response | 200 |
| CSRF failure | Valid Owner, missing/corrupt token | No processor call | 403 |
| Identity failure | Guest/customer/nonowner/revoked session, mock headers | No authority or processor call | 401/403 |
| Origin failure | Missing/foreign Origin | No processor call | 403 |
| Caller failure | Missing token or denied upload | No unsafe fallback; preserve entered fields/prior logo | Accessible error |

</frozen-after-approval>

## Code Map

- `src/app/api/media/upload/route.ts`: replace mock context with existing Owner guard; require missing-Origin rejection locally because shared helper only checks supplied Origin.
- `src/modules/content/settings/infrastructure/admin-auth.ts`: reuse without broad changes.
- `src/app/admin/(workspace)/settings/profile-form.tsx`: existing csrf state from initial/GET data; upload currently omits header.
- `src/app/api/media/upload/route.test.ts`: obsolete mock-header tests and destructive shared-directory cleanup; replace with isolated real-session security tests, mocked processor for security boundary.
- `src/app/admin/(workspace)/settings/profile-form.test.tsx`: add token propagation and safe failure tests.

## Tasks & Acceptance

- [x] Upload route: real Owner/CSRF plus strict Origin before formData; no-store even errors; preserve response.
- [x] Profile caller: send token; no-token guard and actionable 401/403 feedback preserving profile state.
- [x] Upload tests: valid issued Owner succeeds; absent/corrupt CSRF, absent/foreign Origin, unauthenticated/customer/nonowner/expired/revoked/disabled identities and forged header denied; assert processor not called. Use isolated DB/session fixtures, never shared directory cleanup.
- [x] Profile tests: correct header, missing token no request, rejected upload preserves form/logo and offers reload/login, successful existing behavior.

Given each matrix condition, when upload executes, then the corresponding status and side-effect assertions pass. Given a valid profile logo selection, when submitted, then current session CSRF propagates and there is no auto-publish or identity claim. Given unauthorized response, when rendered, then feedback is accessible and form values remain.

## Implementation Notes

## Spec Change Log

## Review Triage Log

- blind-1 — medium / patch: prerequisite document describes caller-only future enforcement despite the newly authorized server scope; update completion/evidence after checks.
- blind-2 — medium / patch: main-story code map/dependency still describes missing CSRF/mock upload as current; refresh after prerequisite acceptance, preserving remaining publish/processing work.
- blind-3 — medium / patch: tracker comments still claim timeout unconfirmed and dependency unimplemented; update comments/status only on evidence.
- blind-4 — medium / patch: readiness report's historical conclusion is stale; append current assessment with prerequisite results.
- blind-5 — medium / patch: canonical image spec retains adopted values as unresolved; append owner decisions through memlog.py and rederive relevant contract fields via bmad-spec conventions, retaining later policy gates.
- blind-6 — medium / patch: evidence companion's closing approval boundary is obsolete; distinguish current approved policy from historical investigation.
- blind-7 — medium / patch: processor mock removed actual size/type/persistence coverage with no replacement. Restore isolated real-processor authorized-route coverage; no processor changes.
- blind-8 — medium / patch: post-auth failure/private headers untested. Add missing/malformed file and processor-error route assertions.
- blind-9 — medium / patch: caller and token source/server route disconnected in tests. Link actual profile metadata and upload handler using a real issued session.
- blind-10 — low / patch: input retains selected file after failure, impeding repeat selection. Clear selection after capturing the File and verify retry with preserved data.
- verification-1 — medium / patch: pre-verified regression gap confirms all existing real processor tests removed. Same cause as blind-7; restore private-byte/pending-row and rejected-payload regression evidence.
- edge-case layer returned no findings. All active layers completed before triage; no review layer skipped.
- Patch verification: final parent run passed 33 tests (17 security/error, 3 real processing/private persistence, 13 profile including actual handler token linkage). Typecheck and lint passed, with only existing Upload.tsx warning. No surviving implementation finding remains; actual native image processing/deadline changes remain future story work.

## Verification

Run affected route and profile component tests, typecheck and lint. No full media suite using destructive fixtures. Build if needed; no network/dependency changes. Record exact outcomes, review code independently, and update prerequisite evidence. Reevaluate 01 readiness without starting its implementation; unresolved readiness evidence must remain explicit.

Executed verification from implementation handoff: 23 focused tests (14 upload-route and 9 profile-form) passed; final typecheck passed; touched-file lint clean; full lint zero errors and one pre-existing Upload.tsx no-img warning. Processor mocked in route tests; real server-issued session resolution/CSRF checked with isolated database fixtures. No image processing benchmark, live browser or application-database migration claimed.
