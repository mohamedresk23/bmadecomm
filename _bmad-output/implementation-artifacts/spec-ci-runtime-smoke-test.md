---
title: 'Add CI runtime smoke test step'
type: 'chore'
created: '2026-10-08'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story F00-01 acceptance criteria requires a CI smoke job verifying that the built server boots and the health endpoint returns 200 OK. Currently `.github/workflows/ci.yml` builds the app but does not perform a runtime smoke test.

**Approach:** Add a `Smoke Test` step to `.github/workflows/ci.yml` following the `Build` step. The step launches `npm run start` in the background, polls `http://127.0.0.1:3000/api/health` until HTTP 200 OK is received (or timeouts after 30 seconds), verifies the response, and cleanly shuts down the server.

</frozen-after-approval>

## Implementation Notes

- Added `Smoke Test` step in `.github/workflows/ci.yml` after `npm run build`.
- The smoke test boots the production build (`npm run start &`), polls `http://127.0.0.1:3000/api/health` via `curl -sf`, outputs the health response, and kills the background server cleanly with zero exit code.
- Verified lint, typecheck, and health route test pass cleanly.

