---
title: 'E01-01 — Approved customer registration and scoped verification proofs'
type: feature
created: 2026-10-06
status: done
baseline_revision: a492664075e57b6fe8d7c892a26bbb0354d8e985
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: [oversized]
deferred:
  - summary: >-
      Independent-connection PostgreSQL concurrency evidence remains unavailable locally.
    evidence: |-
      No PostgreSQL or Docker executable/service/install was found and 127.0.0.1:5432 has no listener. PGlite tests pass but cannot prove independent connection interleavings; rerun concurrent registration/proof/throttle cases in an isolated external PostgreSQL test database before production readiness.
    location: >-
      src/test-utils/db.ts
    severity: medium
---

<intent-contract>

## Intent

**Problem:** E01-01 is partially implemented in the current working tree but lacks safe concurrent registration, a usable worker topic, proof consumption, rate limiting, adequate tests, and approved hashing compatible with long passwords.

**Approach:** Complete the existing registration implementation using shared transactions/API/outbox/email infrastructure. Implement only the verification-proof primitive needed from F00-06. The user's latest instruction explicitly approves 15–128-character passphrases, no composition rules, 24-hour single-use verification links, technical selection of hashing/proofs/rate limits, and sandbox-only development/testing. Continue the existing authorized partial story without discarding or committing pre-existing changes. No production launch is authorized.

## Boundaries & Constraints

**Always:** Required name/email/phone/password; strict writable-field allowlist; trimmed/lowercased email with DB uniqueness and normalized-email constraint; customer role only and null verifiedAt; generic identical status/body for new/duplicate email. Hash the complete password including Unicode (count Unicode code points, not UTF-16 units) without trimming or truncation. Use @node-rs/argon2 Argon2id v19 with 64 MiB, three passes, four lanes, fresh 16-byte random salt and 32-byte output (RFC9106 second recommended profile). Hash on both new and duplicate paths before transactions to reduce timing enumeration and avoid holding locks during KDF work. Random verification token is 32 random bytes/base64url; proof table stores SHA-256 only, scoped to user/purpose with exact 24-hour expiry and atomic consumedAt guard. Use crypto.randomUUID identifiers for new identity rows.

**Always:** Transactionally insert user via ON CONFLICT DO NOTHING/RETURNING, issue proof and enqueue email only for the winning insert. Store only AES-256-GCM encrypted token in outbox, bound to proof/user context using authenticated data; require a shared 32-byte base64 environment encryption key. No raw token, password or link in DB/logs/errors/client response. Resolve application URL from explicit server configuration, never attacker-controlled Host. Worker decrypts only in memory, sends through SandboxEmailAdapter via existing delivery dedupe/lease/retry infrastructure and sanitizes provider errors. Document/generate local secret setup without committing or printing secrets. Register a real runnable worker composition/entrypoint and npm script. Production registration/identity-worker behavior fails closed until later provider/privacy approval; build must still succeed.

**Always:** Registration throttle is shared DB-backed, atomic and bounded: 10 attempts per source bucket per 15 minutes and 3 per normalized email per hour, applied identically for existing/new email before hashing. Store hashed bucket keys. Do not trust forwarded IP headers by default; with no trusted proxy configured, use a conservative shared source bucket, document its multi-user limitation. Optional trusted single-IP header may only be explicitly configured and validated, with invalid/missing header falling back to shared source. Return 429 with Retry-After and no account disclosure. Fixed windows must reset correctly; accepted attempts against the source must be counted even if the email bucket rejects. Do not implement broad retention cleanup under this story.

**Always:** JSON body limit 8 KiB enforced against bytes actually streamed, not Content-Length alone; reject malformed JSON/content type/unknown fields; validate Origin when supplied; no-store API results and safe existing error envelope with request_id. Never log exception payloads on identity routes. Form uses shared schema and ApiClient for validation/field feedback, explicit labels, autocomplete, visible keyboard focus, pending duplicate-submit guard, accessible error/status announcements; preserve non-sensitive fields after failure and clear password after submission. Sandbox-only configuration is clearly documented.

