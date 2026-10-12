---
title: 'E04-02: Product and variant drafts'
type: 'feature'
created: '2026-10-12'
status: 'in-progress'
baseline_commit: 'ae6b77ea6d08499d6aa61d997f93ba10d3702aa0'
route: 'dispatch'
review_loop_iteration: 0
context:
  - AGENTS.md
  - _bmad-output/implementation-artifacts/epic-4-context.md
---

<frozen-after-approval reason="human-owned intent â€” do not modify unless human renegotiates">

## Intent

**Problem:** Staff cannot create or edit products with priced, uniquely identified variants as private catalog drafts.

**Approach:** Deliver the original E04-02 Product and variant drafts as one transactional full-stack slice. Human decision on 2026-10-12: option 1 (original story numbering) governs this implementation, rather than the proposed decomposed category story.

## Boundaries & Constraints

**Always:** Reuse existing catalog staff-session/role checks, Origin/CSRF protection, bounded JSON, field-error envelopes, transactional audit writing, and RTL admin patterns. Persist products, variants, variant attributes and category links atomically. Draft is server-owned default; accept only draft editing. SKU is globally unique and normalized consistently; attribute combinations are unique per product regardless of property order. Money is nonnegative integer minor units plus persisted currency/scale derived from store settings; API amounts are integer strings. Use exact decimal parsing in the form, never floating-point price conversion. Read installed Next.js guides before code changes. Verify actual user-flow persistence and report limitations.

**Never:** Add stock, cost, media, publishing, SEO, product deletion, duplication, archive controls, or a new role/grant subsystem. Trust client status/currency/authorization claims or expose drafts through public product reads.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected behavior | Error handling |
|---|---|---|---|
| Create/edit draft | Name, description, existing category IDs, one or more variant rows with SKU, price and attributes | Persist complete Draft and audit; reload reproduces it | 201 create / 200 edit |
| Simple product | One SKU/price, no attributes | One default variant | Standard field validation |
| Collision | Existing SKU, repeated SKU within request, or duplicate normalized attribute combination | No partial product/link/variant/audit changes | 409 SKU conflict / 422 combination error |
| Invalid data | Missing name/category/variants, unknown category, negative/fractional/overflow amount, inconsistent attribute dimensions | No mutation | 422 field errors |
| Optional compare price | Absent or at least regular price | Persist same currency/scale | 422 if below regular price |
| Public read | Draft ID or list request | Draft omitted; direct lookup 404 | No private metadata |
| Unauthorized mutation | Missing/expired/revoked session, unsupported role, bad Origin/CSRF | No mutation | 401/403 |
| Failed save | Validation, conflict or network failure | Keep entered values; permit correction/retry | Accessible field/global error |

</frozen-after-approval>

## Code Map

- `src/db/schema.ts`, `src/db/tx.ts` — Existing categories/store settings; use withTransaction.
- `src/modules/catalog/categories/application/category-service.ts` — Reuse audit/constraint translation; add assigned-product deletion guard.
- `src/modules/content/settings/infrastructure/admin-auth.ts` — Current catalog roles, session, Origin and CSRF checks. E02-02 grant subsystem is absent; do not introduce it here.
- `src/modules/content/settings/application/store-settings.ts` — Authoritative currency/exponent.
- `src/app/api/v1/admin/catalog/categories/route.ts`, `[id]/route.ts` — Bounded JSON, Zod field errors, correlation IDs, private responses.
- `src/app/admin/catalog/categories/category-manager.tsx`, `page.tsx` — Arabic RTL, protected page, local form and feedback conventions.
- `src/shared/api/client.ts`, `src/shared/authz/audit.ts` — API error mapping and transactional audit.

## Tasks & Acceptance

**Execution:**
- [ ] `src/db/schema.ts`, `src/db/migrations/0014_product_drafts.sql`, `0014_product_drafts.down.sql`, `meta/_journal.json` — Four tables: products, variants, variant_attributes, product_categories. Draft default, FK/monetary checks, global SKU and per-product combination uniqueness; reversible migration.
- [ ] `src/modules/catalog/products/contracts/product.ts` — Strict bounded create/edit schemas; integer-string money DTOs; normalized SKU/attribute combinations; reject lifecycle/stock/currency fields.
- [ ] `src/modules/catalog/products/application/product-service.ts` — Atomic draft create/edit and audit; validate categories and attributes; lock edited draft; preserve retained variant IDs; translate uniqueness errors after rollback; published-only public SQL reads.
- [ ] `src/modules/catalog/categories/application/category-service.ts` — Reject deletion of categories assigned to products.
- [ ] `src/app/api/v1/admin/catalog/products/route.ts`, `[id]/route.ts` — GET collection with form metadata/CSRF, POST create, GET detail, PUT complete edit; authenticated no-store responses using existing envelopes.
- [ ] `src/app/api/v1/store/products/route.ts`, `[id]/route.ts` — Minimal published-only list/detail; draft ID returns 404.
- [ ] `src/app/admin/catalog/products/page.tsx`, `product-manager.tsx`, `src/modules/identity/application/staff-navigation.ts` — Protected Products list/create/edit, category picker, dimension-to-variant matrix generation and exact decimal price input. Loading/empty/error/success/session-expired feedback; prevent double submission; preserve failed form.
- [ ] Adjacent `product.test.ts`, `product-service.test.ts`, `route.test.ts`, `product-manager.test.tsx`, navigation tests — Validate matrix/decimal edge cases, real DB persistence/constraints/rollback/audit, route security and frontend flow. Integrated UI→real API→DB test or browser run verifies save/edit/reload and public isolation.

**Acceptance Criteria:**
- Given authorized staff and valid matrix input, when saving and reloading, then names, description, category links, attributes, SKUs and money persist as Draft with audit and success feedback.
- Given a saved draft, when editing, then the complete update is atomic and audited without lifecycle changes.
- Given duplicate SKU or equivalent attribute combinations, when saving, then clear field errors appear and existing state remains intact.
- Given store currency/exponent, when saving prices, then integer minor units and currency/scale persist and DTO amounts are strings.
- Given drafts, when querying public list/direct ID, then no draft or its variants are returned.
- Given invalid input or unauthorized mutation, when saving, then no partial business or audit changes occur.
- Given an assigned category, when deleting, then a clear conflict preserves the association.
## Implementation Notes


## Spec Change Log

## Review Triage Log

## Verification

- Initialization: exact skill command succeeded with exit code 0 and returned the snapshot workflow path.
- Application checks after scope resolution: `npm run typecheck`, `npm run lint`, appropriate Vitest/API/database/component checks, and complete user-flow verification. No E04-02 implementation tests have run yet.


