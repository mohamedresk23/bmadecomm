# E04-04-03 Human Walkthrough

Date: 2026-10-21
Commit: `7fbf9a9`
Baseline: `9b6888595f88052fb4cb5d631fc526a392d10e4c`
Story: `4-403-product-publication-readiness-evaluation-service-and-api`
Decision: **APPROVED** by the user on 2026-10-21 ("اعتمد و ابدا التنفيذ").
Sprint status: **done** following explicit human acceptance.
Spec: `_bmad-output/implementation-artifacts/spec-4-403-product-publication-readiness-evaluation-service-and-api.md`

## Intent

**Problem:** Staff cannot evaluate all publication prerequisites for a saved product. The existing gallery read reports blank alt text only; a future publish command needs a reusable complete evaluator.

**Approach:** Add a framework-independent readiness service and the contract's authenticated `GET /api/catalog/products/[id]/readiness`. Return `{ isReady, issues }`, where each issue contains `field`, `code`, and `message`, without publishing or editing the product.

## Scope and evidence

The commit changes 10 files (+411/-39): contract, service, API, two focused suites, migration-test typing cleanup, and four tracking/context documents. HEAD matches the reviewed commit. An unrelated untracked missing-slug-column spec was left untouched. The review trail below was generated from the code because the spec has no Suggested Review Order.

This walkthrough inspected source and recorded verification evidence; it did not rerun tests, build, or perform the manual observations below. Recorded results are six readiness tests (four service, two route) plus five migration tests, not eleven readiness-only tests. Recorded TypeScript, ESLint and Webpack build checks pass; repository-wide tests did not finish and the default Turbopack build failed. See `deferred-work.md`. The sprint was `review` during inspection and changed to `done` after the explicit human approval recorded above.

## Generated review trail and design decisions

1. Protected entry point: `src/app/api/catalog/products/[id]/readiness/route.ts:11`. Live staff authorization runs before params are consumed or the product reader is called. Existing allowed roles are owner, staff, catalog_manager and catalog; client identity headers do not authorize. GET disables mutation CSRF validation because it does not change catalog state.
2. Private response boundary: `src/app/api/catalog/products/[id]/readiness/route.ts:17`. Success and wrapped errors receive private/no-store and no-cache headers. Supplied correlation IDs are preserved. Known errors use the established envelope; unexpected failures return a sanitized 500. DTOs contain no media URLs. Session resolution can still lock/update session state under the existing authentication policy.
3. Stable consumer contract: `src/modules/catalog/products/contracts/publication-readiness.ts:2` and `src/modules/catalog/products/application/publication-readiness-service.ts:20`. Every failed gate is reported, using deterministic gate order and lexical ID order. Variant/image paths use persistent IDs rather than list positions. Incomplete evaluations return 200 with isReady=false; 422 belongs to the future failed publication command.
4. Consistent read: `src/modules/catalog/products/application/publication-readiness-service.ts:42`. One SELECT with correlated aggregates/existence predicates supplies one statement snapshot. It uses the supplied root DB or transaction without opening an independent transaction. It requests no explicit catalog row locks and writes no catalog state. PostgreSQL ordinary SELECT still takes normal relation locks; this is not a promise of zero waiting.
5. Slug ownership: `src/modules/catalog/products/application/publication-readiness-service.ts:25` and `:45`. Existing strict slug validation is reused without normalization or repair. Both foreign product slugs and foreign redirect sources block readiness; owned redirects do not. This service does not follow, create, collapse or retire redirects.

## Human attention points

- Authorization precedes product disclosure; failed staff authorization must not distinguish existing from missing product IDs.
- A snapshot is an assessment at read time, not a publication reservation. E04-04-04 must re-evaluate inside its mutation transaction and establish appropriate locking/serialization for all competing writers. Merely passing a transaction does not freeze future statements at READ COMMITTED.
- The existing product/media lock-order follow-up remains deferred; this evaluator does not repair it or introduce a new product/media lock order.
- All persisted variants are evaluated because the schema has no active/deleted variant flag. One invalid sibling blocks the product.
- Gallery activity means attachment removedAt IS NULL. Pending media does not block this contract, and inactive associated categories satisfy category membership. These are deliberate contract semantics for human acceptance.
- A database uniqueness constraint prevents many malformed persisted slug states. Pure evaluation covers format boundaries; do not weaken schema constraints to manufacture manual cases.

## Optional manual observation guide

Use disposable local catalog fixtures and a legitimately authenticated staff browser session. Start the application with `npm run dev` if needed. In the browser console on the same origin:

