---
title: 'E04-02: Product and variant drafts'
type: 'feature'
created: '2026-10-12'
status: 'done'
baseline_commit: 'ae6b77ea6d08499d6aa61d997f93ba10d3702aa0'
route: 'dispatch'
review_loop_iteration: 1
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
- `src/shared/idempotency/execute.ts` — Reuse executeIdempotent for authenticated product creation retries; no credential-bearing result.

**Review correction requirements (non-frozen implementation plan):**
- Product aggregate reads must use one SQL statement so concurrent edits cannot mix product/variant/attribute/link versions. Reuse the aggregate selection for lists to eliminate per-product query fan-out; no new pagination surface in this slice.
- Form metadata must expose a pricing revision derived from currency and exponent. Product mutation routes require `X-Pricing-Revision`; the service compares it to the locked authoritative settings row before writing and rejects stale context with 409. This is a precondition, never authority to choose persisted currency.
- When loading a draft or refreshing metadata whose stored/displayed currency differs, show old/new currency and require explicit local review of prices before save. Refresh preserves form contents but must not silently adopt a changed pricing context.
- POST creation accepts `Idempotency-Key` and uses the existing actor-scoped transactional helper when supplied. The UI keeps one key per identical pending create payload across retries and rotates it after payload changes or success. A response lost after commit must replay the same product/audit result.
- Block saving changed dimension text until Generate applies it. Confirm before regeneration drops populated rows, or before New/Edit replaces unsaved changes; cancel preserves the form.
- Render unmatched/nested server field errors in an accessible summary. Category labels must include their parent path. Provide Arabic guidance that price inputs use digits 0–9 and a decimal dot.
- Add positive published+draft public collection assertions, populated matrix regeneration/retained-ID assertions, stale pricing-context rejection, committed-response-loss retry, mixed aggregate read correctness, cancellation and unapplied-dimension tests.

## Tasks & Acceptance

**Execution:**
- [x] `src/db/schema.ts`, `src/db/migrations/0014_product_drafts.sql`, `0014_product_drafts.down.sql`, `meta/_journal.json` — Four tables: products, variants, variant_attributes, product_categories. Draft default, FK/monetary checks, global SKU and per-product combination uniqueness; reversible migration.
- [x] `src/modules/catalog/products/contracts/product.ts` — Strict bounded create/edit schemas; integer-string money DTOs; normalized SKU/attribute combinations; reject lifecycle/stock/currency fields.
- [x] `src/modules/catalog/products/application/product-service.ts` — Atomic draft create/edit and audit; validate categories and attributes; lock edited draft; preserve retained variant IDs; translate uniqueness errors after rollback; published-only public SQL reads.
- [x] `src/modules/catalog/categories/application/category-service.ts` — Reject deletion of categories assigned to products.
- [x] `src/app/api/v1/admin/catalog/products/route.ts`, `[id]/route.ts` — GET collection with form metadata/CSRF, POST create, GET detail, PUT complete edit; authenticated no-store responses using existing envelopes.
- [x] `src/app/api/v1/store/products/route.ts`, `[id]/route.ts` — Minimal published-only list/detail; draft ID returns 404.
- [x] `src/app/admin/catalog/products/page.tsx`, `product-manager.tsx`, `src/modules/identity/application/staff-navigation.ts` — Protected Products list/create/edit, category picker, dimension-to-variant matrix generation and exact decimal price input. Loading/empty/error/success/session-expired feedback; prevent double submission; preserve failed form.
- [x] Adjacent `product.test.ts`, `product-service.test.ts`, `route.test.ts`, `product-manager.test.tsx`, navigation tests — Validate matrix/decimal edge cases, real DB persistence/constraints/rollback/audit, route security and frontend flow. Integrated UI→real API→DB test or browser run verifies save/edit/reload and public isolation.

