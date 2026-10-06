# Sandbox customer registration (E01-01)

**2026-10-06 local activation extension:** The explicitly approved [local PostgreSQL verification work](local-postgresql-verification.md) adds the verification consumer/page, fragment links, inspectable private CLI Sandbox email, and guarded dotenv-aware migration/live checks. Root applied real PostgreSQL migrations and passed the six original HTTP/database check groups, including twelve independent connections. Subsequent review revisions add lock-safe expiry, generic invalid-account rejection, timeout/recovery UI, wrong-purpose proof and real headless Edge checks; final revised full/browser/live results remain pending parent execution. Historical evidence below describes the prior sandbox-only story; its earlier verification-consumer exclusion, in-memory-only CLI and missing-PostgreSQL statements are superseded. Resend, full F00-06 and production remain incomplete.

The approved policy is a 15–128 Unicode-code-point passphrase, with no composition rules, trimming or truncation. All four fields (name, email, phone, password) are required. Email is trimmed and lowercased, with a database uniqueness constraint and normalized-email check. Extra writable fields are rejected. New and existing emails receive the same 200 response and generic completion message; existing accounts are never changed. This implementation continues and preserves the authorized partial story from baseline `a492664075e57b6fe8d7c892a26bbb0354d8e985`. Finalization records all reviewed story files in a local Git commit without pushing, as required by the invoked build-auto workflow.

Password hashing uses pinned `@node-rs/argon2` 2.2.2, Argon2id v19, 64 MiB, three passes, four lanes, a fresh 16-byte salt, and a 32-byte result. Both new and duplicate paths hash the entire password before taking transaction locks. The profile is RFC 9106's second recommendation: [RFC 9106](https://www.rfc-editor.org/rfc/rfc9106.html). Native implementation: [node-rs Argon2](https://github.com/napi-rs/node-rs/tree/main/packages/argon2).

An atomic `ON CONFLICT DO NOTHING RETURNING` insert wins the account race. Only the winner issues a proof and enqueues `CustomerRegistered`, all inside the same transaction. User and proof identifiers use `crypto.randomUUID()`. Proofs contain only the SHA-256 hash of a fresh 32-random-byte base64url token, a user/purpose scope, and exactly 24 hours between creation and expiry. The consumption primitive performs one guarded update requiring matching token hash, user and purpose, a future expiry, and null `consumedAt`. It changes no user verification state. This is the scoped part of F00-06 needed by E01-01; F00-06 is **not fully complete**.

Outbox payloads contain user/proof UUIDs and AES-256-GCM ciphertext only. Authenticated data binds the ciphertext to the user, proof, and verification purpose. Passwords, plaintext tokens and links are never persisted in identity tables/outbox, API responses or logs. The worker decrypts into memory and delivers through `SandboxEmailAdapter` and the shared outbox lease/retry and email delivery deduplication infrastructure. Provider failures are replaced with a fixed safe error before the worker persists them. Sandbox delivery remains in the adapter's in-memory `sent` collection; the CLI prints only the processed count. No live provider sends occur.

The configured application origin constructs email links; request Host never determines that origin. `/verify-email` is the link target reserved for E01-02. This story does not implement a verification endpoint/page, login, sessions, password reset, or account verification mutation.

## Local configuration and commands

Run `npm run identity:setup` once to generate a fresh 32-byte base64 `IDENTITY_TOKEN_KEY` in ignored `.env.local`. The command does not print the key and uses dotenv parsing to refuse replacing any present key, including exported/spaced/empty assignments. Existing `EMAIL_ADAPTER` and `APP_URL` settings are preserved; missing settings default to `sandbox` and `http://localhost:3000`. Keep the same key for the application and worker and retain it while encrypted jobs are pending. `.env.local` is ignored by Git; no project secret was generated or committed during implementation. New and existing setup files receive mode 0600 on systems honoring Unix modes; on Windows protect the file with the normal user-profile filesystem ACLs.

Set `DATABASE_URL` to an explicitly selected **disposable local sandbox PostgreSQL database**, inspect its migration state, and apply migrations only after confirming the database is disposable. No non-test database was migrated during this work. Migration 0005 is preserved; generated migration 0006 adds normalized-email/rate-bucket constraints and the rate table with coherent snapshot/journal metadata. The project's Drizzle migrator (`npx tsx src/db/migrate.ts`) does not load dotenv files; explicitly set `DATABASE_URL` in the process environment when invoking it. Never point these commands at production.

- `npm run dev` starts the local registration form at `/register`.
- `npm run identity:worker` loads `.env.local` then `.env` without replacing existing process variables, then imports the database and runs one runnable worker cycle. Application/worker configuration precedence matches process environment, `.env.local`, then `.env`; keep `DATABASE_URL` consistent in those settings. Invoke again to process due retries or newly registered accounts. It exposes no secret-bearing output and sends only to the in-memory sandbox adapter.
- `node node_modules/vitest/vitest.mjs run` runs all tests using isolated in-memory PGlite databases. No external database connection or credentials are needed.
- `npm run lint`, `npm run typecheck`, and `npm run build` verify the application.

