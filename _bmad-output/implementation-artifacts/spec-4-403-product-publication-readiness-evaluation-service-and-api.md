---
title: 'E04-04-03: Product publication readiness evaluation service and API'
type: 'feature'
created: '2026-10-21'
status: 'done'
route: 'dispatch'
baseline_commit: '9b6888595f88052fb4cb5d631fc526a392d10e4c'
review_loop_iteration: 0
story_key: '4-403-product-publication-readiness-evaluation-service-and-api'
context:
  - AGENTS.md
  - _bmad-output/specs/spec-e04-04-publish-slug-redirects-and-seo/SPEC.md
  - _bmad-output/specs/spec-e04-04-publish-slug-redirects-and-seo/implementation-contract.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Staff cannot evaluate all publication prerequisites for a saved product. The existing gallery read reports blank alt text only; a future publish command needs a reusable complete evaluator.

**Approach:** Add a framework-independent readiness service and the contract's authenticated `GET /api/catalog/products/[id]/readiness`. Return `{ isReady, issues }`, where each issue contains `field`, `code`, and `message`, without publishing or editing the product.

## Boundaries & Constraints

**Always:**
- Apply the authoritative implementation contract: trimmed non-empty name and description; valid globally unique slug; at least one variant, with every variant having non-empty SKU and positive price; at least one active gallery attachment, with non-empty trimmed alt text on every active attachment; at least one existing category association.
- Current variants have no active/deleted flag: evaluate all persisted variants. Active attachments mean `removedAt IS NULL`. Category activation is not an additional publication condition in this contract.
- Slug conflicts include another product and another product's redirect source; a product's own slug or redirect source is not a conflict. Reuse existing slug format semantics.
- Successful evaluation returns HTTP 200 even when `isReady` is false. Missing products return 404. Authorize with the existing live catalog staff session helper before querying product data; unauthorized requests retain established 401/403 behavior.
- All responses, including errors, are private/no-store, use the established error envelope, and preserve correlation handling. GET needs no mutation CSRF check.
- Evaluate one consistent database snapshot, and accept root database or transaction context so the next publication story can reuse the evaluator inside its transaction.

**Never:** Add migrations, publish/unpublish actions, media publication, SEO editing, UI, mock authorization, or changes to existing gallery behavior. The evaluator writes no product, media, revision, audit, or operation-key state. Existing session validation may retain its established session maintenance behavior.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Complete product | All gates satisfied | `isReady: true`, empty issues | 200 |
| Incomplete product | Any failed gate | All applicable issues, stable field paths and codes | 200, `isReady: false` |
| Mixed variants | One valid variant and one zero-priced variant | Block on invalid variant despite valid sibling | Variant-specific field |
| Gallery history | Removed image has blank alt, active image has alt | Removed attachment ignored | No false blocker |
| Foreign redirect | Product slug reserved by another product redirect | Slug conflict issue | No mutation |
| Unknown product | Missing ID | No readiness DTO | 404 |
| Denied identity | Guest, customer, revoked or disallowed staff | No product disclosure | 401/403 |

</frozen-after-approval>

## Code Map