**Acceptance Criteria:**
- Given authorized staff and valid matrix input, when saving and reloading, then names, description, category links, attributes, SKUs and money persist as Draft with audit and success feedback.
- Given a saved draft, when editing, then the complete update is atomic and audited without lifecycle changes.
- Given duplicate SKU or equivalent attribute combinations, when saving, then clear field errors appear and existing state remains intact.
- Given store currency/exponent, when saving prices, then integer minor units and currency/scale persist and DTO amounts are strings.
- Given drafts, when querying public list/direct ID, then no draft or its variants are returned.
- Given invalid input or unauthorized mutation, when saving, then no partial business or audit changes occur.
- Given an assigned category, when deleting, then a clear conflict preserves the association.
## Implementation Notes

- Final corrections: product-only request budget is 256 KiB; malformed Unicode, unsupported matrix delimiters and normalized __proto__ keys are rejected before persistence. Known validation messages are localized, currency-reversal review state recovers, and category lookup uses an ID map. POST validates the contract before idempotency hashing so keyed/unkeyed invalid requests consistently return 422 field errors.
- Real PostgreSQL verification uses an independently generated schema with explicitly isolated per-connection search paths; all existing migrations are applied only in that namespace. Four independent-connection snapshot/locking scenarios passed and the schema was removed. Existing application rows/schema were not migrated or changed. Existing local PostgreSQL was started without reinitialization after the interrupted session.
- Review iteration 1 corrections implemented: single-statement correlated JSON aggregates (minor units cast to text), pricing revision preconditions and explicit currency review, actor-scoped create idempotency, dimension application guards, destructive-change confirmations, Arabic field summaries/price guidance, breadcrumb categories. Focused corrected tests, typecheck and lint pass; final route/UI rerun passes 16 tests. Final full-suite/build verification follows.
- Implemented the original E04-02 scope; refreshed epic context describes alternative numbering and did not override the human decision.
- Four-table migration 0014 includes bigint money, normalized globally unique SKU, per-product combination uniqueness and restrictive category references. Draft edits lock the product and replace rows transactionally while preserving retained variant IDs, allowing SKU/combination swaps.
- Product requests use a bounded 128 KiB body to support a 100-row matrix; other endpoints retain the shared 8 KiB default.
- Category deletion now locks the category before checking product assignments; product save takes key-share locks on categories to serialize association/deletion races.
- UI integration tests render the real component and connect its fetch calls to real route handlers, staff sessions and migrated PGlite. No live-browser or external PostgreSQL run is claimed.
- Existing full-suite media tests deleted four tracked PNG fixtures; restored those exact files from HEAD. Existing provisioning test restricts temporary-directory ACLs and cannot clean up under sandbox; its isolated elevated rerun passed. No live-store migration, commit, push or deployment performed.

## Spec Change Log

- Review iteration 1: Currency-context races and multi-statement aggregate reads exposed gaps in the implementation plan; creation retry lacked ambiguous-response recovery. Added pricing revision preconditions, single-statement aggregates and existing idempotency-helper integration. KEEP the four-table migration, normalized SKU/combination constraints, draft-only transactional writes and audit, retained IDs/SKU swaps, category deletion locks, private CSRF/session protection, exact money parsing, public filtering, Arabic UI, and all passing integration/migration tests. Prior implementation is preserved as a reference at `C:/Users/User/AppData/Local/Temp/e04-02-review-e397b603c4814927a27f8eb7551a508d.patch`; restore its positive implementation and amend the demonstrated defects, rather than inventing new architecture.
## Review Triage Log

