---
title: 'E02 staff authentication contract proposal A1'
status: approved
created: 2026-10-07
approval: explicit-user-approval-2026-10-07
---

# Staff authentication contract A1 — approved, implementation in progress

The user explicitly approved A1 and matrix v2 on 2026-10-07. Preserve the delivered staff-session foundation. Finish and verify E02-01 before starting E02-02. The binding clarifications below supplement the reviewed contract; historical proposal rationale remains for traceability, not unresolved approval.

## Binding approval clarifications

- Password+TOTP applies to all staff; WebAuthn is excluded. Approved lifetimes/recovery/throttles are now runtime requirements.
- MFA failures accumulate across regenerated challenges: five failures/account/15 minutes and twenty verification attempts/trusted source/15 minutes, plus five failures per five-minute challenge. Creating a challenge never resets a bucket. Full successful MFA authentication may reset only the account failure state, not source budgets.
- Refunds, role grants, secret management, factor changes and recovery-code regeneration require password+MFA verification within 15 minutes; factor/codes replacement additionally requires fresh proof in its own operation.
- Preserve absolute 12-hour expiry on rotation; test revoke-all, concurrent changes and next-request revocation.
- Only first Owner provisioning is implemented here; creating other staff remains E02-03. Factor/recovery/password/session security primitives and self-service own-account flows are within this approved dependency work.
- Document offline emergency-code custody before production. No fallback disables MFA when all factors/codes are lost.
- Staff role increases revoke sessions; reductions enforce current grants. refund_operator additionally requires current Owner/Manager and orders.read, never its own cached role alone.

## Existing authority and scope

FR-02 requires email/password, inactive-account rejection, generic failure, logout revocation and customer/admin isolation. FR-04 requires scoped single-use password-reset proof, generic request response and revocation of previous sessions on successful reset. FR-06 requires Owner-only staff creation/disable/grants, next-request revocation and last-active-Owner protection. FR-07 requires default-deny action/resource/field controls. FR-45 and AD-15 require redacted immutable mutation audit. AD-9/16 require hashed opaque server sessions, protected cookies, Origin/CSRF, live grants and shared DB-backed throttles.

A-09 is explicitly an assumption: 15–128-character passphrases, password-reset proof 30 minutes, admin inactivity 30 minutes, absolute lifetime 12 hours, sensitive reauthentication within 15 minutes, admin MFA and recovery runbooks. OQ-06 owns approval of these security choices; OQ-08 owns grants and responsible operators. Earlier customer-sandbox password policy approval is not silently extended to an entire staff lifecycle.

Staff lifecycle management UI and last-Owner mutations remain E02-03. E02-01 provides login/enrollment/recovery/session/security primitives and first-Owner provisioning, not the full staff-management feature. Do not implement customer login/reset, general invitations, customer conversion or unrelated business endpoints.

## Recommended decisions and reasons

