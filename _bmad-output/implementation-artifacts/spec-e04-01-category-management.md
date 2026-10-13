---
title: 'E04-01: Category Tree Management'
type: 'feature'
created: '2026-10-11'
status: 'done'
baseline_commit: '8492ba259e35d94a73ba88be2e130b99203f7fe2'
route: 'dispatch'
review_loop_iteration: 0
context:
  - src/db/schema.ts
  - src/modules/content/settings/infrastructure/admin-auth.ts
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Store administrators have no way to create, organize, or manage the catalog category hierarchy required to classify sellable products, structure storefront navigation, and enforce category URL stability.

**Approach:** Implement a full-stack vertical slice for category management: a PostgreSQL `categories` table with parent-child hierarchy and unique slugs, a domain service with cycle detection and deletion protection, authenticated admin REST APIs with audit logging, and an RTL-ready admin management interface (A-05).

## Boundaries & Constraints

**Always:**
- Slugs must be globally unique across all active and inactive categories, normalized to lowercase kebab-case.
- Reject cyclic parent assignments (e.g., A -> B -> A, or setting parent to self).
- Reject hard deletion if a category has child subcategories or assigned products.
- Staff operations require an active authenticated staff session with owner/catalog management role, Origin validation, and CSRF protection.
- Every state mutation (create, update, delete, reorder) writes an append-only entry to `audit_events`.
- Storefront public query (`GET /api/v1/store/categories`) returns only active categories with hierarchy preserved.

**Never:**
- Do not introduce product or variant mutations in this story (reserved for E04-02).
- Do not allow client-side optimistic deletion without server verification.
- Do not bypass server-side validation or slug uniqueness checks.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create root category | Valid name "Men", slug "men", parent null | HTTP 201 with category object, audit event recorded | N/A |
| Create child category | Valid name "Shoes", slug "shoes", valid parent ID | HTTP 201 with category linked to parent | N/A |
| Duplicate slug | New category with existing slug | HTTP 409 Conflict | Field error `slug: "Slug already in use"` |
| Self-parenting | Update category with `parentId == id` | HTTP 422 Unprocessable Entity | Field error `parentId: "Category cannot be its own parent"` |
| Circular dependency | Update A with `parentId = B` where B is descendant of A | HTTP 422 Unprocessable Entity | Field error `parentId: "Circular parent category relationship detected"` |
| Delete category with children | DELETE `/api/v1/admin/catalog/categories/:id` with subcategories | HTTP 409 Conflict | Error envelope with message "Cannot delete category with subcategories" |
| Delete leaf category | DELETE `/api/v1/admin/catalog/categories/:id` without children | HTTP 200 with `{ success: true }`, audit recorded | N/A |
| Unauthenticated access | Request without valid staff cookie | HTTP 401 Unauthorized | Standard error envelope |

</frozen-after-approval>

## Code Map

- `src/db/schema.ts` -- Add `categories` table definition with self-referencing foreign key, slug unique constraint, and sort index.
- `src/db/migrations/0013_categories.sql` -- Migration DDL creating `categories` table with foreign key and index.
- `src/db/migrations/0013_categories.down.sql` -- Rollback SQL dropping `categories` table.
- `src/modules/catalog/categories/contracts/category.ts` -- Zod contracts and DTO types for create, update, and reorder.
- `src/modules/catalog/categories/application/category-service.ts` -- Service logic: tree retrieval, slug generation, cycle prevention, deletion guards, and audit trail logging.
- `src/modules/catalog/categories/application/category-service.test.ts` -- Unit tests for cycle detection, slug collision, and parent validation.
- `src/app/api/v1/admin/catalog/categories/route.ts` -- Admin collection endpoint: GET (list tree) and POST (create category).
- `src/app/api/v1/admin/catalog/categories/[id]/route.ts` -- Admin item endpoint: GET, PUT (update/move), DELETE (safe removal).
- `src/app/api/v1/admin/catalog/categories/route.test.ts` -- Integration tests for admin category APIs.
- `src/app/api/v1/store/categories/route.ts` -- Public storefront read endpoint for active category navigation tree.
- `src/app/admin/catalog/categories/page.tsx` -- Admin page for category management.
- `src/app/admin/catalog/categories/category-manager.tsx` -- Client component: tree viewer, create/edit modal, delete confirmation, RTL support.
- `src/app/admin/catalog/categories/category-manager.test.tsx` -- Component tests for category tree interaction.
- `src/modules/identity/application/staff-navigation.ts` -- Add Catalog/Categories link to staff navigation.

## Tasks & Acceptance

