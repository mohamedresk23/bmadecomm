---
title: 'Accessible Admin navigation and consistent responsive pages'
type: 'feature'
created: '2026-10-14'
status: 'done'
route: 'dispatch'
baseline_commit: 'a4e592d763130ca672a45d5a0bdd63da8c3ee4e5'
review_loop_iteration: 0
context: ['AGENTS.md']
---

<frozen-after-approval reason="Implementation authorized by the user's detailed Admin UI request">

## Intent

Existing Admin pages lack persistent navigation and share no layout. Provide one Arabic RTL Admin shell with discoverable authorized navigation, consistent page headers and responsive content while preserving every business operation.

## Boundaries & Constraints

Always retain existing server page checks, API authorization, authentication, CSRF, field validation, controlled inputs and save behavior. Reuse installed React, Next and Tailwind; preserve current slate/blue palette and fonts. Preserve the pre-existing untracked walkthrough document. Auth entry/recovery pages stay outside the protected shell. User has authorized reversible implementation; no additional approval is needed for this spec.

Never change database/migrations, public Store pages, API contracts, grants or authentication. No dependencies, commits or deployments. This work neither accepts E04-02 nor resolves its permission test gap or TOTP note.

## I/O & Edge-Case Matrix

| Scenario | State | Expected behavior | Error handling |
|---|---|---|---|
| Authorized navigation | owner/catalog/support roles | Only actual routes from staffNavigation appear; Arabic labels grouped by purpose | Existing server/API checks remain |
| Active route | exact or child path | Exactly appropriate item has aria-current, root only matches /admin | No prefix collisions |
| Desktop | wide screen | Visible sidebar can collapse; icons retain accessible names and visible tooltips/names on focus | No hidden content overflow |
| Mobile | narrow screen | Menu opens modal drawer; background inert, focus contained; Escape, close button/backdrop restore opener focus | Choosing a route closes drawer, including same route |
| Responsive content | 320–1440px | Forms stack, long names wrap, shipping table scrolls locally with keyboard access | No horizontal document overflow |
| Feedback | loading/empty/failure/success | Existing requests and form data remain intact; feedback has status/alert semantics | No empty success presentation during initial load failure |

</frozen-after-approval>

## Code Map

- `src/app/admin/{page.tsx,catalog,settings,security}`: existing protected pages with independent requireStaffPage calls. Move protected routes to `(workspace)` route group without changing URLs. Adjust relative imports (including tests), preserve page checks. Auth routes and shared staff-access-form stay put.
- `src/modules/identity/application/staff-navigation.ts`: current authoritative visible route list. Keep role rules and route set, reuse labels via UI metadata if necessary to avoid breaking existing tests.
- `src/modules/identity/infrastructure/staff-server.ts`: requireStaffPage resolves current roles/session. Shared server layout calls it and passes only nav data to client shell; do not modify identity module.
- `src/app/admin/catalog/products/product-manager.tsx`: form/list with existing load/error/save/unsaved/pricing logic; improve visual cards, primary action placement and mobile wrap only.
- `src/app/admin/catalog/categories/category-manager.tsx`, `settings/{profile-form,shipping-manager}.tsx`: existing responsive cards and forms. Add missing feedback roles, focus/scroll affordances, overflow adjustments without rewriting handlers. Existing dialogs are independent of drawer.
- `src/app/layout.tsx`, `globals.css`: root Arabic RTL, Arial fallback + Geist variables, Tailwind v4. Avoid global edits; introduce Admin scoped stylesheet.
- Next installed guides under `node_modules/next/dist/docs/01-app/`: read layout, route-groups, link, use-pathname and client component guides before code.
- Existing component Vitest/jsdom tests and `playwright-core` + installed Edge support validation without new packages.

## Tasks & Acceptance