| Decision | Existing requirement | Proposed contract | Reason |
|---|---|---|---|
| Staff login | FR-02: email/password and separate staff access | `/admin/login`, normalized email + full password, then TOTP; only after both proofs succeeds may a normal staff session be issued. Generic credential/MFA errors; no secret in URL/storage/logs | Preserves product login convention and prevents password-only admin access |
| Account creation | FR-06: Owner creates staff; E02-01 first Owner script | Bootstrap script only when no Owner exists; create a separate staff identity, never upgrade a customer. Deliver a one-time setup secret privately through the operator-controlled handover, not a public registration/invitation feature. Later staff creation is Owner-authenticated E02-03 | Makes initial provisioning deliberate and limits scope |
| Initial activation | MFA needed before admin access; method unresolved | Pending-MFA account cannot access administration. Setup proof: 256-bit random, hashed, user/purpose bound, single use, 15-minute expiry. Restricted enrollment context only; choose password and confirm newly generated TOTP before activating. Confirmation is atomic and cannot be rerun to replace an existing factor | Initial enrollment is not password-only login or an MFA-reset backdoor |
| Password policy | A-09 proposed lengths; current Argon2id code | 15–128 Unicode code points, no composition rules, allow managers/paste; reuse Argon2id 64 MiB/3 iterations/parallelism 4 with per-password random salt. Check a maintained local common/compromised-password blocklist for new staff passwords; do not normalize or migrate existing customer hashes in this work | Reuses current implementation, avoids weak new passwords and preserves compatibility |
| MFA method and population | Story requires approved MFA; A-09 proposes it for administration | TOTP for Owner, Manager, Warehouse, Support and Marketing; no exemptions/remembered-device bypass. Use server-side otplib with pinned reviewed version and test vectors; 32-byte random seed, 6 digits, 30-second period, at most previous/current/next step. Atomically accept a time step only once per account | Operates without SMS/email OTP service and keeps replay/guessing controls explicit; TOTP is not phishing-resistant |
| MFA secret storage | AD-9/16 server-only secrets | AES-256-GCM encrypted seed with separate configured server key and account/purpose binding; enrollment QR/seed shown only in restricted no-store enrollment. Seed never in ordinary DTO/audit/logs | The verifier needs the seed; hashing alone cannot support TOTP |
| MFA change | Existing authentication/reauth security boundary | Current password + current enrolled TOTP, not a session alone. Confirm the new seed before atomically replacing old factor, invalidating old recovery codes and all sessions; require fresh login afterward; notify independently through durable transactional delivery | A stolen browser session cannot silently replace the factor |
| Recovery codes | A-09 proposes recovery codes/runbook; format undecided | Ten independently generated 128-bit codes, displayed once and stored only as hashes. Generation/renewal needs fresh password+TOTP; replacement invalidates the old set. Store a protected offline emergency copy separately | Gives a possession-based fallback with sufficient entropy and controlled lifecycle |
| Lost TOTP | No MFA bypass permitted | Require password + one unused recovery code; consume it atomically and grant only a five-minute, one-use factor-rebinding context. Revoke existing staff sessions, enroll and prove a new TOTP, replace recovery-code set, then require a fresh password+new-TOTP login. No administrative access during recovery | Two independent proofs remain required; recovery never turns into password-only access |
| Lost password | FR-04 scoped reset/revoke and A-09 proposed 30 minutes | Generic reset request and random one-use 30-minute proof delivered via approved transactional channel. Before a staff reset completes, also require current TOTP or one unused recovery code. Revoke all sessions and outstanding reset proofs atomically; no automatic login and no MFA removal | Mailbox possession alone does not become administrative authentication |
| All recovery material lost | Owner recovery must be documented; identity-proofing process not specified | Fail closed if neither enrolled factor nor saved recovery code remains. No Owner override, email/SMS-only login, security questions or CLI reset of an existing factor. Retain sealed emergency codes before production. Any later identity-proofed recovery process needs its own reviewed approval | Avoids silently introducing an MFA bypass; explicit availability tradeoff |
| Session lifetimes | A-09 proposed 30-minute idle/12-hour absolute | Adopt those limits for staff, server enforced. Approved sensitive actions require password+MFA proof no older than 15 minutes; factor changes/recovery-code regeneration require a fresh proof in that operation. No remember-me extension | Aligns proposed product policy with a bounded administrative session |
| Session rotation | AD-9 requires rotate/revoke; current core preserves absolute expiry | Fresh token after full login and successful reauthentication; rotate within the existing session without extending its original absolute deadline. No grace acceptance of old tokens; serialize rotation, handle read retry safely without retrying writes automatically. No scheduled rotation in this version | Reuses tested core, reduces fixation risk and avoids overlapping bearer-token ambiguity |
| Revocation and role changes | FR-04/06 next request and reset revoke | Logout revokes current session. Disable, password change/reset, MFA replacement/recovery revoke all staff sessions in the same transaction as the successful change. Reductions immediately remove live grants; increases revoke all sessions and require fresh password+MFA. Remaining independently granted roles stay usable after reduction | No stale privilege cache or privilege elevation of a previously authenticated stolen session |
| Request protection | AD-16 and existing nested error contract | HTTPS deployment; Secure/HttpOnly host-only staff cookie; no token in browser storage. State-changing adapters require exact configured Origin and session-bound CSRF proof; pending login/enrollment challenges are scoped and provide no admin authority. Preserve `{error:{...}}` | Sessions and MFA do not replace cross-site request protections |

TOTP is the recommended minimal implementation for this stage, not a claim of complete NIST AAL2 compliance. NIST AAL2 additionally requires offering a phishing-resistant option. WebAuthn with required user verification is the stronger alternative if the owner prioritizes phishing resistance now; adopting it changes the implementation choice before coding. Do not add it silently or describe TOTP as phishing-resistant.

If both password and TOTP device are lost but verified mailbox and an unused saved recovery code remain, those two separate recovery proofs permit only password replacement and the restricted new-factor enrollment flow; prove the new TOTP and then perform fresh password+TOTP login. The recovery code is consumed once for the whole scoped recovery operation, not reused in another request. If no enrolled factor or saved recovery material remains, the fail-closed rule still applies.

## Throttling proposal

