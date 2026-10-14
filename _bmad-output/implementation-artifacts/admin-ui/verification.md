# Admin UI verification — 2026-10-14

Amelia's installed Developer workflow was used for implementation and verification. A separate read-only UX investigation used Sally's responsibilities to inspect the existing DESIGN/EXPERIENCE constraints. The existing blue/slate palette, Arabic RTL root and installed React/Next/Tailwind tooling were retained.

## Changes

Protected pages moved into `src/app/admin/(workspace)` without URL changes. A server layout uses the existing staff session reader and navigation policy. Pages keep their original independent session/role checks. The client shell receives only navigation items, not session secrets. Native modal navigation supports focus containment, Escape, backdrop dismissal, return focus, scroll lock and breakpoint focus transfer. The desktop sidebar collapses without losing accessible names, tooltips or short-screen scrolling.

The dashboard, products, categories, store profile/shipping settings and account security share consistent page headers/breadcrumbs. Product cards, create/save actions and responsive variant fields were polished. Shipping tables have a keyboard-focusable scroll region. Category/shipping initial load failure no longer renders an empty success invitation. API routes, business save handlers, auth/CSRF policies, database/migrations, root styling and public pages were not changed.

## Automated evidence

- Before implementation: typecheck passed; lint passed with the existing `src/components/Upload.tsx:80` image warning; Admin/navigation tests 46/46 passed.
- Final: `npm.cmd run typecheck` passed; `npm.cmd run lint` passed with the same warning; `npm.cmd run build` passed and retained original Admin URLs.
- Final targeted `npx.cmd vitest run src/app/admin src/modules/identity/application/staff-navigation.test.ts`: 7 files, 56 tests passed. Includes product/variant save integration, existing staff access form tests, role visibility, active path boundaries, drawer lifecycle, scroll restoration, breakpoint focus, backdrop/padding and failed category/shipping initial loads.
- Wider suite before the last review patches: 385 passed, 1 failed, 1 skipped, 1 todo; 57 files passed, 1 failed, 1 skipped. The failure was Windows `EPERM` deleting the temporary directory in unchanged `scripts/provision-owner.test.ts`. The same test passed when rerun outside the filesystem sandbox. Final review changes were covered by the final targeted run; a second full-suite run was not performed. The wider Upload tests removed two tracked image fixtures, which were restored to their original Git contents.
- `git diff --check` passed. No commit or deployment.

## Actual browser evidence

Headless installed Microsoft Edge via existing `playwright-core`; desktop 1440×1000, mobile 390×844, narrow 320×800, short desktop 1280×350. The **actual AdminShell, AdminPageHeader and managers** ran in an isolated Vite harness, with fixture API responses and a local adapter for Next's client navigation. These are browser UI tests, not live authenticated application/database tests. The harness writes no project database rows.

All 19 recorded checks in [browser-results.json](browser-results.json) passed, with no browser page errors:

- Desktop collapse/expand, keyboard focus, visible icon tooltip and short-screen rail scrolling.
- Active exact/root and nested paths; navigation among implemented pages.
- Mobile modal focus stays out of background content; Escape/close/backdrop restore opener focus; same/different route selection closes it. Body scroll is locked/restored. Breakpoint changes restore visible focus in either direction.
- RTL and no horizontal document overflow across dashboard, products, categories, profile, shipping and security at 320px. Shipping table overflow remains local and keyboard focusable.
- Category and shipping create dialogs, profile save and product decimal validation/save ran through fixture transport. Product inputs survived validation; payload minor units and existing CSRF/pricing/idempotency headers were asserted.
- A support-role UI fixture showed only dashboard/account security. This is **not** permission enforcement evidence.
- Initial product/category/shipping errors and product empty state were exercised.

Production Next HTTP checks without a staff cookie: `/admin`, `/admin/catalog/products`, `/admin/catalog/categories`, `/admin/settings`, `/admin/security` returned 307 to `/admin/login`; `/admin/login`, `/admin/enroll`, `/admin/recover`, `/admin/reset` returned 200. This checks route grouping/redirect accessibility, not a successful live login.

Screenshots inspected visually: [desktop](desktop.png), [mobile](mobile.png), [mobile drawer](mobile-drawer.png). They show fixture content in actual components.

To reproduce the isolated browser checks, extract [fixture-harness.zip](fixture-harness.zip) into the repository's ignored `.local/admin-ui/` directory. Run `node .local/admin-ui/server.mjs`, then in another terminal `node .local/admin-ui/check.mjs`. Requires installed project dependencies and Microsoft Edge; port 4173 must be free. No test routes or auth bypasses are added to the application.

## Limits

No new live password/TOTP login, real authenticated saves, or separate restricted staff account were exercised. Existing auth/API protections were preserved and covered by existing automated tests and read-only diff inspection. E04-02 acceptance, its restricted-role live testing gap and the separate TOTP note remain open. The pre-existing walkthrough document was preserved.

Three independent workflow review lenses identified breakpoint focus, collapsed-rail scrolling, scroll lock, breadcrumb semantics, error live semantics and missing failure/resize/backdrop tests. All were patched and the affected automated/browser checks passed. No review findings were deferred within this UI scope.
