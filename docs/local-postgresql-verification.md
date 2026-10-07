# Local PostgreSQL registration and activation

The approved development path now includes a deliberate email-verification submit. A scoped, unexpired, unused proof is consumed in the same database transaction that sets the customer's `verifiedAt`; any activation error rolls consumption back. Concurrent consumers get exactly one winner. Invalid, expired, forged, reused and wrong-scope proofs return the same generic failure. Registration keeps the approved 15–128 Unicode-code-point password policy and Argon2id parameters, normalized duplicate behavior and existing abuse limits. Verification adds a separate source bucket of 10 attempts per 15 minutes. Production identity behavior still fails closed. Resend, login, sessions, password reset and full F00-06 completion remain outside this work.

The application and worker share configuration precedence: existing process variables, ignored `.env.local`, then `.env`. Preserve the existing identity key; encrypted pending jobs need that key. The root setup provisions a dedicated `bmadecomm_dev` role/database in a real PostgreSQL cluster stored under ignored `.local/`, listening only on `127.0.0.1`. Add `DATABASE_URL` privately without putting its value in commands or terminal output. The migration command refuses production/test mode, a remote host, an unqualified role or a non-development database. Existing migrations are applied unchanged.

Run the server and checks from the repository root in PowerShell:

```powershell
npm.cmd run db:migrate:local
npm.cmd run dev
# In another terminal, after registering at http://127.0.0.1:3000/register:
npm.cmd run identity:worker
npm.cmd run identity:verify:local
```

`npm.cmd run dev` binds to `127.0.0.1`. For the verifier, configure `APP_URL=http://127.0.0.1:3000` and `IDENTITY_TRUSTED_IP_HEADER=x-local-verification-source` privately. This header is for the loopback development server only; do not expose that server or trust externally supplied source headers. The checker refuses a non-loopback application or missing trusted source header so repeat runs can use unique synthetic IPv6 source buckets without resetting existing limits. If starting a different server command, explicitly bind it to `127.0.0.1` as well.

The root-managed PostgreSQL 18.6 installation keeps binaries in `.local/postgresql/runtime/pgsql/bin` and cluster data in `.local/postgresql/data`. The official EDB 18.6-5 Windows archive was downloaded and only bin/lib/share extracted. Start and stop the existing cluster with these exact commands after initialization; do not run `initdb` against an existing data directory:

```powershell
& '.local/postgresql/runtime/pgsql/bin/pg_ctl.exe' -D '.local/postgresql/data' -l '.local/postgresql/server.log' -w start
& '.local/postgresql/runtime/pgsql/bin/pg_ctl.exe' -D '.local/postgresql/data' -m fast -w stop
```

