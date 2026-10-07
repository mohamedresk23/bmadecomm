---
title: 'E02-01 — Admin login and admin shell'
type: feature
created: 2026-10-07
status: in-progress
route: dispatch
review_loop_iteration: 0
baseline_commit: 8179c2af8b19ae75aab2e500b86571fde1d47ff6
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/e02-authentication-contract-proposal.md'
  - '{project-root}/_bmad-output/implementation-artifacts/e02-permission-matrix-proposal.md'
---

<frozen-after-approval reason="explicit user approval of A1/v2 and binding clarifications on 2026-10-07">

## Intent

Finish real staff password+TOTP authentication, first-Owner activation, recovery and protected admin shell. Verify E02-01 independently before starting E02-02. Preserve the delivered database/session foundation and existing customer flows. All A1/v2 decisions are approved; do not ask again.

## Boundaries & Constraints

Always: actual hashed database sessions, enabled staff/MFA/live role checks, replay-safe TOTP via pinned otplib, encrypted seed with separate key, approved 30-minute idle/12-hour absolute lifetime, 15-minute sensitive freshness, protected cookies and session-bound CSRF/strict Origin, generic failures and nested error wrapper, immutable sanitized audit and durable security notifications. MFA failure budgets persist across challenges: five/account/15 minutes and twenty verification attempts/source/15 minutes plus five/challenge/5 minutes. Password login limit five account failures/15 minutes and twenty source attempts/15 minutes. Account/source counters commit outside failed identity transactions. Never clear buckets by opening another challenge.

Never: expose staff session after password alone or restricted recovery/enrollment; downgrade MFA; convert customers; create other staff or implement E02-03 UI; implement refunds, role management or E02-02 reference/media/RBAC integration now; invent provider/retention production approvals; print secrets. First-Owner CLI is deliberate and must not reset an already enrolled account. All lost factors/codes fail closed. WebAuthn excluded.

## I/O & Edge-Case Matrix

| Scenario | Input/state | Expected behavior | Failure |
|---|---|---|---|
| Login | Staff password then valid unused TOTP | Fresh cookie/session only after both proofs | Generic 401 |
| Invalid/customer/disabled | Wrong credentials, customer, inactive staff | No admin authority or usable challenge/session | Generic failure |
| Challenge abuse | Recreate challenges after MFA failures | Shared account/source budget still rejects | Safe 429 |
| Replay/race | Same OTP/recovery/setup proof concurrently | One accepted use; atomic state/audit | Other attempt denied |
| Bootstrap | No previously provisioned Owner, deliberate CLI | Private setup package, pending account, confirm TOTP/password before activation | No customer upgrade or existing-MFA reset |
| Recovery | Password+saved code or mailbox proof+saved code | Restricted <=5-minute rebind, prove new TOTP, fresh normal login | No admin session during recovery |
| Password/MFA change | Fresh required proofs | Revoke all sessions atomically; notify/audit | Old sessions/links invalid |
| Reauth/rotation | Password+new TOTP within valid session | New token/authentication timestamp; original absolute expiry retained | Old token rejected |
| Shell | Actual session and current roles | Minimal permitted navigation and no private data for invalid sessions | Safe sign-in/denial |
| CSRF | Missing/wrong Origin or CSRF token | No mutation/challenge takeover | Generic 403 |

</frozen-after-approval>

## Code Map

- `src/db/schema.ts`, migration 0007, staff-session/cookie contracts/services/tests: delivered foundation; preserve applied history and adapt fixtures for MFA as needed. Resolve time after lock waits, account then session/proof lock order consistently.
- `src/modules/identity/infrastructure/password.ts`: existing Argon2id; do not alter customer hashing. Add staff-only Unicode 15–128/common-password validation.
- `src/shared/api/bounded-json.ts`, errors/client: preserve bounded runtime schemas and nested errors, sanitize auth errors without logging payloads.
- `src/db/tx.ts`, `src/shared/authz/audit.ts`, shared outbox/email: transactional mutation/audit; extend existing private sandbox worker for staff reset/security messages without breaking customer verification. Never put plaintext MFA/session/recovery secrets in outbox; reset secrets encrypted, scoped and fragment links like existing verification.
- Installed Next authentication/cookies guides under `node_modules/next/dist/docs/`: read before writing adapters/UI; async cookies and authorization at every data read/entry point, no layout-only protection.
- `.local` local PostgreSQL, `scripts/local-database-config.ts`, existing browser verifier: reuse safe local-only checks and installed headless Edge. No secrets in artifacts/output.

## Tasks & Acceptance