```javascript
const id = "REPLACE_WITH_LOCAL_PRODUCT_ID";
const response = await fetch(`/api/catalog/products/${encodeURIComponent(id)}/readiness`, {
  cache: "no-store",
  headers: { "x-correlation-id": "walkthrough-e04-04-03" }
});
console.log(response.status, Object.fromEntries(response.headers), await response.json());
```

1. Complete/incomplete product: inspect a complete saved fixture, then save a blank description or incomplete gallery using supported local tools and repeat. Expect 200 in both cases, an empty issue array only for the complete fixture, and stable field/code/message blockers otherwise. Repeated reads should preserve ordering and catalog state.
2. Denied identities: repeat for existing and missing IDs while signed out, customer-authenticated, or using expired/revoked staff sessions. Expect 401; valid support-only staff expect 403. Forged role headers must not grant access. Authorized staff requesting a missing ID get 404.
3. Gallery history and ownership: a removed blank-alt attachment alongside a valid active attachment should not block. Active whitespace alt should report gallery.<attachment-id>.altText/MISSING_ALT_TEXT. Removing all active attachments should report gallery/MISSING_IMAGES. Images/variants on another product cannot satisfy this product's gates.
4. Slug/variant boundaries: in isolated fixtures, an owned redirect source matching the current slug is allowed; transfer redirect ownership to another product and expect slug/SLUG_CONFLICT. One zero-priced sibling blocks despite another valid variant. Blank SKU blocks its own ID path. Use the pure evaluator for invalid slugs or states forbidden by DB constraints.
5. Privacy, errors and consistency: inspect headers/body for 200/401/403/404 and, in a controlled test harness, a forced service failure (500). Expect private/no-store, no-cache, supplied correlation ID, sanitized errors and no private media URLs. Compare catalog rows before/after repeated GETs, excluding permitted session maintenance. For transaction reuse, call the service with an isolated transaction after uncommitted fixture edits; expect those edits to be visible. Roll back the fixture transaction afterwards.

## Edge-case evidence map

| Case | Expected observation | Existing evidence |
|---|---|---|
| Complete and incomplete persisted products | 200, exact DTO, all applicable blockers | `src/app/api/catalog/products/[id]/readiness/route.test.ts:18` |
| Whitespace name/description/SKU/alt; empty variants/gallery | Specific stable codes, no input mutation | `src/modules/catalog/products/application/publication-readiness-service.test.ts:13` |
| Valid and zero-price siblings; bigint maximum | Invalid sibling blocks; positive bigint remains valid | `src/modules/catalog/products/application/publication-readiness-service.test.ts:29` |
| Empty/leading/trailing/repeated hyphens; 255/256 chars | Strict format and length boundaries | `src/modules/catalog/products/application/publication-readiness-service.test.ts:36` |
| Caller transaction; removed/active images; inactive category | Own transaction visible; only active attachments checked; membership sufficient | `src/modules/catalog/products/application/publication-readiness-service.test.ts:44` |
| Own/foreign redirect; cross-product isolation | Own allowed, foreign conflict, unrelated data excluded | `src/modules/catalog/products/application/publication-readiness-service.test.ts:52` |
| No catalog writes | Product/revision, variants, media, associations, redirects, audit and operation keys unchanged | `src/modules/catalog/products/application/publication-readiness-service.test.ts:53` |
| Missing product and sanitized service failure | Private 404/500, correlation and standard envelope | `src/app/api/catalog/products/[id]/readiness/route.test.ts:35` |
| Guest/customer/forged role/support/expired session | 401/403 before service invocation | `src/app/api/catalog/products/[id]/readiness/route.test.ts:62` |
| Revoked session | 401 | `src/app/api/catalog/products/[id]/readiness/route.test.ts:55` |

## Human acceptance checklist

- [x] Accept live catalog-role authorization, disclosure ordering and private response behavior.
- [x] Accept complete gate semantics, deterministic ID paths and HTTP 200 for an incomplete assessment.
- [x] Accept snapshot-at-read behavior and the future publication transaction/locking responsibility.
- [x] Accept own-versus-foreign slug/redirect handling without redirect mutations.
- [x] Accept active-attachment, all-variant and category-membership semantics.
- [ ] Perform optional manual observations and record their results (not reported as executed).
- [x] Accept the recorded full-suite/default-build limitations.
- [x] Provide explicit Approve: user approved on 2026-10-21.

The user explicitly approved the reviewed commit and authorized starting the next implementation. The optional manual observations above are not claimed as executed. Recorded full-suite and default-build limitations remain deferred. Checklist items above describe the review criteria, not individually reported manual executions.
