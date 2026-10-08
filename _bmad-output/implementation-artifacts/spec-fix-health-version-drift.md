---
title: 'Fix health endpoint version drift'
type: 'bugfix'
created: '2026-10-08'
status: 'in-progress'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The health endpoint (`src/app/api/health/route.ts`) hardcodes `"version": "1.0.0"`, which diverges from `package.json` (`"0.1.0"`). Story F00-01 requires reporting the actual build/package version.

**Approach:** Dynamically read `version` from `package.json` (with fallback to `process.env.npm_package_version`) in `route.ts`, and update `route.test.ts` to assert that the returned version matches `package.json`'s version.

</frozen-after-approval>

## Implementation Notes