**Execution:**
- [x] `src/app/admin/(workspace)/layout.tsx`, `admin-shell.tsx`, `admin.css` -- build protected shared shell, metadata, desktop collapse and native dialog mobile drawer -- make routes discoverable and keyboard accessible.
- [x] `src/app/admin/(workspace)/{page.tsx,catalog/*/page.tsx,settings/page.tsx,security/page.tsx}`, shared header -- consolidate title/breadcrumb spacing, remove redundant fullscreen wrappers and main landmarks -- consistent hierarchy.
- [x] Existing managers and tests relocated under group -- improve responsive list/form/table layout and feedback semantics -- retain all current flows.
- [x] Shell tests -- cover role-filtered lists, root/child activity, collapse and drawer lifecycle -- verify interaction edge cases meaningfully.
- [x] Browser verification script/artifacts -- inspect actual rendered shell and managers at desktop/mobile with fixture APIs if live authenticated session unavailable, explicitly label fixtures -- screenshots plus navigation, focus, RTL, save payload regression checks.

**Acceptance Criteria:**
- Given a signed out user, when a protected route is requested, then existing login redirect still applies and login itself remains accessible.
- Given a staff role, when authorized pages render, then the shell uses the existing route visibility policy and every page keeps its own authorization check.
- Given any Admin manager, when fields are edited and saved, then payload/CSRF and validation behavior match existing contracts.
- Given mobile keyboard navigation, when drawer opens/closes or viewport becomes desktop, then background and focus return to usable state.

## Implementation Notes

Initial tree: only pre-existing untracked walkthrough-e04-02-a4e592d.md; current branch testanti. It is preserved by explicit user instruction. No intent gaps or irreversible actions. Multi-file change serves one Admin navigation/usability goal. Authorization comes from user's implementation request; proceed without redundant workflow checkpoints.

Implemented grouped protected layout, Arabic navigation metadata, native mobile dialog, desktop collapse with accessible tooltip/scrolling, headers, responsive product cards/fields and improved category/shipping feedback. Existing session/role guards and all mutation payloads/handlers preserved. No public or identity module changes, dependencies, database changes, commits or deployment. Browser fixture harness and screenshots are archived under `admin-ui/`; live authenticated saves were not exercised.

Final typecheck/lint/build passed; targeted Admin/navigation 56 tests passed. Wider suite: 385 passed and one unchanged provision-owner temporary-directory EPERM failure, which passed outside sandbox. Final browser fixture run: 19 checks passed with zero page errors. Actual Next unauthenticated HTTP checks: five protected routes redirect, four auth routes remain accessible. Detailed evidence and limitations: [verification](admin-ui/verification.md).

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence and disposition |
|---|---|---|
| Collapsed rail loses vertical scroll | medium | Restored overflow-y:auto and fixed tooltip placement; short desktop Edge check passed. Patched. |
| Mobile background scroll unlocked | medium | Body overflow preserved/restored on all close/resize/unmount paths; unit and browser checks passed. Patched. |
| Breadcrumb current page semantics lost | low | Restored aria-current=page on final breadcrumb. Patched. |
| Shipping alert polite live override | low | Removed explicit aria-live to retain native alert/status semantics. Patched. |
| Resize focus branch untested | medium | Added controllable matchMedia coverage and actual Edge tests in both directions. Patched. |
| Backdrop/padding branches untested | low | Added coordinate-aware unit tests plus real browser backdrop check. Patched. |
| Initial category/shipping failure not tested | medium | Both HTTP failure and rejected initial GET covered, empty invitation excluded; actual browser failure checks passed. Patched. |
| Hiding desktop sidebar can lose focus | medium | Track sidebar focus when Edge resets activeElement before media callback; regression test and browser verification passed. Patched. |

All findings from three independent reviewers were assessed. Duplicate breadcrumb/failure-test reports share the dispositions above. No review findings deferred within this UI scope. Existing E04-02/TOTP gaps remain unchanged and outside acceptance.

## Design Notes

Keep palette and fonts already in use because DESIGN leaves brand identity unspecified. Use inline SVG outline icons without packages. Native modal dialog provides focus containment and inert background with a close/return-focus lifecycle. Group authenticated routes so the login page cannot inherit an authentication redirect. Do not pass session bearer, MFA secrets or CSRF into shell.

## Verification

- `npm run typecheck`, `npm run lint`, targeted Admin and staff-navigation Vitest tests, then appropriate full suite/build if practical. Distinguish baseline failures.
- Playwright Edge desktop/mobile inspection, navigation, active state, collapse, drawer Escape/Tab/focus restoration and RTL, local table overflow. Use fixture APIs for isolated UI flows without database writes; document live versus fixture coverage and screenshot paths.