**Never:** Implement login, sessions, password reset, verification page/endpoint or user verifiedAt mutation (E01-02); mark F00-06 fully complete; use bcrypt's 72-byte-truncating implementation; dispatch provider calls inside account transaction; add unrelated features or infer production/provider/privacy approval.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| New | Valid four fields | One unverified customer + hashed scoped 24-hour proof + encrypted outbox message atomically | Generic completion |
| Duplicate/race | Same normalized email including casing/space differences | One account/initial proof/email; identical public status/body; no mutation of existing account | No enumeration |
| Invalid | Bad/missing fields, privileged extra field, malformed/oversized JSON | No identity writes; safe field/HTTP feedback | Existing envelope, request_id, no-store |
| Rollback | Proof/enqueue failure | No partial user/proof/email | Safe failure |
| Proof use | Correct user/purpose and unexpired token | First consume succeeds exactly once, including races | Wrong scope/forged/expired/reused fail generically |
| Abuse | Source/email limit exceeded or concurrent attempts | Shared atomic bounded limit; window reset, Retry-After | Same 429 independent of account existence |
| Email | Worker processes registration event then retries | Sandbox receives valid verification link; durable delivery dedupe; outbox has no plaintext secret | Safe errors, no secret logs |
| Form | Invalid input, pending, backend field error, network failure, success | Shared validation, disabled submit, accessible feedback, preserved name/email/phone, password cleared, generic completion | Recoverable error state |

</intent-contract>

## Code Map

- `src/db/schema.ts`, `src/db/migrations/0005_customer_registration.sql` and meta files — uncommitted users/proof tables already present; complete constraints and add registration rate buckets. Keep metadata coherent through drizzle generation or a separate next migration if needed. Do not rewrite an applied migration without evidence; no DB migration apply against non-test DB without checking state.
- `src/modules/identity/contracts/registration.ts` — current schema strips unknown fields and counts UTF-16; fix strictness/normalization/code-point policy.
- `src/modules/identity/application/register.ts` — current check-then-insert races and calls infrastructure directly; replace with application ports + infrastructure composition while preserving use-case API if useful.
- `src/modules/identity/infrastructure/password.ts`, `proofs.ts` — current bcrypt + token generator; replace/adapt and add scoped atomic proof issuance/consumption and encryption.
- `src/app/api/v1/auth/register/route.ts` — incorrect relative import depth currently; implement bounded safe HTTP composition and throttling.
- `src/components/RegistrationForm.tsx`, `src/app/register/page.tsx` — partial form/page; complete integration/a11y without a new UI library.
- `src/shared/api/{errors,validation,client}.ts` — reuse error contract and safe field mapping; generic error handler logs raw exceptions, so identity route must sanitize unknown exceptions.
- `src/shared/outbox/{enqueue,worker}.ts`, `src/shared/email/{adapter,send-handler}.ts` — reusable transaction enqueue and deduplicating send; topic CustomerRegistered currently has no handler. Add identity verification-email handler and executable composition.
- `src/test-utils/db.ts`, `src/db/{index,tx,migrate}.ts` — PGlite migrations + isolated transaction harness; teardownTestDb imported by partial test does not exist. Fix identity tests only. Add real PostgreSQL integration evidence if local service available using an isolated temporary test schema and independent connections; never clear existing DB tables/data.
- `node_modules/next/dist/docs/01-app/01-getting-started/{15-route-handlers,05-server-and-client-components}.md` — already read; consult relevant local docs before code changes.
- `package.json` — replace story-introduced bcrypt deps with pinned @node-rs/argon2; add necessary verification/worker script only. Existing test runner is node node_modules/vitest/vitest.mjs run.

## Tasks & Acceptance

**Execution:**
- `src/db/schema.ts`, migration SQL/meta — coherent identity/proof/rate-limit schema and constraints.
- `src/modules/identity/contracts/registration.ts` — strict reusable validation.
- `src/modules/identity/application/register.ts` and infrastructure adapters — application ports, hash/proof/encryption/rate limiter, atomic registration composition.
- `src/modules/identity/infrastructure/verification-email.ts` and worker entrypoint — sandbox delivery of supported topic, generic exception sanitization, runnable CLI.
- `src/app/api/v1/auth/register/route.ts` — correct relative imports, bounded JSON safe API, throttle and production gate.
- `src/components/RegistrationForm.tsx`, `src/app/register/page.tsx` — complete shared validation/API-client form integration.
- Colocated unit/API/DB/component `.test.ts[x]` — executed coverage of every matrix row; frontend test routes fetch through actual POST handler to real test DB and Sandbox worker rather than a mocked success-only response. Password tests include 128 ASCII characters, long multibyte/astral characters and distinct suffixes beyond 72 bytes.
- `docs/customer-registration.md` — user policy approval, choices/source links, env/key setup, worker commands, all changed files, AC mapping and test results; production prerequisites and F00-06 partial status.

