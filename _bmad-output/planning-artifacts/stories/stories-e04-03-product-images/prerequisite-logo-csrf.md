# PREREQ-E04-03-01-LOGO-CSRF

Status: implemented and verified, 2026-10-14. This identifier is a separate prerequisite, not a new sprint story. The owner explicitly authorized its implementation and real CSRF/Owner rejection verification; this extended the caller-only proposal to the existing upload route security boundary. It does not authorize E04-03-01 implementation.

## Objective and boundaries

Prepare the existing store-logo upload caller to supply its current Owner session-bound CSRF value to the legacy upload route. Preserve current profile fields, upload result and form state. No new settings feature, migration, grant, public preview or product image scope.

## Expected implementation files

- `src/app/admin/(workspace)/settings/profile-form.tsx`: send the existing current CSRF token as X-CSRF-Token with upload; keep cookies and browser Origin behavior; missing/expired metadata must not invent a token or identity.
- `src/app/admin/(workspace)/settings/profile-form.test.tsx`: verify upload request headers, expired/missing-token recovery and existing form-state behavior. Use an isolated server/session fixture for eventual secured-route integration, not x-mock-user.
- `src/app/api/media/upload/route.ts`: real Owner session/CSRF and exact Origin before multipart reads; removed mock-header authority; private/no-store responses including errors. Processor and publish route unchanged.
- `src/app/api/media/upload/route.test.ts`, `route.integration.test.ts`: security/error matrix and real existing processor with isolated temporary private storage; no shared media-directory cleanup.

## Acceptance and evidence

- Given loaded Owner metadata, when a logo is uploaded, then the request carries the current session-bound CSRF and no client-generated role/permission identity.
- Given missing/expired metadata, when upload is attempted or denied, then the form preserves safe local state and gives explicit reload/reauthentication feedback without an unauthorized fallback.
- Given the newly secured upload route, when real-session tests execute, then correct Owner/Origin/CSRF succeeds and absent/corrupt/cross-session CSRF, mock authority, nonowner, expired/revoked/disabled/customer identities fail before multipart processing. A component test connects actual profile GET metadata to actual POST, with the processor mocked only for this security linkage.

## Executed verification and review

Final parent run: `npm.cmd test -- src/app/api/media/upload/route.test.ts src/app/api/media/upload/route.integration.test.ts 'src/app/admin/(workspace)/settings/profile-form.test.tsx'` — 33 passed across three files: 17 route security/error, 3 actual processor/storage integration, 13 profile tests. Integration tests use actual issued server sessions, isolated test DB and per-test private filesystem adapter; verify pending metadata/private bytes/no public copy and 413/415 rejection. Browser component tests use real GET/POST handlers for token linkage and a mocked processor; this is not a live-browser test.

Final `npm.cmd run typecheck` passed. `npm.cmd run lint` passed with zero errors and one existing Upload.tsx:80 no-img warning. `git diff --check` passed. Three independent review layers completed; regression, post-auth error, caller-to-route linkage and same-file retry gaps were fixed and the final checks rerun. No application DB migration, dependency installation, publish/processor change, image benchmark or production verification occurred.

All prerequisite ACs have executed evidence. E04-03-01 must retain these protections and rerun compatibility tests when it changes the remaining pipeline; this prerequisite does not prove its future decode/deadline/cleanup implementation.