- `src/db/schema.ts` — products, variants, productCategories, productMedia and slugRedirects; reuse without schema changes.
- `src/modules/catalog/products/application/product-service.ts` — existing single-statement aggregate snapshot pattern and product-first lock order; leave unchanged.
- `src/modules/catalog/products/application/slug-service.ts` — reuse `isValidSlug`; preserve existing generation and redirects.
- `src/modules/content/settings/infrastructure/admin-auth.ts` — reuse `requireCatalogStaffSession(req, false)` without expanding roles.
- `src/shared/api/error-handler.ts` — existing sanitized API errors; ensure private headers on every response.
- `src/test-utils/db.ts` and `src/test-utils/catalog.ts` — database setup, isolated transactions, real staff session fixture.
- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` — inspected local framework guide; dynamic handlers await promised params.

## Tasks & Acceptance

**Execution:**
- [x] `src/modules/catalog/products/contracts/publication-readiness.ts` — define readiness DTO, issue codes and stable field naming for future consumers.
- [x] `src/modules/catalog/products/application/publication-readiness-service.ts` — implement snapshot read and reusable deterministic evaluator; no write queries or Next.js imports.
- [x] `src/app/api/catalog/products/[id]/readiness/route.ts` — implement the exact contract endpoint with live authorization and private success/error responses.
- [x] `src/modules/catalog/products/application/publication-readiness-service.test.ts` — verify the matrix, all gate failures, multiple simultaneous failures, whitespace, bigint price handling, own versus foreign redirect, cross-product isolation and unchanged persisted state.
- [x] `src/app/api/catalog/products/[id]/readiness/route.test.ts` — verify ready/not-ready responses, missing product, denied identities, auth-before-disclosure, private errors and service failures.

**Acceptance Criteria:**
- Given a complete saved product, when authorized staff request readiness, then the response exactly follows the readiness contract and exposes no private media URLs.
- Given incomplete content, when evaluated repeatedly, then issues identify every blocking field deterministically without changing persisted catalog state.
- Given an existing database transaction, when the evaluator is called with that transaction, then it observes that transaction's product state without creating an independent database connection.

## Implementation Notes

Implemented stable DTO codes, a pure evaluator and one-SELECT database snapshot service, plus authenticated private GET endpoint. Five focused tests passed across service and route suites. Typecheck and targeted ESLint passed. Repository lint has a pre-existing explicit-any error in product-publish-migration.test.ts:49. Build could not fetch existing Google Geist fonts under network restrictions. Full-suite result is pending.

Final verification, 2026-10-21: review patches expanded focused coverage to six passing tests across two suites; independently rerun by the parent. Typecheck passed. Replaced only the existing migration-test catch `any` with an explicit error shape and removed its misplaced suppression; all five tests in that suite passed. Repository lint now exits successfully with six pre-existing warnings. Production build with `npm run build -- --webpack` passed and lists the exact readiness endpoint. Default Turbopack build failed on an inaccessible old `_bmad/render/bmad-build` cache directory after retrying outside sandbox; the initial sandbox run also failed fetching Google fonts. Full-suite attempts produced no final result and were interrupted after prolonged lack of progress, including a source-only run; no full-suite success is claimed. The original attempt logged one provision-owner script test failure without a diagnostic summary. This remains an explicit repository-wide verification limitation, separate from the passing focused suites.

All eight matrix rows have passing coverage: the real persisted ready/not-ready HTTP path; pure aggregate failure cases and invalid sibling; transaction-backed removed history and foreign redirect checks; missing product; denied and expired/revoked identities. Read-only checks include product revision, media, variants, category associations, redirects, audit events and operation keys.

Review corrections changed tests only. No remaining demonstrated implementation defect. Story is implemented; sprint remains `review` for human acceptance, with global verification limitations documented.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence / Resolution |
|---|---|---|---|
| Blind: Verification section versus actual lint/build outcomes | false | reject | Verification lists planned checks and success criteria; Implementation Notes records actual limitations. Final evidence will record outcomes explicitly. A finding whose fix only edits this spec is rejected by the review workflow. |
| Blind: Add concurrent PostgreSQL snapshot test | low | reject | Reader executes one SELECT with correlated subqueries, so the database supplies one statement snapshot. Existing transaction test proves context reuse. A new concurrency harness for a hypothetical multi-query regression adds complexity without a demonstrated race. |
| Blind: Real complete-product HTTP happy path absent | medium | patch | Ready route response currently uses a spy; extend the fixture and use the actual reader for the ready HTTP case. |
| Blind: Audit and operation-key immutability omitted | low | patch | Current catalogState omits these tables; add before/after reads to the existing assertion. Product revision is already included through full product rows. |
| Blind: Expired sessions and forged actor headers untested | low | patch | Existing tests cover absent/customer cookies and revocation only; extend auth test inputs and service-call assertions. |
| Blind: Slug format boundaries absent at evaluator boundary | low | patch | Existing slug-service tests establish the helper policy; add boundary inputs to the evaluator test to protect the consumer integration. |
| Blind: Only-removed gallery absent | medium | patch | Existing fixture has a valid active image alongside history; remove all active attachments in the fixture and assert MISSING_IMAGES. |
| Verification: Persisted active blank alt text absent | medium | patch | Pure evaluation covers blank alt but SQL projection is not exercised with active whitespace alt; extend existing database test with exact field/code assertion. |

Edge-case review returned no findings. No implementation defect was demonstrated; accepted findings strengthen verification coverage without changing the approved contract.

## Design Notes

Intent gaps: none after reading the authoritative contract and existing schema. Irreversibles: none; no migrations, external calls, or live catalog writes. Footprint: six new contract/service/route/test files plus workflow tracking. Use correlated aggregates/existence predicates in a single SELECT to avoid inconsistent multi-query snapshots. Choose explicit stable codes and ID-based variant/image field paths, with deterministic ordering. Database constraints already prohibit some malformed states; exercise these through the pure evaluator rather than weakening constraints. The exact endpoint in the approved contract is added even though older product endpoints live under `/api/v1/admin/catalog`.

## Verification

- Focused Vitest service and route suites: all pass, including database-backed fixtures and privacy checks.
- `npm run lint`: no errors.
- `npm run typecheck`: no errors.
- `npm test`: report actual full-suite results and distinguish pre-existing failures.
- `npm run build`: production build succeeds and includes the new route.
