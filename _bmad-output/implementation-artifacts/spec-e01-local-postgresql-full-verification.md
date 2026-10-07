---
title: 'E01 local PostgreSQL registration-to-verification validation'
type: feature
created: 2026-10-06
status: done
route: dispatch
baseline_commit: 6fa00e3f95b422278523971bfdd6691f92f11367
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="user explicitly authorized local database setup and full registration/activation verification">

## Intent

**Problem:** Sandbox registration has no development PostgreSQL, no inspectable sandbox email, and no link consumer. The user requires actual registration, database writes, email-link account activation, single-use/expiry rejection, duplicate/throttle behavior and full checks before claiming completion.

**Approach:** Start local PostgreSQL using the approved PostgreSQL/Drizzle stack, configure ignored `.env.local`, migrate the dedicated development database, add only the verification-link consumer and private inspectable sandbox delivery needed for this full path, and execute it against the real application/database.

## Boundaries & Constraints

**Always:** Preserve approved 15–128-character/Argon2id policy and 24-hour scoped proofs. User explicitly authorizes database creation/migrations and verification endpoint/page now, superseding the previous exclusion of E01-02 link consumption. Atomically consume valid proof and set verifiedAt together; concurrent consumers yield one winner. Invalid/expired/reused/wrong-scope failures remain generic. Do not mutate state on GET/prefetch; verification page requires a deliberate submit. Keep credentials/token links out of terminal logs/Git/public assets; use fragment links so bearer tokens never enter access-log query strings and remove fragment before submission. Production fails closed as before.

**Always:** Real PostgreSQL only for development verification, not PGlite as substitute. Store binaries/data/private sandbox mail/report under ignored `.local/`; bind PostgreSQL only to 127.0.0.1. Preserve existing `.env.local` identity key/config, add DATABASE_URL without output. Use dedicated development database/role; never wipe existing databases. Root performs download/init/start/credential provisioning outside implementation dispatch. Implement migrations CLI loading `.env.local` then `.env` before database import, matching worker/app, with generic errors/no credentials and explicit local-development guard. Do not regenerate applied migrations.

**Always:** Sandbox CLI persists verification emails to private ignored HTML files with strict escaping, file modes where supported, stable dedupe filenames and no secret console output. Preserve in-memory SandboxEmailAdapter for unit tests. No public unauthenticated mailbox route; inspect local files only. Verification API uses bounded request parsing and safe errors/no-store/config gate; reuse existing registration boundary helpers where sensible and source rate limit for verification (10/15min; generic rejection).

**Never:** Real emails, production activation, login/sessions/reset, resend flow, full-F00-06 completion claim, destructive cleanup of user data, credentials in process command arguments, or claiming full-path completion if PostgreSQL cannot start. If database setup is blocked, explicitly record the exact failed command/condition and all live checks as blocked while still running available tests/lint/typecheck/build.

## I/O & Edge-Case Matrix

| Scenario | Input/state | Outcome |
|---|---|---|
| Local setup | Dedicated PostgreSQL/config | Reachable development DB, migrations applied, secrets ignored |
| Registration/email | Valid four fields | One unverified customer and inspectable Sandbox link |
| Activation | Valid scoped unexpired link and submit | verifiedAt and consumedAt commit together once |
| Reuse/expiry/forgery | Invalid proof | Same generic failure; account not activated |
| Retry/abuse | Normalized duplicate and exhausted buckets | Same registration response, one user; generic 429 |
| Failure/concurrency | Account update error or concurrent consumption | Rollback proof on failure; exactly one successful consumption |

</frozen-after-approval>

## Code Map