**Acceptance Criteria:**
- Given valid data, when the registration API accepts it, then exactly one unverified customer with customer role only and the approved Argon2id hash exists.
- Given an existing email or concurrent same-email attempts, when registration runs, then response matches new registration and no second user/proof/email appears.
- Given an account transaction, when proof/email write fails, then the user/proof/email all roll back; after commit the existing worker can dispatch its email through Sandbox.
- Given a scoped issued proof, when valid concurrent consumers run, then exactly one succeeds; expired/reused/forged/wrong-user/wrong-purpose cases fail identically, without marking the user verified.
- Given registration UI, when validation/submission succeeds or fails, then actual backend integration and accessible pending/error/generic completion behavior match the matrix.

## Spec Change Log

## Review Triage Log

### 2026-10-06 — Review pass
- verdicts: 24 findings — high 3, medium 11, low 3, false 7, maybe-false 0
- findings:
  - `[high]` `[patch]` Blind: identity worker drains unrelated topics — shared claimBatch and exhausted-lease handling lack topic filters; scope both operations to registered handlers and test untouched unrelated jobs.
  - `[medium]` `[patch]` Blind: expired/consumed proof email — handler checks ownership/purpose only; complete obsolete jobs without sending, with expiry/consumption tests.
  - `[medium]` `[patch]` Blind: setup overwrites APP_URL/EMAIL_ADAPTER — unconditional append changes parsed values; preserve existing settings.
  - `[medium]` `[patch]` Blind: setup key guard misses dotenv export/whitespace — regex misses valid existing assignments; parse dotenv and refuse every existing key assignment.
  - `[medium]` `[patch]` Blind: existing Unix file modes stay broad — write mode only affects file creation; apply 0600 on supported systems and test it.
  - `[medium]` `[patch]` Blind: equivalent IPv6 spellings create new buckets — isIP validates but does not canonicalize; canonicalize before hashing and test equivalent addresses.
  - `[medium]` `[patch]` Blind: keyboard focus is lost on completion and errors lack target — form removal leaves focus on body; focus first invalid input and completion heading, with tests.
  - `[low]` `[patch]` Blind: rollback asserts only missing user — FK excludes orphan proof but outbox has no FK and assertions do not cover all outputs; add before/after proof and event counts.
  - `[medium]` `[defer]` Blind: no executable independent PostgreSQL suite — test harness is pre-existing PGlite and external service is unavailable. Source intent allows reporting residual verification limitations; production readiness remains deferred, with evidence requirement recorded above.
  - `[false]` `[reject]` Blind: spec still in-progress — reviewer inspected a diff captured before review status update; current spec is in-review and finalization records final results, so pending text is workflow state rather than stale completed delivery.
  - `[medium]` `[patch]` Verification gap: source limit lacks HTTP-boundary regression — helper tests cannot catch a route using per-request source IDs; add trusted-source and shared-fallback endpoint exhaustion tests.
  - `[high]` `[patch]` Edge: unrelated-topic jobs lose retry budget — verified duplicate of blind worker finding, same topic-filter patch.
  - `[medium]` `[patch]` Edge: dotenv key replacement — verified duplicate of blind key-guard finding, same parsed-key refusal patch.
  - `[high]` `[patch]` Edge: lone UTF-16 surrogates collapse distinct passwords — reproduced native hash/verify of different unpaired surrogates returning true; reject malformed Unicode while retaining valid Unicode/passphrase policy.
  - `[medium]` `[patch]` Edge: inactive proofs are emailed — verified duplicate of blind obsolete-proof finding, same no-delivery patch.
  - `[medium]` `[patch]` Edge: never-ending body bypasses resource bound — boundedJson loops until EOF without deadline; bound read to 10 seconds, cancel timeout/abort, test safe timeout response.
  - `[false]` `[reject]` Intent: link-follow verification reading — E01-01 is explicitly scoped to registration/email; story catalog assigns verification page/endpoint to E01-02, so implementing that now would exceed the user's instruction to complete E01-01.
  - `[false]` `[reject]` Intent: inspectable development mailbox reading — user authorized technical selection and Sandbox; existing project SandboxEmailAdapter is intentionally in-memory. Tests inspect delivered messages and documentation states CLI count-only behavior; no mailbox was promised.
  - `[false]` `[reject]` Intent: grapheme interpretation — Unicode code-point count is documented consistently in policy/schema/tests; no grapheme requirement is present.
  - `[false]` `[reject]` Intent: PGlite does not establish independent PostgreSQL concurrency — report already explicitly disclaims that evidence and no production-readiness claim is made; the pre-existing verification limitation is recorded as the blind deferred finding.
  - `[false]` `[reject]` Intent: diff alone does not establish commands ran — root independently ran 64-test suite, lint/typecheck/build successfully; executed tool output supplies the evidence the static diff cannot.
  - `[false]` `[reject]` Intent: old/new spec contradiction — current spec expressly supersedes the pre-existing -2 assumptions; -2 remains historical and current review/finalization status is recorded on -3.
  - `[low]` `[patch]` Root: worker ignores DATABASE_URL in .env — Next loads .env.local and .env but CLI loads only .env.local; load both in precedence order and correct inaccurate migration loading instructions.
  - `[low]` `[patch]` Root: scoped IPv6 passes isIP but URL canonicalization throws — reproduced fe80::1%eth0; fall back to the shared bucket for zone-qualified values and add a regression assertion.