Initialization used UTF8/locale C, SCRAM-SHA-256 authentication and checksums. Server configuration listens only on 127.0.0.1:5432 and uses UTC. The dedicated app role is a database owner with no superuser/createdb/createrole/replication privileges. Credentials were generated into private ignored files and the existing identity key was preserved. No command wipes an existing database. `.local/` and `.env.local` are ignored by Git, and `.local/` is excluded from lint/test/typecheck traversal. Source: [official PostgreSQL Windows distribution](https://www.postgresql.org/download/windows/) and [EDB binaries](https://www.enterprisedb.com/download-postgresql-binaries).

Root live evidence before the review revisions: `npm.cmd run db:migrate:local` applied all seven migrations successfully. A read-only query confirmed server 18.6, database/role bmadecomm_dev and listen_addresses 127.0.0.1. `npm.cmd run identity:verify:local` passed all six original groups: actual HTTP registration/normalized duplicate; private Sandbox email/GET non-mutation; activation and generic reuse/forgery/wrong-user/expiry rejection; source/email/verification throttles; independent PostgreSQL connection concurrency; and schema-isolated transaction rollback. Twelve distinct backend connections were asserted. Only that run's generated isolated schema was dropped; synthetic public users were retained for inspection. `npm.cmd run identity:worker` then processed ten pending messages; twelve private HTML messages were present at that check. No secrets or links were printed. These results establish the earlier six-group revision; the revised wrong-purpose/lock-delay/browser phases remain pending parent execution.

The first real registration probe exposed a pre-existing PGlite-only gap: raw SQL Date parameters in rate-window upserts caused postgres-js ERR_INVALID_ARG_TYPE. Dates now bind as explicit ISO timestamptz values; actual live duplicate/window/concurrency cases pass. This fixes the real development API rather than replacing PostgreSQL with a test substitute. The initial full test run after live verification caught a focus-effect timing race in a test assertion; the assertion now waits for the same required focus outcome.

The CLI worker writes escaped HTML messages under `.local/sandbox-mail/` with a SHA-256 filename derived from the delivery dedupe key. Files publish atomically with a stable dedupe winner and never replace an existing delivered message. Directories request mode 0700 and files 0600 where supported; Windows uses the user profile's filesystem ACLs. Inspect HTML files locally. There is no unauthenticated mailbox endpoint, public asset, real email provider, or secret console output. Links carry `user` and bearer `token` in the URL fragment, which browsers omit from HTTP requests/access-log query strings. The verification form removes the fragment before any submission, retains the proof only in component memory, makes no automatic request and requires pressing **Verify email**. Missing/invalid links, success, temporary failures and accessible focus/status behavior are covered by tests.

`identity:verify:local` exercises real HTTP registration/normalized duplicate/activation/GET safety/reuse/forgery/expiry/source and email throttles, verifies PostgreSQL writes and the private Sandbox link, and checks the password hash. It generates synthetic `example.test` customers and unique source buckets; it changes public proof expiry only for its own exact generated synthetic users. The wrong-purpose HTTP check inserts a separate synthetic password-reset proof for its own generated account, rejects it generically and asserts unchanged account/proof. Public synthetic records remain for inspection. The script also creates one schema named `e01_verify_` plus its own 32-hex run ID, copies the current identity/outbox/rate-table structure, opens 12 independent PostgreSQL connections and checks unique registration, single-winner activation, email/source/verification throttle limits and trigger-injected proof/outbox/account-update rollback. Held account and proof locks explicitly block a verification connection until its proof expires, then assert rejection without consumption/activation. Cleanup checks the exact generated schema and prefix before dropping only that schema. Existing customers, other databases and existing buckets are never reset.

The same command now launches the installed Microsoft Edge channel headlessly using pinned `playwright-core` 1.63.0. It downloads no browser, opens no visible window, creates a fresh profile/context, and records no screenshots, videos, traces or secret exception output. It fills the actual registration form, opens and clicks the actual private Sandbox HTML email link, asserts fragment removal and GET non-mutation, deliberately confirms verification, checks persisted matching timestamps, and covers used/expired-link UI. Existing Edge policies may prevent launching; a launch failure records a failed stage and never counts as completion. This follows Playwright's [installed Chrome/Edge guidance](https://playwright.dev/docs/browsers#google-chrome--microsoft-edge) and [launch API](https://playwright.dev/docs/api/class-browsertype#browser-type-launch). Parent executes this phase with the required browser-process escalation.

The private `.local/registration-verification-report.json` is replaced with the current run ID, start time and `running` status before any configuration/database/browser check. Completion writes `passed` or `failed`, completion time, safe check labels/count and a safe failed stage. An interrupted run remains `running`, so a previous passed report cannot appear to describe a failed rerun. Credentials, emails and token links never enter that report or console output.

Implementation changes cover the shared bounded-JSON request helper; verify contract/application/database composition; POST route, page and confirmation form; fragment email builder/private file adapter; local migration guard/entrypoint and Drizzle dotenv precedence; real PostgreSQL verifier; and colocated API, transaction, form, file-delivery and local-config regressions. No schema or applied migration regeneration was needed.

Historical implementation-agent evidence before review revisions: 85 tests passed in 22 files, with one pre-existing todo-only suite skipped. After review revisions, affected verification application/API/form suites passed 15 tests and the report lifecycle test passed. Verification now locks account then proof consistently, returns controlled rejection for already verified/non-customer accounts and uses fresh `clock_timestamp()` after both lock waits for expiry and identical consumption/activation timestamps. The form aborts after twenty seconds or unmount, restores retry with its proof still only in memory, and instructs remounted/missing-proof users to reopen the original email link. Actual fetch-to-POST/PGlite form tests cover network/500/429 recovery, duplicate-submit prevention, timeout/retry, remount guidance, accessible feedback and used/expired links.

## Final executed results

The parent ran `npm.cmd run identity:verify:local` after all fixes: **all nine groups passed**, including headless Edge registration, actual private email-link click, fragment removal, deliberate confirmation and persisted activation, used/expired UI rejection, wrong-purpose HTTP rejection, twelve independent PostgreSQL connections, account/proof lock-delay expiry and rollback. The current private report records `status: passed` with run ID and start/completion timestamps; no credentials, emails or links are included. The first browser revision correctly rejected the used link but its test text lookup also matched Next's route-announcer alert; the filtered product-alert locator fixed the harness without relaxing behavior. The final browser ran to completion and closed its ephemeral context.

| Check | Final result |
| --- | --- |
| Local PostgreSQL/role/database/secret configuration | Verified 18.6, loopback-only, dedicated development database and non-superuser role; ignored private settings |
| Drizzle migration application | Seven migrations applied successfully |
| Actual HTTP + PostgreSQL + headless Edge full path | Nine groups passed |
| Full Vitest suite | 94 passed in 23 files, one pre-existing todo-only file skipped; 54.31 seconds |
| Lint | Passed; zero errors, three unchanged Upload/authz warnings |
| Typecheck | Passed |
| Production build | Passed, including registration and verification routes; required network escalation for existing Google Fonts |
| Review | All 16 findings fixed; none deferred or rejected |
| Whitespace and Git private-artifact exclusions | Passed |

E01-01 development completion is now supported by the complete real path, not merely isolated tests. No local database/live check remains blocked. Production email/provider/privacy/residency, resend and remaining F00-06 remain explicitly incomplete. Public synthetic accounts are retained for inspection. To try your own account, open http://127.0.0.1:3000/register, run `npm.cmd run identity:worker` after registering, open its private HTML message in `.local/sandbox-mail/` and click the link followed by **Verify email**. Refresh after fragment removal requires reopening the original email link; no bearer secret is stored in browser storage.

## Changed files

All 39 versioned files in this change are listed below; private runtime/config/mail/report files remain ignored.

| File | Change |
| --- | --- |
| `.gitignore` | Exclude private local runtime artifacts |
| `README.md` | Correct loopback URL and link setup instructions |
| `_bmad-output/implementation-artifacts/spec-e01-local-postgresql-full-verification.md` | Approved full-path plan, acceptance results and review triage |
| `_bmad-output/implementation-artifacts/bmad-build-auto-result-e01-01-customer-registration-with-verification-email.md` | Qualify history and record actual completion |
| `docs/customer-registration.md` | Point historical sandbox scope to current evidence |
| `docs/local-postgresql-verification.md` | Exact setup/lifecycle commands and all final results |
| `drizzle.config.ts` | Load private local configuration and remove implicit credentials |
| `eslint.config.mjs` | Ignore private runtime files |
| `package.json` | Loopback dev, migration/live-check commands and pinned browser driver |
| `package-lock.json` | Lock playwright-core 1.63.0 |
| `scripts/identity-worker.ts` | Persist inspectable private Sandbox messages |
| `scripts/local-database-config.ts` | Guard dedicated loopback development database |
| `scripts/local-database-config.test.ts` | Local migration guard regressions |
| `scripts/migrate-local.ts` | Safe private-config migration command |
| `scripts/verification-report.ts` | Atomic current-run evidence lifecycle |
| `scripts/verification-report.test.ts` | Replace stale success with running/failed state |
| `scripts/verify-local-browser.ts` | Installed headless Edge full user flow |
| `scripts/verify-local-registration.ts` | Real HTTP/database/concurrency/lock/rollback checks |
| `src/app/api/v1/auth/register/route.ts` | Reuse shared bounded body helper |
| `src/app/api/v1/auth/verify/route.ts` | Safe bounded, throttled verification endpoint |
| `src/app/api/v1/auth/verify/route.test.ts` | Endpoint success/rejection/state/abuse coverage |
| `src/app/verify-email/page.tsx` | Confirmation page and private referrer metadata |
| `src/components/RegistrationForm.test.tsx` | Fragment link assertion and awaited focus |
| `src/components/VerificationForm.tsx` | Deliberate confirmation, secret removal, abort/retry and guidance |
| `src/components/VerificationForm.test.tsx` | Actual API/database integration and recoverable states |
| `src/db/migrate.ts` | Suppress secret-bearing migration exceptions |
| `src/modules/identity/application/register.test.ts` | Verify fragment email format |
| `src/modules/identity/application/verify.ts` | Verification application port |
| `src/modules/identity/application/verify.test.ts` | Transaction, account state, scope and rollback coverage |
| `src/modules/identity/contracts/verification.ts` | Strict proof DTO and generic failure text |
| `src/modules/identity/infrastructure/rate-limit.ts` | Real PostgreSQL timestamp bindings and verification source limit |
| `src/modules/identity/infrastructure/verification-email.ts` | Fragment-only email link |
| `src/modules/identity/infrastructure/verification.ts` | Ordered locks, fresh database clock and atomic activation |
| `src/modules/identity/infrastructure/worker.ts` | Allow private file Sandbox adapter composition |
| `src/shared/api/bounded-json.ts` | Shared byte/deadline/abort request boundary |
| `src/shared/email/file-sandbox-adapter.ts` | Escaped private atomic/deduplicated HTML delivery |
| `src/shared/email/file-sandbox-adapter.test.ts` | Safe private-file and dedupe regression |
| `tsconfig.json` | Exclude private operational code/data |
| `vitest.config.mts` | Preserve test defaults while excluding private artifacts |
