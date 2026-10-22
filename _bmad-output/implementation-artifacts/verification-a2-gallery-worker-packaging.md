# A2 gallery worker packaging verification

Date: 2026-10-22. Baseline: `02815f256d4381417943c3642f1e14497e4ff3ca`.

## Result

A2 packaging and upload checks passed on the installed Windows runtime. The gallery route now shares the generic upload route's explicit worker, Sharp, native `@img`, detect-libc and semver tracing includes. The match is limited to `/api/v1/admin/catalog/products/*/images`; global tracing and deployment output mode are unchanged.

## Fresh build and isolated packages

- `npm.cmd run build -- --webpack`: passed, including TypeScript and route tracing. An initial attempt found a new harness TypeScript narrowing error; it was corrected before the successful build.
- `node scripts/test-media-build.cjs`: passed for both routes. Generic upload copied 262 traced files; gallery upload copied 263. Each package executed the traced worker against a PNG fixture and produced a valid 2 × 3 PNG. Removing the copied worker then failed with the expected missing-worker error in both packages. The check explicitly requires a traced native `.node` asset.
- `npx.cmd tsx scripts/verify-gallery-packaged-upload.ts`: passed. Copied 814 files from gallery/server traces and required build manifests, retaining relative paths, into a unique temporary directory outside the checkout. No entire `.next` or checkout dependency tree was copied.

The HTTP check instantiated the traced, built `NextServer` with `dev:false` and used its real request handler over loopback. A unique local PostgreSQL schema held migrated disposable fixtures, a catalog staff account, a genuine issued session and a draft product. The child received a restricted environment without `NODE_PATH` or `NODE_OPTIONS` and ran from the copied package.

Observed assertions:

1. Authenticated GET of the gallery returned 200 before upload.
2. Authenticated multipart POST with Origin, derived CSRF and an idempotency key returned 201.
3. Repeating the same image/key returned 201 with the exact same result.
4. The schema contained exactly one attachment for the requested product and one matching pending media record.
5. The stored private PNG fully decoded to 32 × 24 × 3 raw pixels (2,304 bytes); encoded byte count matched the record.
6. No corresponding `public/uploads` copy existed.
7. Child termination, schema removal, database connection shutdown and checked temporary-root removal completed successfully.

Fixture compatibility: the current migration journal omits historical `0005_sessions_proof_idempotency.sql`. The harness reuses only that migration's `operation_keys` table/index DDL and existing session compatibility columns inside the disposable schema, following existing verification conventions. This is not evidence of a fresh-install migration repair.

## Other verification

- `npm.cmd run typecheck`: passed after final harness changes.
- `npx.cmd eslint next.config.ts scripts/test-media-build.cjs scripts/verify-gallery-packaged-upload.ts`: passed.
- Focused Vitest run of image-process, image-process-gate, upload, upload-timeout integration, generic upload route/unit integration and gallery route suites: **7 files, 125 tests passed**, reported duration 44.78 seconds. No assertions were weakened.

The first sandbox Vitest attempt stalled without a result and was interrupted; the approved run outside the sandbox produced the passing summary. Sandbox tsx startup also failed with a Windows user-info error before the harness executed; approved execution succeeded. No global environment configuration or dependencies were changed.

## Limits and remaining work

This verifies local traced packages for the host's installed native binaries, not another OS/architecture or a deployed hosting adapter. The Next server used built production code with `dev:false`, while `NODE_ENV=development` permits the existing staff configuration's loopback HTTP; production HTTPS/cookie behavior was not evaluated. Authentication code was unchanged.

This is a single-client packaged upload/replay check, not PostgreSQL concurrency, accessibility, crash recovery or deployment acceptance. No persistent application table/data, application media, production environment or remote service was changed. A3–A5 remain open, Epic 4 remains in-progress, and the historical retrospective verdict remains rejected pending its remaining actions.

External process interruption (SIGINT/SIGTERM/SIGKILL or power loss) is not a guaranteed cleanup path. The harness performs cleanup for its ordinary success and exception paths; forced interruption may require removing its uniquely prefixed temporary directory/schema after checking that its processes have stopped.

## Review and final verification

Three independent review layers completed. Header-only image inspection, the missing product association assertion and combined primary/cleanup diagnostics were corrected. The other suggestions were rejected as low-impact extensions; no findings were deferred. After the patches, the fresh Webpack build, both isolated worker checks, actual packaged HTTP upload/replay, typecheck and focused ESLint passed again.

The final focused Vitest rerun also passed: 7 files, 125 tests, 45.36 seconds. Final diff whitespace check passed.