## Design Notes

The user's current policy approval supersedes older blocked specs and the assumptions in the partial -2 spec. Source: https://www.rfc-editor.org/rfc/rfc9106.html and https://github.com/napi-rs/node-rs/tree/main/packages/argon2. Production/privacy decisions remain deferred by explicit user instruction, not a local-development blocker. Partial working tree is this same authorized story, not unrelated work; continue it and retain old run reports as history. Record full canonical baseline. Do not stage or commit without necessary tool escalation; no commit requested.

## Verification

- `node node_modules/vitest/vitest.mjs run` — all non-todo tests pass; document unrelated todo tests separately.
- `npm run lint` — no errors.
- `npm run typecheck` — no errors.
- `npm run build` — succeeds, native dependency compatible, no DB/config access at build time.
- PostgreSQL independent-connection concurrent registration/proof/rate tests if local service is available; if unavailable report evidence limitation explicitly rather than treating PGlite as independent-connection PostgreSQL evidence.
- Matrix rows and story AC mapping to actual executed tests; inspect complete tracked/untracked diff.

## Auto Run Result

Status: done (authorized sandbox implementation).

Implemented atomic normalized customer registration, complete-password Argon2id hashing, hashed scoped 24-hour/single-use verification proofs, authenticated encrypted outbox events, safe sandbox worker dispatch, shared atomic rate limiting, safe bounded/timed HTTP adaptation, and accessible integrated form. Production composition fails closed. F00-06 remains partial; no login/session/reset or verification endpoint/page was implemented.

Changed files and one-line descriptions: see `docs/customer-registration.md`, which enumerates all 33 reviewed files including the preserved partial implementation and historical plan.

Root verification: full suite 76 passed, one pre-existing todo (17 passing files and one skipped todo-only file); all eight intent matrix rows covered by executed tests. Post-final-IPv6 correction: affected application suite 15 passed, lint zero errors/three existing warnings, typecheck passed, production build passed. Earlier targeted post-review suite: 34 passed across four files. `git diff --check` passed. No non-test migration or secret output occurred.

Review outcome: 24 findings, three high/11 medium/three low/seven false. All 16 patch rows fixed in 13 grouped patches (two high/eight medium/three low); their exact changes and regression evidence are documented in the triage log and customer-registration report. Seven rejected findings retain individual refutations. One pre-existing independent-PostgreSQL evidence limitation is deferred above. No unresolved implementation blockers remain for the authorized sandbox scope.

Follow-up review recommended: true, because high worker/topic-isolation fixes were made and independent PostgreSQL worker lease/claim and registration/proof/throttle interleavings remain unverified by the local PGlite environment. Production provider/privacy/residency decisions, trusted proxy topology, E01-02 link consumer and remaining F00-06 scope are explicit follow-ups, not silently completed requirements.