Registration and worker composition fail closed for `NODE_ENV=production`, a non-sandbox adapter, a missing/invalid encryption key, or invalid application URL configuration. Build succeeds without DB connections or identity secret setup. Production activation remains deferred until provider/privacy approval and a later implementation explicitly permits it.

## Abuse and HTTP boundaries

Atomic fixed-window DB buckets allow 10 accepted attempts per source in 15 minutes and three per normalized email in one hour, before hashing and regardless of account existence. Only SHA-256 bucket keys are stored. Counters are bounded; a newer window resets the counter, and older requests cannot move a bucket backward. Accepted source attempts remain counted when the email bucket rejects. Rejections return a generic 429, `Retry-After`, the shared error envelope, and a request ID. No broad retention cleanup is included in this story.

Without `IDENTITY_TRUSTED_IP_HEADER`, every client uses a conservative shared source bucket; neither `Forwarded` nor `X-Forwarded-For` is trusted. This deliberately limits the entire local deployment to 10 attempts per 15 minutes and can reject unrelated users. Optional `IDENTITY_TRUSTED_IP_HEADER` must name a lowercase header whose value is a single valid IP address. Only configure it behind a proxy that overwrites the header and blocks direct/untrusted access. Missing, invalid, or comma-separated values fall back to the shared bucket.

The route enforces 8 KiB against actual streamed bytes, regardless of Content-Length, and a ten-second total body-reading deadline. Timeout returns safe 408; timeout/request abort cancel and release the reader. It checks JSON content type and supplied Origin, rejects malformed JSON/unknown fields, and always emits `Cache-Control: no-store`. Unknown exceptions receive a fixed internal error without logging payloads. The form validates the shared schema and uses `ApiClient` for actual requests and field mapping, provides explicit labels/autocomplete/focus styles/error/status announcements, guards pending duplicate submission, preserves name/email/phone after failures, and clears the password on every submission. It focuses the first invalid field and the completion heading for keyboard users.

## Acceptance evidence

| Matrix / acceptance item | Executed evidence |
| --- | --- |
| Valid customer with approved hash; full Unicode/128-character passwords and suffixes past 72 bytes | `src/modules/identity/application/register.test.ts`: strict schema, long ASCII/multibyte/astral KDF verification, PHC parameter/salt/output checks; new customer integration |
| Duplicate and normalized email race; same status/body; one account/proof/email | Application concurrent registration test and `src/app/api/v1/auth/register/route.test.ts` normalized duplicate integration |
| Transaction rollback on proof or enqueue failure | Real PGlite trigger-injected proof/outbox failures with rollback assertions |
| Scope, expiry, forgery, reuse and concurrent single consumption; no user mutation | Application scoped proof and concurrent guarded update tests |
| Sandbox email, delivery dedupe and safe retry | Real shared worker/email handler tests with sandbox delivery, duplicate delivery invocation and injected provider exception |
| Atomic source/email throttles and fixed-window reset | Concurrent DB rate tests, bounded hashed rows, source counting on email rejection, header trust and HTTP 429/Retry-After tests |
| Malformed/oversized/invalid content/unknown fields/Origin and safe errors | Actual route tests including streamed multibyte body with false Content-Length, production/config gate, sanitized thrown error and no logging |
| Form validation, pending/duplicate submit, field/network failure, generic success | `src/components/RegistrationForm.test.tsx`: actual POST handler/PGlite/Sandbox worker fetch bridge and accessible states with password clearing/non-sensitive preservation |

Initial targeted verification passed 22 tests (12 application/infrastructure, six API, four form). Lint passed with zero errors and three pre-existing warnings in Upload/authz tests. Typecheck passed. Production build passed with the native Argon2 dependency and `/register` plus `/api/v1/auth/register` routes.

The first unrestricted full suite exhausted host memory while spawning many independent PGlite WASM databases. `vitest.config.mts` bounds workers to one so the required plain command remains usable. Before review fixes, the plain command passed 64 tests in 16 files, with one unrelated todo (`src/shared/outbox/outbox.test.ts`); Vitest reports that todo-only file as skipped. Those counts describe the earlier implementation, not the final revised tree.

## Review fixes and final verification

Review fixes isolate supported outbox topics (including exhausted leases), complete obsolete consumed/expired proofs without delivery, preserve parsed dotenv settings and private setup-file modes, canonicalize equivalent IPv6 sources, reject malformed UTF-16 passwords without changing approved length/composition policy, bound body-reading time and abort cleanup, add accessible focus targets, strengthen rollback assertions, and test actual API source exhaustion/shared-header fallback. The worker loads both local dotenv files before database creation. Regression tests use isolated temporary files and do not print secret material.

Targeted post-review command `node node_modules/vitest/vitest.mjs run scripts/setup-identity.test.ts src/modules/identity/application/register.test.ts src/app/api/v1/auth/register/route.test.ts src/components/RegistrationForm.test.tsx` passed 34 tests in four files. The parent independently ran the full suite: **76 passed in 17 files, one pre-existing todo-only file skipped**, zero failures (69.64 seconds). All 34 story tests passed. After the final scoped-IPv6 fallback assertion, the affected application suite passed all 15 tests again; lint, typecheck and production build were rerun and passed. Lint has zero errors and three unchanged warnings in Upload/authz files. On Windows, `npm.cmd` was used because PowerShell blocks the unsigned npm.ps1 shim; no execution policy was changed.