- [x] Initial schema/session/cookie foundation and 0007 migration delivered; prior tests are historical only.
- [ ] `src/db/schema.ts`, new sequential migration/metadata: MFA enrollment/replay state, hashed scoped challenges/setup/recovery/reset proofs, recovery-code rows, shared authentication buckets, session MFA freshness, concurrency-safe first-Owner bootstrap guard. No business grants seeded in E02-01.
- [ ] Additive identity-revocation migration/services and tests: enforce approved session/proof invalidation for committed account disable, staff password/MFA replacement and new role assignment even when these changes occur through another database connection. No role-management endpoint/UI is added. Keep reductions live; new role grants revoke old sessions/proofs and require fresh login. Revocation triggers/guards must bind to the identity table's actual schema, work in isolated live tests, and preserve preexisting applied migrations. Update prior foundation expectations only to match this explicitly approved privilege-increase policy.
- [ ] `src/modules/identity/contracts/staff-auth.ts`, `application/staff-auth.ts`, infrastructure staff config/crypto/auth/throttle/notifications files: fully implement approved A1 and safe port/composition layering, atomic recovery/change/revoke-all and privacy. Config requires separate MFA key and configured origin; production transport HTTPS; unsupported production email recovery fails closed. Recovering both password and device uses mailbox proof+saved code once for restricted rebind, never normal session. Authentication generation/verification budgets cannot be reset through another operation.
- [ ] `scripts/provision-owner.ts`, setup helper and tests: bootstrap once, no user secret in console; private output with setup token, user/purpose bound and 15-minute lifetime. Safe reissue is allowed only for never-enrolled pending bootstrap Owner, never active/enrolled identities. Never overwrite existing keys/passwords/customers. No other staff creation.
- [ ] `/api/v1/admin/auth/[operation]/route.ts` or equivalently explicit adapter paths: login/MFA, enrollment, recovery, own password/reset/reauth/factor/code changes, current session and logout. Every mutation strict Origin/appropriate preauth or session CSRF, input schemas, no-store, safe request IDs/errors, no mock-header trust. Privileged recovery secrets appear only in dedicated restricted responses/private delivery.
- [ ] `/admin/login`, `/admin/enroll`, `/admin/recover`, `/admin/reset`, protected `/admin` and `/admin/security` pages/components: accessible real two-step login, first enrollment and own-security/recovery flows; proof fragments removed promptly; secrets only in component memory, never URLs/storage/logs. Login clears password after credential step; step requires real server challenge. Protected server reads check actual session; shell only links implemented destinations, with permission-filtered navigation helper for approved sections. No placeholder business screens or broken links.
- [ ] Colocated application/infrastructure/API/UI/CLI tests: cover every matrix row, actual sessions/DB/auth code paths (mocking transport/clock only as needed, not authentication), failure/replay/concurrency/rollback/security-code limits and no secret serialization. Provide `scripts/verify-local-staff-access.ts` for actual PostgreSQL+HTTP+installed-browser first Owner enrollment/login/recovery/reauth/invalid/customer/next-request revoke checks. Use dedicated local configuration, independent connections and isolated test data; do not touch preexisting identities/credentials or print proof/token values.
- [ ] `docs/staff-access.md`: setup/provision/worker/runbook, offline emergency-code custody, sensitive actions (refunds, grants, secrets, factors, code renewal), E02-03 integration contracts, production dependencies and fresh per-AC evidence.

Acceptance:
- Given a pending Owner, when setup/password/TOTP confirmation completes, then only one active staff identity is established and real normal login requires password+TOTP.
- Given a customer, invalid, disabled or expired/revoked identity, when requesting admin, then no protected data/session is returned.
- Given a valid staff session, when shell renders, then only permitted implemented sections are visible and protected server reads enforce identity.
- Given OTP/proof/code replay or concurrent changes, when evaluated, then single use and transaction rollback/revoke-all prevent resurrection or duplicate activation.
- Given regenerated MFA challenges, when cumulative account/source budgets are exceeded, then every challenge remains blocked.
- Given recovery/factor/password changes, when committed, then all old sessions are rejected and no MFA-free normal session is created.
- Given fresh reauthentication, when rotated, then MFA freshness updates and original absolute expiry is unchanged.

## Implementation Notes

User explicitly renegotiated and approved the complete intent on 2026-10-07. No further approval checkpoint is required. Read all approved companions, implement only E02-01 now and leave E02-02 code untouched. Parent performs full-story review and new live checks before E02-02. Historical foundation evidence: 102 tests/lint/typecheck/build and five PostgreSQL lifecycle groups passed, but none is evidence for the new workflows.

## Spec Change Log

- Approved continuation replaces earlier pending independent-stage limits with A1/v2. KEEP: existing customers, 0007 history, hash-only cookies/session tokens, expiry-after-lock correctness, private tooling, nested errors. Avoid known bad: authentication by mock header, challenge-reset bypass, stale roles, Owner recovery override, normal session before MFA.

## Review Triage Log

## Verification

Affected then full Vitest; lint; typecheck; build; apply only additive migrations on existing dedicated local PostgreSQL; run real staff-access verifier through actual HTTP and installed headless browser. Record every AC and matrix row with executed new evidence; fix failures. No production provider/retention compliance claim, no commit/push/deploy unless separately requested.
