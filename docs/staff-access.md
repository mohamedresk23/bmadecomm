# Staff access — E02-01

Staff authentication uses an Argon2id password followed by pinned `otplib@13.5.0` TOTP. Password alone never creates a staff session. Customer identities cannot enter the staff context. Active, enrolled staff state and current role membership are checked on every session read; disabled accounts, missing roles, expired sessions and revoked tokens are denied on the next request. The admin shell currently links only Administration and Your security; business screens and grants remain E02-02/E02-03 work.

## Local setup and first Owner

Use the dedicated local PostgreSQL configuration already documented for customer identity. Apply additive migrations with `npm run db:migrate:local`. Preserve applied migration 0007; migration 0008 adds MFA state, replay steps, scoped hashed proofs, hashed recovery codes, authentication buckets, session authentication time and the first-Owner guard. Existing staff rows without confirmed MFA cannot authenticate.

Keep `APP_URL` configured to one exact origin. `STAFF_MFA_KEY` is a separate 32-byte base64 AES-256-GCM key and must differ from `IDENTITY_TOKEN_KEY`. Generate it once with `npx tsx scripts/setup-staff-access.ts`; this helper refuses an existing staff key and leaves customer settings untouched. Keep local environment files private and ignored. In production, use HTTPS and managed secret custody; losing the MFA encryption key makes enrolled seeds unavailable. The application never prints keys.

Run `npx tsx scripts/provision-owner.ts owner@example.test "Store Owner"` deliberately. It creates only the first pending Owner, separate from customers, with no usable password/session. Open the private JSON package under ignored `.local/owner-setup` within 15 minutes. Windows packages use an explicit current-user ACL; Unix directories/files use 0700/0600. Transfer the package privately. Its enrollment link keeps proof secrets in the fragment, removed promptly by the client before any request. Choose a 15–128 Unicode-code-point password, add the displayed seed to an authenticator, and prove the new TOTP. The account becomes active atomically only after confirmation. Save the ten newly generated recovery codes offline, then complete normal password+TOTP login using a new unused code.

Provisioning can reissue only for the same never-enrolled pending bootstrap Owner. It cannot convert customers, create other staff, overwrite an existing password or reset an enrolled factor. A different existing Owner or active bootstrap identity makes provisioning fail closed. Reissuing invalidates previous setup proofs. A failed private-file write leaves a pending identity that can safely reissue; it never silently activates the account.

## Session and request protection

Staff cookies are host-only `__Host-staff-session`, Secure, HttpOnly and SameSite=Strict. Only the SHA-256 token hash is persisted. The server enforces a 30-minute idle lifetime and 12-hour absolute deadline. Successful reauthentication requires current password plus a new unused TOTP, rotates the bearer token and updates `authenticatedAt` while preserving the original absolute expiry. The old token has no grace period.

Every mutation requires the exact configured Origin. Login/recovery/reset request additionally use a short-lived host-only preauthentication cookie and bound CSRF value. Restricted enrollment/reset/MFA proofs carry their own hashed CSRF binding. Own-account mutations require the current session-bound CSRF value. Neither mock identity headers nor untrusted forwarded IP headers confer authority. Set `IDENTITY_TRUSTED_IP_HEADER` only behind a proxy that removes client values and writes verified source IPs; without it, requests share a bounded source bucket. Authentication responses and server reads are private/no-store and retain the nested error envelope.

TOTP uses a 32-byte seed, six digits, 30-second period, current/previous/next steps and one accepted step per account. AES-GCM binds encrypted seeds to account and purpose. Proofs are hashed, user/purpose bound, single use and expire: login 5 minutes, initial setup 15 minutes, reset 30 minutes, recovery/factor rebind at most 5 minutes. Proof failures do not extend their deadline.

Password failures allow five/account/15 minutes and twenty attempts/source/15 minutes. MFA verification has the same shared account/source limits and five failures per login challenge. Regenerating a challenge does not clear failed-attempt state. Recovery-code verification has its separate five/account and twenty/source limits; reset requests allow three/account/hour and ten/source/hour. Counters commit outside failed identity transactions. Successful operations release only their account reservation; full successful login may reset its account failures, never source budgets. See the versioned local common-password provenance in `staff-password-blocklist.md`.

## Own-account security and recovery

Your security supports reauthentication, password change, authenticator replacement, recovery-code renewal and logout. Password/factor/code changes require current password and an unused current TOTP. Factor replacement creates only a restricted proof first; old sessions, old factor and old codes remain valid until the new seed is proved. The successful replacement atomically replaces the factor and recovery set, consumes outstanding proofs and revokes every staff session. Password/code changes likewise revoke sessions; log in again afterward.

Lost device: use current password plus one unused offline code. The code is consumed once, existing sessions and outstanding proofs are revoked, and only a five-minute rebind proof is returned. Confirm the new authenticator, save its new recovery set and perform a fresh normal login. Recovery never returns a normal staff session.

