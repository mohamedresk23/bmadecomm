---
title: 'Story 7.101: Homepage sections draft editor'
type: 'feature'
created: '2026-10-22'
status: 'in-review'
baseline_commit: '7d48a80e9f458aa68488292d198d8fc02aed9e12'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '_bmad-output/specs/spec-e07-homepage-content-publishing/SPEC.md'
  - '_bmad-output/specs/spec-e07-homepage-content-publishing/implementation-contract.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Staff have no mechanism to curate, order, and save homepage sections, leaving the public storefront home a placeholder and risking draft leakage if sections were edited directly in public view.

**Approach:** Deliver migration 0019 introducing `homepage_drafts` and `homepage_publications`, a validated section schema service for the six approved FR-08 section types with catalog reference validation, authenticated admin APIs (`GET`/`PUT`), and an accessible Arabic RTL admin editor (`A-12`) with keyboard reordering controls.

## Boundaries & Constraints

**Always:**
- Restrict draft viewing and updates to staff with `content.read` or `content.manage` (default `owner`, `marketing`); deny customer and guest sessions with 401/403.
- Enforce strict section type validation allowing only `hero`, `featured_categories`, `featured_products`, `best_sellers`, `new_arrivals`, and `promotions`.
- Validate that all referenced product IDs exist in `products` and category IDs exist in `categories`.
- Require `expectedRevision` on draft saves and return 409 Conflict on stale updates.
- Record an append-only audit event (`action: "content.homepage.draft.save"`) in the same database transaction.
- Implement keyboard-accessible Move Up / Move Down controls without requiring drag-and-drop (WCAG 2.5.7) in Arabic RTL layout.

**Never:**
- Never allow arbitrary HTML/JS blocks, general-purpose CMS page builders, or P1 controls (Wishlist, Ratings, Brands).
- Never cache draft responses in shared or public caches (`Cache-Control: private, no-store`).
- Never allow draft saves to alter public storefront `/` without an explicit publish in E07-03.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Get draft (first load) | GET /api/v1/admin/content/homepage (staff session) | Returns default initialized draft with empty sections array, revision 1 | 401 if unauthenticated, 403 if unpermitted role |
| Valid draft save | PUT with valid sections array, expectedRevision: 1, CSRF | Sections persisted in homepage_drafts, revision becomes 2, audit event written | Return 200 with updated draft and CSRF |
| Unapproved section type | PUT containing section with type: "custom_banner" | Rejected, no database writes | HTTP 422 with issue field "sections[0].type" |
| Non-existent product reference | PUT with featured_products containing fake product ID | Rejected, no database writes | HTTP 422 with issue field pointing to invalid ID |
| Stale concurrent update | PUT with expectedRevision: 1 when DB revision is 2 | Rejected, no database writes | HTTP 409 Conflict ("Draft has been modified by another user") |
| Missing CSRF or invalid origin | PUT mutation with invalid x-csrf-token or mismatched origin | Rejected immediately | HTTP 403 Forbidden |

</frozen-after-approval>

## Code Map

- `src/db/schema.ts` -- define and export `homepageDrafts` and `homepagePublications` tables with constraints.
- `src/db/migrations/0019_homepage_content.sql` -- migration DDL creating `homepage_drafts` and `homepage_publications`.
- `src/db/migrations/0019_homepage_content.down.sql` -- rollback migration dropping both tables.
- `src/modules/content/homepage/contracts/section-schema.ts` -- Zod schemas and TypeScript types for the six approved section configurations and validation helpers.
- `src/modules/content/homepage/application/homepage-draft-service.ts` -- domain service for getting draft, validating catalog references, updating draft with optimistic locking, and writing audit log.
- `src/app/api/v1/admin/content/homepage/route.ts` -- Next.js API route handlers for `GET` (read draft) and `PUT` (save draft) protected by staff session and CSRF.
- `src/modules/identity/application/staff-navigation.ts` -- include homepage content navigation link for permitted roles.
- `src/app/admin/(workspace)/content/homepage/page.tsx` -- admin UI (`A-12`) in Arabic RTL with section toggles, reference pickers, and keyboard reordering.
- `src/modules/content/homepage/application/homepage-draft-service.test.ts` -- unit tests for schema validation, reference verification, and revision conflicts.
- `src/app/api/v1/admin/content/homepage/route.test.ts` -- integration tests for auth, CSRF, draft fetch, update, and error envelopes.

## Tasks & Acceptance

