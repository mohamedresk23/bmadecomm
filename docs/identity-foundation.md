# Internal identity foundation

These PostgreSQL services accept a DbContext; pass the caller's transaction for
business mutations, proof consumption and revocation. Subject IDs remain opaque
until the identity schema adds integrity linkage. No accounts or credentials are
created by migration 0005; the additive migration uses the existing journal and
can be rerun safely through the migration runner. Retention deletion is not automatic.

Session creation/rotation return a 32-byte random opaque token once. Database rows
contain only SHA-256 hashes. Resolution returns safe metadata and establishes token
possession; consumers must validate current identity, account enablement, credential
verification where applicable, and current permissions. Never log tokens or include
them in errors. Admin resolution counts as activity: 30-minute idle, capped at the
original 12-hour absolute deadline. Customer sessions expire after seven days.
Rotation preserves the original absolute deadline. Revocation belongs to identity
consumers: logout revokes the current session; password changes, compromise and
account disablement must revoke all subject sessions across admin/customer scopes.
Authorization or account changes must take effect even for an otherwise valid session.
Consumers must serialize identity changes and issuance in caller transactions:
lock the identity row before the final credential/account checks, session issuance,
and revoke-all for password change or disablement. Use the same identity-row lock
before invalidate/issue proof replacement on resend. This prevents a competing
issuance from escaping revocation or two resends from leaving multiple live proofs.
These locks belong to the later identity implementation; this foundation supplies
no subject lock API.

Future production HTTP consumers must use Secure, HttpOnly, host-only cookies
(omit Domain; prefer __Host- names with Path=/) and explicit SameSite protection.
They must independently validate Origin and CSRF for mutations; cookies and session
possession do not replace those checks. This foundation defines no public auth route.

Password-reset proofs expire in 30 minutes; email-verification proofs in 24 hours.
Consumption requires exact subject and purpose and atomically marks a live token.
Always consume within the same transaction as the local business mutation, so a
failure restores token eligibility. Invalid, expired, forged or reused proofs all
return false. Issue/invalidate using the same transaction when replacing a proof.

Authenticate and authorize before executeIdempotent, including retries. Its scope
is actor/operation/key and canonical JSON payload. The callback performs local DB
work only; never keep its transaction open across external I/O. Only safe JSON
results may be returned: no credentials, bearer/session/proof tokens, or other
secrets. JSON validation cannot detect secret meaning; callers own this constraint.
Replay is a stored committed result, so consumers must recheck current authority.

`npm run test` uses isolated PGlite databases. `npm run test:postgres` requires an
explicit TEST_DATABASE_URL with a dedicated database name ending in `_test`, different
from DATABASE_URL; it never falls back to the production URL.
The guard normalizes ports and known loopback aliases and rejects ambiguous URL
overrides. Remote DNS aliases cannot be proven distinct by syntax; operators must
provide a disposable database whose physical destination is separate from production.
The suite applies migrations, reruns them, then uses two independent committed connections to test
idempotency and proof races. CI supplies a disposable PostgreSQL service. Do not
claim PGlite tests prove production concurrency.