Lost password: request the generic reset response. Development delivery uses the existing private sandbox worker: `npm run identity:worker`. Staff reset tokens are encrypted in the durable outbox and appear only in a restricted private fragment link. Mailbox proof plus current TOTP replaces the password without login. Mailbox proof plus a saved code replaces the password and consumes that code once for restricted factor rebinding; prove the new factor before fresh normal login. Completion invalidates outstanding proofs and every old session. Unsupported production email recovery fails closed.

All factor/code material lost: fail closed. There is no email-only login, customer conversion, Owner override, CLI MFA reset or security-question fallback. Before production, retain an offline sealed emergency copy of recovery codes separately from the device and password; verify authorized custody and recovery procedures with the responsible operator. Do not place recovery codes in shared online storage, screenshots, logs, tickets or ordinary audit DTOs.

## Audit, notification and later integration

Persistent identity changes and their sanitized append-only audit records commit together. Failed authentication/throttle events are separate sanitized security records. Durable security-change and repeated-MFA-failure notifications carry only account references and event names; no passwords, TOTP values, seed, session bearer, proof token or recovery code/hash enters ordinary audit/outbox/error DTOs. Reset proof content in outbox is encrypted. Delivery failures remain observable/retryable and do not undo a committed security change. The private sandbox adapter supports customer verification, staff reset and staff security messages.

Migration 0009 enforces session/proof revocation at the persistence boundary for committed staff disable, password/factor replacement, staff identity demotion and new/changed role assignments, including writes from another connection. Triggers bind to the actual identity-table schema. Role assignment locks user then account before FK locks and revokes only after a real new/changed grant; idempotent inserts do not log out staff. Reductions continue to enforce current grants without logging out permitted remaining roles. Re-enabling a disabled account cannot revive its old sessions or proofs.

E02-03 must reuse the atomic authentication port and account-before-session/proof lock order and the delivered persistence guards. Staff role increases require fresh password+MFA login. Sensitive refunds, role grants, secret management, factor changes and code renewal require `staffAuthenticationIsFresh` on a validated current session (15 minutes); factor/code replacement additionally proves password+TOTP within that command. No role name bypasses authorization or financial invariants. The last-active-Owner management guard and staff-creation UI belong to E02-03.

Production dependencies remain unresolved external decisions: approved transactional provider/operator routing, secret-management/backups, TLS/proxy trust configuration and retention/residency policy. This implementation does not claim production mailbox recovery delivery or phishing-resistant/NIST AAL2 authentication. WebAuthn remains excluded.

## Verification evidence and reproduction

Run the affected staff suites with Vitest, then lint, typecheck and build. `scripts/verify-local-staff-access.ts` requires the dedicated loopback PostgreSQL configuration, a built Next application and installed headless Edge. It creates a generated isolated schema, applies migrations there, launches only its own private loopback Next server with fresh test keys, and exercises actual PostgreSQL, HTTP and browser flows. It uses independent connections for races/rollback and drops only its validated generated schema. It does not alter existing identities, credentials or environment keys. Output and `.local/staff-access-verification.json` contain only sanitized check names/statuses, never proof/token/code/seed values. Previous evidence is overwritten with running/failed status before checks begin.

| Acceptance / edge case | New executed test evidence |
| --- | --- |
| Pending Owner activates only after password and proved TOTP; no customer conversion/reset | `staff-auth.test.ts` first-Owner/reissue/customer tests; `provision-owner.test.ts` private package test |
| Invalid/customer/disabled/no-role or revoked identity gets no protected session | `staff-auth.test.ts`, `staff-http.test.ts`, MFA-adapted `staff-sessions.test.ts` |
| Actual shell/navigation reads enforce current staff state | Server `requireStaffPage` at each entry point; live verifier browser group required before story completion |
| OTP/proof/code replay is single-use | `staff-auth.test.ts`; live independent PostgreSQL race/rollback groups required before completion |
| Regenerated MFA challenges retain account/source budgets | `staff-auth.test.ts` persistent account/source tests; live verifier shared-bucket group |
| Recovery/password/factor/code changes revoke old sessions and never create MFA-free sessions | `staff-auth.test.ts` own-account/recovery/mailbox tests; `staff-access-form.test.tsx` real form recovery |
| Reauthentication refreshes MFA and retains absolute deadline | `staff-auth.test.ts` six successful rotations and source-budget test; live browser reauth group |
| Strict Origin/CSRF, bounded schemas, safe errors/no-store | `staff-http.test.ts`; form deadline/duplicate-submit tests; live HTTP group |
| UI proof handling and accessible two-step/enrollment/recovery behavior | Six real-handler `staff-access-form.test.tsx` tests; installed Edge live groups |
| No secret serialization and durable delivery | `staff-auth.test.ts` audit/outbox/mailbox tests; sandbox handler and live verifier inspection |

Initial new verification on 2026-10-07: 20 staff database/cryptographic tests and one rate-window concurrency regression passed; four real HTTP tests, six real-handler UI tests, six MFA-adapted session tests and the independent-key setup test passed. The provisioning private Windows-ACL test passed outside the filesystem sandbox. Typecheck and lint passed (lint retained three preexisting warnings). The parent's final full-suite/build/live run must be recorded here before accepting E02-01. Historical session foundation counts are not evidence for these workflows.