- Final patch verification: all retained review corrections implemented and executed. Root added a keyed/unkeyed invalid-Unicode route regression; both return 422 before idempotency serialization. No unresolved E04-02 finding remains.
- Root pre-existing finding — medium / defer: staff-auth.test.ts regenerates a current 30-second TOTP for the replay assertion, so crossing a time-step boundary legitimately yields a new accepted code. Final full run exposed the flake once; isolated rerun passed all 20 unchanged auth tests. Record separately rather than widening this catalog story into authentication changes.
- pass2 blind-1 — low / rejected complexity: Row locks provide serialized last-writer-wins full-draft edits. Stale-editor conflict policy is not required by this story; adding an expected product revision introduces a new API/UI surface for a rare simultaneous editing case.
- pass2 blind-2 — medium / patch: Maximum valid multibyte matrices can exceed 128 KiB. Raise the bounded product-only budget to 256 KiB and verify a maximum Unicode matrix plus oversized rejection.
- pass2 blind-3 — medium / patch: Unpaired UTF-16 surrogates can reach audit JSON and yield inconsistent 400/500 instead of field validation. Reject malformed Unicode in all product text/attribute/identifier contracts.
- pass2 blind-4 — medium / patch: Colon/comma attribute delimiters cannot round-trip through the matrix text editor. Validate unsupported name/value delimiters consistently at API and matrix boundaries with field errors.
- pass2 blind-5 — low / patch: Currency change followed by reversal leaves the review flag stuck. Set it from the actual revision comparison on every metadata refresh.
- pass2 blind-6 — low / rejected complexity: New/Edit unsaved replacement is protected; general page navigation/unload persistence is not a story requirement and introduces additional navigation lifecycle handling for browser dismissal.
- pass2 blind-7 — false: Every external product mutation route requires and passes pricing revision. Internal service callers supply already-denominated minor units under authoritative settings, with no displayed pricing context to invalidate; no reachable unguarded external caller exists.
- pass2 blind-8 — medium / patch: Current serial/count tests do not exercise actual PostgreSQL concurrency. Add a scoped concurrency verification against an isolated schema on local PostgreSQL, since the local app account cannot create a separate test database; never modify existing application schema/data.
- pass2 blind-9 — low / patch: Shared API errors are English; translate known product validation messages to Arabic in the form while keeping useful detail for unknown errors.
- pass2 blind-10 — low / patch: Category path computation rescans the list for every ancestor. Build an ID map before walking parent chains.
- pass2 edge-1 — medium / patch: Zod record parsing drops __proto__ dimension keys. Reject that normalized name before record parsing and matrix generation, preserving clear validation failure.
- pass2 gap-1 — medium / patch: One-select spying misses separate execute calls and does not overlap readers/writers. Actual isolated PostgreSQL concurrent aggregate verification closes this gap.
- blind-1 — high / bad_spec: UI displays persisted scale but submits under current settings, and service always overwrites currency; confirmed silent reinterpretation. Require explicit pricing-context validation/review.
- blind-2 — medium / bad_spec: Four independent SELECTs can straddle a committed edit; aggregate consistency needs a single statement.
- blind-3 — low / rejected complexity: Unbounded list length is real, but no measured load failure exists in this draft-only slice; pagination introduces a new API/UI surface. Query fan-out is removed with aggregate selection; pagination remains outside this correction.
- blind-4 — medium / bad_spec: A response lost after committed create leaves create mode and retry gets SKU conflict. Reuse existing idempotency for recovery.
- blind-5 — medium / patch: Changed attribute combinations discard populated rows/IDs in regeneration. Confirm before destructive regeneration and preserve cancellation.
- blind-6 — medium / patch: Dimension edits are not applied until Generate, yet Save succeeds. Block save while unapplied.
- blind-7 — medium / patch: New/Edit replaces unsaved form without a choice. Confirm replacement, preserving state on cancellation.
- blind-8 — medium / patch: Only exact feedback keys render; nested errors have no visible detail. Add accessible summary for unmatched errors.
- blind-9 — medium / patch: Flat category labels cannot distinguish equal child names. Return breadcrumb labels through existing name field.
- blind-10 — low / patch: Arabic price form gives no ASCII decimal guidance. Add explicit Arabic guidance beside inputs.
- edge-1 — high / bad_spec: A settings change after form GET is unguarded inside save transaction. Pricing revision comparison against locked settings prevents this.
- edge-2 — medium / bad_spec: Aggregate reads can mix committed versions; same underlying defect as blind-2.
- gap-1 — medium / patch: Public collection tests only verify draft absence; add positive published collection fixture with price/variants.
- gap-2 — medium / patch: Existing UI tests generate before populating rows; add regeneration assertions for SKU, prices, comparison and retained IDs.
## Verification