- `src/db/index.ts`, `migrate.ts`, `drizzle.config.ts` — approved PostgreSQL/Drizzle driver; tests select PGlite; CLI currently misses `.env.local`.
- `src/modules/identity/infrastructure/proofs.ts`, `registration.ts`, `verification-email.ts`, `worker.ts` — reuse guarded consumeProof, transaction context, encrypted token and topic-filtered worker.
- `src/shared/email/adapter.ts`, `send-handler.ts` — in-memory sandbox + delivery dedupe; add private file adapter only for CLI.
- `src/app/api/v1/auth/register/route.ts` — safe bounded/timed body and errors; reuse/extract narrowly for verify.
- `src/components/RegistrationForm.tsx` — follow labels/status/focus/API conventions.
- `scripts/identity-worker.ts`, `setup-identity.ts` — correct dotenv precedence/private configuration; no secrets printed.
- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`, `03-api-reference/03-file-conventions/page.md` — local Next guides; read before code.
- `docs/customer-registration.md`, current E01 run report — prior sandbox-only completion must be qualified pending live checks.

## Tasks & Acceptance

**Execution:**
- [x] `scripts/migrate-local.ts`, `package.json`, `drizzle.config.ts` — safe local configured migration entrypoint/command.
- [x] `src/modules/identity/application/verify.ts`, infrastructure composition, shared verify contract — transactionally consume proof and activate account; generic outcome.
- [x] `src/app/api/v1/auth/verify/route.ts`, `src/app/verify-email/page.tsx`, `src/components/VerificationForm.tsx` — safe bounded API + fragment-reading confirmation UI; success/invalid/error states, no GET mutation or token leakage.
- [x] `src/shared/email/file-sandbox-adapter.ts`, `scripts/identity-worker.ts`, identity link builder — escaped private HTML sandbox mail with deterministic dedupe and fragment link; update existing URL tests.
- [x] Colocated verification/API/UI/mail adapter tests — cover matrix, rollback/concurrency and ignored private file behavior.
- [x] `scripts/verify-local-registration.ts` — runnable real-HTTP/PostgreSQL/Sandbox check, safe counts/results only. Use unique synthetic emails and only mutate their own proof expiries for expiry test; never reset other users/buckets. Include independent PostgreSQL connections/schema-isolated concurrency tests and rollback, guard cleanup by exact generated schema prefix. Fail clearly if server/config/DB missing; do not print links or secrets.
- [x] `docs/local-postgresql-verification.md`, existing report/docs — exact local start/stop/migration/worker/check commands, decisions, changed files, actual evidence or precise blocked checks. Root operates DB and runs live verification after implementation returns.

**Acceptance Criteria:**
- Given local PostgreSQL and configured application, when valid registration completes, then real DB contains one unverified customer and the private Sandbox message is available.
- Given that message's link, when the verification form submits its proof, then verifiedAt is persisted once and reuse/expiry/forgery fail generically.
- Given repeated/abusive registration, when requests run against the actual API, then normalized duplicate and source/email limits meet the approved contract.
- Given concurrent independent PostgreSQL connections, when registration/proof/throttle operations race, then database uniqueness/single-use/limits hold and rollback leaves no partial outputs.

## Implementation Notes

Latest user instruction already authorizes implementation/migrations and retaining the single full-path goal; no additional plan approval is required. Earlier policy/deployment exclusions persist except the now-explicitly requested verification link consumer. E01-02 resend and remaining F00-06 remain incomplete.

Root setup: official PostgreSQL 18.6-5 portable server under ignored .local/postgresql/runtime/pgsql; UTF8/C/SCRAM/checksums, loopback 5432 and UTC; dedicated non-superuser bmadecomm_dev role/database. Existing identity key preserved; DATABASE_URL saved privately. Seven migrations applied. Next dev restarted loopback-only on 127.0.0.1:3000 with explicit local-test source header.

Root live verification passed six groups, including actual HTTP registration/duplicate, private email/GET safety, account activation/reuse/forgery/wrong-user/expiry, abuse limits, twelve independent PostgreSQL connections, and isolated rollback. Only the generated test schema was removed. CLI worker processed ten remaining messages. Private report/mail/config/database data are ignored and secrets were not printed.

Root full suite: 85 passed, one pre-existing todo, in 51.15s. Lint zero errors/three pre-existing warnings; typecheck passed. Build first failed due restricted Google Fonts access, then reran with official network escalation. An earlier full-suite failure was a focus-effect timing assertion; waiting for the same focus outcome fixed the test without relaxing behavior. Live PostgreSQL exposed and fixed raw SQL Date serialization in rate-limit upserts by binding ISO timestamptz parameters.

## Spec Change Log

## Review Triage Log

### 2026-10-06 — Review pass
- verdicts: 16 findings — high 2, medium 8, low 6, false 0, maybe-false 0
- findings:
  - `[medium]` `[patch]` Blind: permanently invalid account state returns 500 — zero-row activation after a valid proof throws; check locked customer state before consumption and reject generically without consuming.
  - `[high]` `[patch]` Blind: proof may expire during lock waits — verification captures time before the UPDATE wait; lock rows first and evaluate a fresh database clock before consumption; add held-lock PostgreSQL expiry regression.
  - `[medium]` `[patch]` Blind: live checker bypasses confirmation browser — checker extracts HTML token then posts directly; add installed Edge headless registration/link/confirmation/reuse/expiry flow without token traces or logging.
  - `[low]` `[patch]` Blind: wrong-purpose case only has PGlite evidence — add an actual PostgreSQL/HTTP purpose-mismatch check with unchanged verification/consumption.
  - `[medium]` `[patch]` Blind: browser fetch can remain pending forever — no request deadline is supplied; bound to 20 seconds and test abort recovery with retained proof.
  - `[medium]` `[patch]` Blind: temporary/429/pending states lack tests — component suite currently exercises success and absent link only; add recoverable failures, duplicate guard and retained-proof retries.
  - `[medium]` `[patch]` Blind: failed rerun preserves stale passed report — JSON is written only on success; write safe running/passed/failed status with unique run/time and failure stage.
  - `[low]` `[patch]` Blind: refresh destroys memory-only proof without recovery guidance — preserving the secret policy is correct, but missing-proof UI should tell users to reopen original mail; add remount test.
  - `[low]` `[patch]` Blind: docs mix passed and pending live checks — root added live evidence while prior implementation paragraph still says pending; reconcile final status and qualify historical evidence.
  - `[medium]` `[patch]` Edge: stalled UI request never recovers — duplicate of blind deadline finding; same abort/retry fix.
  - `[medium]` `[patch]` Edge: already verified account shows retryable 500 — duplicate of blind invalid-account-state finding; same locked-state/generic-failure fix.
  - `[medium]` `[patch]` Verification gap: form can post wrong URL while checks stay green — ApiClient is mocked unconditionally; add real API-client/fetch/POST/PGlite integration and reject unexpected URLs, asserting stored account/proof timestamps.
  - `[high]` `[patch]` Root: real postgres-js rejects raw SQL Date — live 500 and direct throttle probe reproduced TypeError ERR_INVALID_ARG_TYPE before any user insert; bound ISO timestamptz parameters fixed it and six real HTTP/PostgreSQL groups passed.
  - `[low]` `[patch]` Root: registration focus assertion races passive effect — root full suite failed with heading rendered before focus effect; wait for unchanged required focus target, then 85 tests passed.
  - `[low]` `[patch]` Root: PostgreSQL command paths differ from installation — corrected docs to .local/postgresql/runtime/pgsql/bin before delivery.
  - `[low]` `[patch]` Root/browser run: Next route-announcer creates a second alert — unfiltered Playwright text lookup failed after correct used-link rejection; reuse the filtered product alert, preserving all rejection assertions. Final Edge phase passed.

All patch findings are resolved. Generic invalid-account state is rejected before consumption. Expiry uses fresh database time after account/proof locks and held-lock regressions passed. Actual API-client/form tests and installed Edge cover confirmation/reuse/expiry and recoverable failures. Current-run report lifecycle is tested. No review findings were deferred or rejected.

## Auto Run Result

Status: done after full-path verification, not based on PGlite-only evidence.

- PostgreSQL 18.6 is running on 127.0.0.1:5432; dedicated non-superuser bmadecomm_dev role/database; all seven Drizzle migrations applied. Existing identity settings were preserved and DATABASE_URL saved only in ignored .env.local.
- Actual HTTP/PostgreSQL/Edge verifier passed all nine groups, including browser registration, opening the actual private email link, fragment removal, deliberate activation, used/expired rejection, wrong-purpose rejection, rate limits, twelve independent database connections, held-lock expiry and transaction rollback. Private current-run report status is passed; public synthetic records are retained, generated isolated schema removed.
- Full suite: 94 tests passed in 23 files, one pre-existing todo-only file skipped; duration 54.31s. Lint passed with zero errors/three unchanged warnings, typecheck passed, production build passed after required Google Fonts network access, and whitespace checks passed.
- All matrix rows and acceptance criteria are covered by executed tests/live evidence. Review patches are recorded above. Complete 39-file inventory and operational commands are in docs/local-postgresql-verification.md.
- Credentials, raw email links, database binaries/data and private reports are excluded from Git and secret-bearing output. Browser uses a fresh headless Edge context without screenshots/traces or personal profile.
- Development full path is complete. Production/provider/privacy/residency activation, resend, login/sessions/reset and remaining F00-06 are not implemented or marked complete. No database/live check remains blocked.

## Verification

- `node node_modules/vitest/vitest.mjs run` — all tests pass.
- `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd run build` — pass.
- `npm.cmd run db:migrate:local`, `npm.cmd run identity:worker`, `npm.cmd run identity:verify:local` — actual local PostgreSQL/application/Sandbox checks pass, or exact blocked evidence recorded.