**Execution:**
- [x] `src/db/migrations/0019_homepage_content.sql` & `down.sql` -- write migration DDL for `homepage_drafts` and `homepage_publications`.
- [x] `src/db/schema.ts` -- add `homepageDrafts` and `homepagePublications` table exports matching Drizzle conventions.
- [x] `src/modules/content/homepage/contracts/section-schema.ts` -- implement Zod discriminated union for the six section types and update payload schema.
- [x] `src/modules/content/homepage/application/homepage-draft-service.ts` -- implement `getHomepageDraft` and `updateHomepageDraft` with transaction, reference checks, revision check, and audit.
- [x] `src/modules/identity/application/staff-navigation.ts` -- add `{ href: '/admin/content/homepage', label: 'Homepage content' }` for `owner` and `marketing`.
- [x] `src/app/api/v1/admin/content/homepage/route.ts` -- implement `GET` and `PUT` handlers with `requireStaffSession`, CSRF validation, and standard error envelopes.
- [x] `src/app/admin/(workspace)/content/homepage/page.tsx` -- implement `A-12` editor with Arabic RTL layout, section cards, Move Up / Move Down buttons, and save feedback.
- [x] `src/modules/content/homepage/application/homepage-draft-service.test.ts` -- test validation rules, reference checks, and optimistic concurrency.
- [x] `src/app/api/v1/admin/content/homepage/route.test.ts` -- test authz, CSRF, happy path save, and 409 conflict handling.

**Acceptance Criteria:**
- Given an authenticated staff member with `content.manage`, when loading `/admin/content/homepage`, then the current draft sections and revision are displayed with `private, no-store` headers.
- Given a draft with sections, when clicking "Move Up" or "Move Down" on a section, then the section positions update in state without drag-and-drop.
- Given an update payload with an unapproved section type or invalid product/category ID, when submitted to `PUT`, then HTTP 422 is returned with structured field issues and no database writes occur.
- Given two concurrent saves with the same `expectedRevision`, when both execute, then exactly one succeeds and the second receives HTTP 409 Conflict.
- Given an unauthenticated or customer request to the draft endpoint, when submitted, then HTTP 401 or 403 is returned.

## Implementation Notes

- Added database migration `0019_homepage_content.sql` creating `homepage_drafts` with key singleton check, revision check, jsonb array check, and `homepage_publications` with version uniqueness and published timestamp index. Added matching `down.sql` rollback script and updated `_journal.json`.
- Exported `homepageDrafts` and `homepagePublications` tables in `src/db/schema.ts`.
- Implemented Zod discriminated union schema for the 6 approved `FR-08` section types (`hero`, `featured_categories`, `featured_products`, `best_sellers`, `new_arrivals`, `promotions`) with strict validation rules, 0-based contiguous position checks, 12-section maximum, duplicate prevention, and structured field path formatting (`formatIssuePath`) in `src/modules/content/homepage/contracts/section-schema.ts`.
- Implemented `getHomepageDraft`, `getLatestPublication`, `validateCatalogReferences`, and `updateHomepageDraft` with optimistic concurrency locking (`FOR UPDATE`, 409 on revision mismatch) and append-only audit event logging (`action: "content.homepage.draft.save"`, `resource: "homepage_draft:default"`) in `src/modules/content/homepage/application/homepage-draft-service.ts`.
- Added `/admin/content/homepage` link to `staffNavigation` for `owner` and `marketing` roles in `src/modules/identity/application/staff-navigation.ts` and updated its unit tests.
- Implemented `GET` and `PUT` route handlers in `src/app/api/v1/admin/content/homepage/route.ts` with staff session authentication, CSRF/Origin checks, `Cache-Control: private, no-store` and `Pragma: no-cache` headers, and standard error envelopes.
- Built Arabic RTL admin editor UI (`A-12`) with section cards, toggle switches, reference editors, keyboard-accessible Move Up / Move Down controls (WCAG 2.5.7), save feedback, and conflict detection in `src/app/admin/(workspace)/content/homepage/page.tsx` and `homepage-editor.tsx`.
- Updated `src/db/migrate.test.ts` to assert migration 0019 as the head, verifying up, down (1 step), reapply up, and rollback 2 steps.
- Unit and integration tests added and fully verified in `homepage-draft-service.test.ts`, `route.test.ts`, and `homepage-editor.test.tsx`.

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `npm run test -- src/modules/content/homepage` -- expected: all unit and validation tests pass.
- `npm run test -- src/app/api/v1/admin/content/homepage` -- expected: all route integration tests pass.
- `npm run typecheck` -- expected: zero TypeScript compiler errors.
- `npm run lint` -- expected: zero ESLint errors.

