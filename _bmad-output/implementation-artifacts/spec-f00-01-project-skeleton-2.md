---
title: 'F00-01 — Project skeleton, CI and environments'
type: 'chore'
created: '2026-10-08'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The project skeleton, health endpoint, and RTL configuration were initially set up, but missing an integration test for the health endpoint, a registered npm test runner script, and test execution in CI.

**Approach:** Add an automated integration test for `GET /api/health`, define `"test": "vitest run"` in `package.json`, and ensure CI workflow runs tests as required by F00-01 acceptance criteria.

</frozen-after-approval>

## Implementation Notes

- Added `"test": "vitest run"` script to `package.json` to enable `npm test`.
- Created integration test `src/app/api/health/route.test.ts` asserting 200 OK, Cache-Control header, and expected `{ status: "ok", version: "1.0.0" }` payload.
- Added `export const dynamic = "force-dynamic"` and `Cache-Control` header to `src/app/api/health/route.ts`.
- Updated `.github/workflows/ci.yml` to include `npm test` step and removed fallback echo masking typecheck failure.
- Updated `src/app/layout.tsx` to use `Readonly<{ children: React.ReactNode }>` prop types.
- Verified `npm run typecheck`, `npm run lint`, `npm test src/app/api/health/route.test.ts`, and `npm run build` all pass successfully.

## Review Triage Log

- medium (.github/workflows/ci.yml:42) — Suppressed typecheck failure masking broken builds: Patched by removing fallback echo.
- low (.github/workflows/ci.yml:28-36) — Inadequate secret scanning: Rejected; basic scanning satisfies initial F00-01 scope.
- low (.github/workflows/ci.yml:3-8) — Missing workflow concurrency control: Rejected; minor non-blocking optimization.
- false (src/app/api/health/route.ts:5) — Hardcoded version mismatch: Disproved; F00-01 spec explicitly specified returning version "1.0.0".
- medium (src/app/api/health/route.ts:3-8) — Missing dynamic route configuration and cache-control headers: Patched by adding force-dynamic and Cache-Control header.
- low (src/app/api/health/route.ts:3-8) — Missing operational diagnostic metadata: Rejected; outside F00-01 requirements.
- low (src/app/api/health/route.test.ts:5-14) — In-memory test assertions: Patched by verifying headers, status, and payload.
- medium (src/app/layout.tsx:20) — Layout props coupled to generated build artifacts: Patched by typing standard React.ReactNode children.
- low (src/app/layout.tsx:5-13) — Arabic font subsets: Rejected; typography styling deferred to UX epic.
- low (src/app/layout.tsx:15-18) — Starter metadata: Rejected; cosmetic for foundational story.
- low (package.json:11) — Missing watch/coverage scripts: Rejected; developer convenience scripts not required by F00-01.