**Execution:**
- [x] `src/db/schema.ts` -- Add `categories` table with `id`, `name`, `slug`, `description`, `parentId`, `sortOrder`, `isActive`, timestamps.
- [x] `src/db/migrations/0013_categories.sql` and `0013_categories.down.sql` -- Create idempotent migration script and reverse rollback.
- [x] `src/modules/catalog/categories/contracts/category.ts` -- Define Zod schemas for input validation and TypeScript types.
- [x] `src/modules/catalog/categories/application/category-service.ts` -- Implement `createCategory`, `updateCategory`, `deleteCategory`, `getCategoryTree`, and cycle validation algorithm.
- [x] `src/modules/catalog/categories/application/category-service.test.ts` -- Unit tests covering tree builder, cycle rejection, and self-parent rejection.
- [x] `src/app/api/v1/admin/catalog/categories/route.ts` -- Admin GET (list) and POST (create) endpoints with staff auth and audit logging.
- [x] `src/app/api/v1/admin/catalog/categories/[id]/route.ts` -- Admin GET, PUT, and DELETE endpoints with CSRF and cycle validation.
- [x] `src/app/api/v1/admin/catalog/categories/route.test.ts` -- Integration tests verifying auth, validations, cycle rejection, duplicate slug, and audit events.
- [x] `src/app/api/v1/store/categories/route.ts` -- Public GET endpoint returning published active categories.
- [x] `src/app/admin/catalog/categories/category-manager.tsx` -- Interactive tree manager with create/edit forms, error handling, and RTL layout.
- [x] `src/app/admin/catalog/categories/page.tsx` -- Server component page enforcing staff session check and rendering manager.
- [x] `src/modules/identity/application/staff-navigation.ts` -- Expose `/admin/catalog/categories` in staff navigation menu.

**Acceptance Criteria:**
- Given a staff user with owner or staff role, when creating a category with valid name and slug, then it is saved in the database with audit logging and appears in the category tree.
- Given an existing category with slug "electronics", when attempting to create or update another category with slug "electronics", then the API returns 409 Conflict with a clear field error.
- Given a parent category A and child category B, when attempting to set A's parent to B, then the operation is rejected with 422 Unprocessable Entity for circular dependency.
- Given a category with child subcategories, when attempting to delete it, then the API rejects the deletion with 409 Conflict.
- Given public storefront requests to `/api/v1/store/categories`, when queried without authentication, then only active categories are returned in hierarchical order.

## Implementation Notes

- Added `categories` table with self-referencing foreign key constraint (`ON DELETE restrict`), uniqueness on `slug`, normalized check constraint, and indexes on `parentId` and `sortOrder`.
- Created reversible migration `0013_categories.sql` and `0013_categories.down.sql` registered in `_journal.json`.
- Implemented cycle prevention algorithm (bounded to 20 steps to prevent infinite loop on corrupted data), self-parent validation, slug normalization and uniqueness enforcement, and deletion protection against categories with children.
- Provided staff role session authentication helper `requireCatalogStaffSession` with Origin and CSRF validation for all mutation routes.
- Built append-only audit event writing for `category.created`, `category.updated`, `category.deleted`, and `category.reordered`.
- Created public unauthenticated storefront endpoint `GET /api/v1/store/categories` with caching and active branch filtering.
- Implemented RTL-ready category management interface in `src/app/admin/catalog/categories/category-manager.tsx` with tree view, create/edit modals, delete protection confirmation, and error handling.
- Added `/admin/catalog/categories` to `staffNavigation`.
- All 32 new unit/integration/component tests and all 318 project-wide tests pass cleanly.

## Spec Change Log

## Review Triage Log

- `medium` -- PATCH /api/v1/admin/catalog/categories route lacks integration test coverage in route.test.ts (route: patch).
- `medium` -- GET /api/v1/admin/catalog/categories/[id] route handler is imported but never executed in route.test.ts (route: patch).
- `medium` -- PUT /api/v1/admin/catalog/categories/[id] successful update path is unexercised in route.test.ts (route: patch).
- `medium` -- Mutating category routes lack negative tests for CSRF token and Origin enforcement (route: patch).
- `medium` -- CategoryManager edit flow is unverified in component tests (route: patch).
- `low` -- Staff navigation menu integration lacks dedicated unit test (route: patch).
- `medium` -- Slug generation fallback from non-ASCII/Arabic names produces empty string without transliteration/cuid fallback (route: patch).
- `medium` -- Reorder categories does not verify existence of category IDs before updating (route: patch).
- `medium` -- Concurrent inserts with identical slug produce uncaught 23505 Postgres error instead of 409 Conflict (route: patch).
- `medium` -- Descendant categories not excluded from parent dropdown in edit category modal (route: patch).
- `low` -- Redundant unique constraint and uniqueIndex definition in schema.ts (route: patch).
- `low` -- Off-by-one depth check in validateParentCycle can fire even if root reached at step 20 (route: patch).

## Design Notes

Cycle prevention algorithm:
Before updating `parentId` of category `C` to new parent `P`:
1. If `P === C.id`, reject immediately (self-parenting).
2. Starting from `P`, walk up ancestor links `parent = parent.parentId`.
3. If at any step `ancestorId === C.id`, reject with cycle error.
4. Bound traversal to max 20 steps to safeguard against corrupted data loops.