All numbers below are project starting values proposed for approval, not OWASP/NIST prescribed thresholds. Counters must be shared/committed in PostgreSQL across instances and applied to normalized account identifiers including unknown accounts; source IP comes only from a configured trusted proxy, never an untrusted `x-forwarded-for`. Fall back to a shared bounded source bucket if no trusted source exists.

| Surface | Proposed limits |
|---|---|
| Password+MFA login | Five failed attempts/account/15 minutes; twenty attempts/source/15 minutes; five MFA failures per five-minute login challenge |
| Password reset request | Three requests/account/hour; ten requests/source/hour; same public reply for known/unknown/disabled accounts |
| Recovery-code/reset proof verification | Five failures/account/15 minutes and twenty attempts/source/15 minutes, separate from but not bypassing login limits |
| Initial enrollment / factor rebind | Five failures per restricted proof; proof invalid after limit, expiry or success |

Use bounded temporary denial/Retry-After, not permanent lockout that an attacker can trigger indefinitely. Expiry of a rate window is not account reactivation or session restoration. Concurrent requests cannot exceed the budget, replay one OTP/recovery code or reset counters before full successful authentication. Password-reset completion never grants a session or removes MFA. No CAPTCHA/SMS provider or new third-party service is required by this proposal.

## Audit and notification contract

Explicit business audit already covers role changes. Propose additional security events: staff provision/activation/disable; role grant/revoke; login success/failure and throttle/OTP replay; session create/rotate/logout/revoke; password change/reset completion; MFA enrollment/replacement; recovery begin/complete and recovery-code-set regeneration. Successful persistent identity changes and their redacted audit events are transactional; failed attempts use a separate sanitized security log, never a success mutation record.

Record UTC time, actor or safe unknown-account reference, action, affected account/resource, result and request ID, with only necessary sanitized source/risk metadata. Do not store password, TOTP, seed, QR URI, bearer/setup/reset/recovery token, recovery hash or raw private request body in audit/logs. Routine authenticated reads need not flood immutable audit. Notify on password/MFA/recovery changes and suspicious repeated second-factor failures through the existing durable outbox. A delivery failure is observable and retryable, not a rollback of the already committed identity change.

Production transactional delivery/operator routing remains gated by OQ-02/OQ-08; development uses the existing private sandbox channel. This contract does not choose a production provider, retention/residency policy or named responsible operator by assumption.

## Compatibility with delivered code and future tests

Existing foundation already verifies active staff state/live roles, hashed tokens, expiry after lock wait, protected cookies and absolute-preserving rotation. Login/MFA, active/disabled mutation services, revoke-all, authentication freshness, setup/recovery proof state, replay tracking, encrypted seed, counters, audit and UI still need implementation after approval. Current single-session revoke does not establish revoke-all/reset behavior.

Keep E02-01 in progress and E02-02 unstarted. After approval, verify real password+MFA Owner login/enrollment/recovery with DB-backed sessions and browser integration, plus invalid/customer/disabled/session cases, code replay/concurrency, password/MFA change revocation and protected navigation. Only then implement approved action/field union, safe nested DTOs, and the actual dev/test reference route. Replace media `x-mock-user` producer/consumers with actual staff cookie/session/Origin/CSRF/policy; forged headers must have no effect in integration tests. Full staff-management UI and last-Owner guard remain E02-03 obligations, not completed here.

## Official evidence checked on 2026-10-07

- [NIST authenticator requirements](https://pages.nist.gov/800-63-4/sp800-63b/authenticators/): password handling, OTP one-use verification and hashed look-up secrets.
- [NIST authenticator events/recovery](https://pages.nist.gov/800-63-4/sp800-63b/events/): recovery with an independent bound factor, recovery-code lifecycle and binding notifications.
- [NIST AAL2](https://pages.nist.gov/800-63-4/sp800-63b/aal/): phishing-resistant option requirement; no TOTP-only AAL2 compliance claim.
- [NIST session management](https://pages.nist.gov/800-63-4/sp800-63b/session/): authentication-bound session secrets, expiry, logout and protected storage.
- [OWASP MFA](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html): protected factor replacement and recovery risk.
- [OWASP sessions](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html): rotation and timeout controls.
- [OWASP authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html): account/source throttles, enumeration and lockout denial-of-service risks.
- [OWASP password reset](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html): scoped proof, generic responses and invalidation.
- [OWASP logging](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html): security events without secret payloads.
- [RFC 6238](https://www.rfc-editor.org/info/rfc6238/), [otplib documentation](https://otplib.yeojz.dev/guide/getting-started.html): standards-based TOTP and server library API.