**Final evidence, 2026-10-14 (supersedes earlier run notes below):**
- `npm.cmd run typecheck` — passed; final production build also passed its TypeScript check.
- `npm.cmd run lint` — zero new errors; existing Upload.tsx img warning only.
- `npm.cmd run build` (outside sandbox for existing Google Fonts downloads) — passed and includes new protected Products page and admin/store collection/detail routes.
- `npm.cmd test` (elevated) — 382 passed on the complete post-review run; after the final POST-validation change, 381 passed and one unchanged timing-sensitive TOTP replay test failed. `npm.cmd test -- src/modules/identity/infrastructure/staff-auth.test.ts` then passed all 20 tests. All 382 executable tests have passing evidence; one pre-existing skip and one todo remain.
- `npm.cmd test -- src/app/api/v1/admin/catalog/products/route.test.ts src/app/admin/catalog/products/product-manager.test.tsx` — final route/UI rerun: 18 passed, including field errors with/without idempotency keys, complete matrix save/edit/remount, retries and public isolation.
- `npx.cmd tsx scripts/verify-product-concurrency.ts` — four actual PostgreSQL concurrency groups passed: complete aggregate versions, stale currency after lock wait, deletion-before-assignment rejection and assignment-before-deletion protection. Generated isolated schema removed.
- `git diff --check` — passed. Two review passes triaged every finding; all catalog fixes verified. Existing TOTP test timing flake deferred; no live-browser run or application-database migration claimed.

- Initialization: exact skill command succeeded with exit code 0 and returned the snapshot workflow path.
- `npm.cmd run typecheck` — passed after final implementation/tests.
- `npm.cmd run lint` — passed with zero errors and the existing Upload.tsx img warning.
- `npm.cmd test` — final sandbox run: 368 passed, one provisioning cleanup EPERM failure, one existing skip and one existing todo; 56 passed test files. All E04-02 and migration tests passed.
- `npm.cmd test -- scripts/provision-owner.test.ts` (elevated) — one test passed; resolves the sole sandbox-only cleanup failure. Combined executed suite evidence: 369 passing tests.
- Migration runner expectations updated for 0014; dedicated apply/down/reapply test verifies all four tables and Draft default.

**Executed matrix coverage:**
- Create/edit draft: route `creates, reads, updates and reloads...` and UI `saves a generated matrix...` verify persisted product, links, attributes, prices, retained IDs, audits, and remount reads.
- Simple product: service `leaves all business and audit state intact...`, route create/edit, and UI retry flow save a single default variant.
- Collision: contract `detects equivalent unordered combinations...`, service invalid-create/edit and database-time collision tests, route conflict test and UI SKU conflict/retry test.
- Invalid data: contract required fields/malformed money/dimensions tests and route `rejects malformed amounts...`; service validates missing categories and foreign variant IDs without mutation.
- Optional compare price: contract ordering test and UI create flow cover absence, valid comparison and rejection below regular price; DB money checks covered.
- Public read: service, route and integrated UI flows assert omitted list entries and direct-ID 404; published service fixture demonstrates a positive filtered read.
- Unauthorized mutation: route security test covers unsupported role, Origin/CSRF and absent/expired/revoked/disabled sessions; UI expiry test retains form and recovers.
- Failed save: UI `keeps entered values...` covers decimal error, server conflict and network failure followed by successful retry; double-submit test confirms only one request.