All E01-01 acceptance criteria are verified for the authorized sandbox scope: one unverified customer/customer-only role with approved complete-password hash; normalized duplicates and racing inserts produce one account and the identical public response; proof and encrypted email event commit with the account or all roll back; actual form/API/test-database/Sandbox-worker integration passes. Scoped proofs additionally pass expiry, purpose, subject, forgery, reuse and concurrent single-consumption cases. There are no unresolved implementation blockers for this scope.

Four review lenses reported 22 findings; parent inspection added two. Triage recorded 24 findings (three high, 11 medium, three low, seven false). Sixteen patch findings grouped into 13 fixes (two high, eight medium, three low) were fixed and covered by executed regressions. Seven rejected findings have specific refutations in the current story spec. One pre-existing verification limitation, independent PostgreSQL connections, is deferred. Follow-up review is recommended for PostgreSQL worker-topic isolation/lease and registration/proof/throttle concurrency before production readiness. Sandbox CLI messages remain in memory; there is no developer mailbox UI. The default shared source bucket can throttle unrelated local clients until trusted proxy configuration is deliberately supplied.

Independent-connection PostgreSQL evidence is unavailable: there is no PostgreSQL/Docker executable or service/local installation, and no listener at `127.0.0.1:5432`. PGlite concurrent-query tests validate SQL and application behavior but do not prove independent PostgreSQL-connection interleavings. This remains an explicit evidence limitation.

## Files in this completed story

| File | Change |
| --- | --- |
| `package.json` | Pinned Argon2 and local setup/worker commands |
| `package-lock.json` | Reproducible native Argon2 dependency lock |
| `vitest.config.mts` | Bound PGlite worker memory use |
| `scripts/setup-identity.ts` | Preserve local settings and generate private key |
| `scripts/setup-identity.test.ts` | Isolated setup/refusal/settings regressions |
| `scripts/identity-worker.ts` | Runnable sandbox cycle with matching dotenv precedence |
| `src/db/schema.ts` | Users, proofs, normalization and rate buckets |
| `src/db/migrations/0005_customer_registration.sql` | Preserve partial identity-table migration |
| `src/db/migrations/0006_dazzling_warbound.sql` | Rate table and normalized-email constraint |
| `src/db/migrations/meta/0005_snapshot.json` | Preserved initial identity snapshot |
| `src/db/migrations/meta/0006_snapshot.json` | Coherent final schema snapshot |
| `src/db/migrations/meta/_journal.json` | Register both migrations |
| `src/modules/identity/contracts/registration.ts` | Strict normalized DTO/Unicode/password policy |
| `src/modules/identity/application/register.ts` | Registration use case and ports |
| `src/modules/identity/application/register.test.ts` | KDF/transaction/proof/worker/throttle coverage |
| `src/modules/identity/infrastructure/password.ts` | Argon2id adapter |
| `src/modules/identity/infrastructure/proofs.ts` | Scoped issuance and atomic single-use consumption |
| `src/modules/identity/infrastructure/config.ts` | Fail-closed sandbox configuration |
| `src/modules/identity/infrastructure/token-encryption.ts` | Authenticated encrypted outbox tokens |
| `src/modules/identity/infrastructure/registration.ts` | Atomic database/outbox composition |
| `src/modules/identity/infrastructure/rate-limit.ts` | Atomic shared throttling and canonical source keys |
| `src/modules/identity/infrastructure/verification-email.ts` | Safe deduplicated sandbox dispatch |
| `src/modules/identity/infrastructure/worker.ts` | Identity worker composition |
| `src/shared/outbox/worker.ts` | Restrict claims and expired leases to supported topics |
| `src/app/api/v1/auth/register/route.ts` | Safe bounded, timed, throttled registration API |
| `src/app/api/v1/auth/register/route.test.ts` | Actual API regressions |
| `src/components/RegistrationForm.tsx` | Accessible validated form integrated with ApiClient |
| `src/components/RegistrationForm.test.tsx` | Form/API/PGlite/Sandbox and focus integration |
| `src/app/register/page.tsx` | Registration page from partial implementation |
| `docs/customer-registration.md` | Decisions, setup, evidence, full inventory and risks |
| `_bmad-output/implementation-artifacts/spec-e01-01-customer-registration-with-verification-email-2.md` | Preserve superseded partial plan as history |
| `_bmad-output/implementation-artifacts/spec-e01-01-customer-registration-with-verification-email-3.md` | Approved final plan, review triage and completion |
| `_bmad-output/implementation-artifacts/bmad-build-auto-result-e01-01-customer-registration-with-verification-email.md` | Append current successful run to historical blockers |

Shared API/email/transaction infrastructure is reused without unrelated behavior changes. No non-test database migration, real email send or production activation occurred.
