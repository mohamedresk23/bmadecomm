---
title: 'E04-04-04: Atomic product publish and unpublish'
type: 'feature'
created: '2026-10-21'
status: 'done'
route: 'dispatch'
baseline_commit: '7fbf9a95080d03a1998f6ac624c715e58774106d'
review_loop_iteration: 0
story_key: '4-404-publish-and-unpublish-actions-with-atomic-state-transitions-and-audit-logging'
context:
  - AGENTS.md
  - _bmad-output/specs/spec-e04-04-publish-slug-redirects-and-seo/implementation-contract.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Staff can assess readiness but cannot perform audited publication transitions.

**Approach:** Add protected POST publish/unpublish endpoints and a transactional service that rechecks readiness and commits status and audit together.

## Boundaries & Constraints

**Always:**
- Authenticate live catalog staff and enforce existing mutation CSRF/Origin checks before parsing or disclosure. Accept only a bounded JSON empty object.
- Lock product FOR UPDATE first; evaluate readiness in a separate statement afterwards using the same transaction and unchanged E04-04-03 gates.
- Block ineligible drafts with 422 PUBLICATION_READINESS_FAILED and field/code/message issue details in the standard error envelope. No partial catalog/audit writes.
- Unpublish without readiness checks. Missing products return 404; archived products 409. Same-target requests return 200 without timestamp, updatedAt or audit changes.
- Real transitions update status/updatedAt and write one product.publish/product.unpublish audit with staff actor, correlation ID and minimal status/timestamp diff. Audit failure rolls back everything.
- Human-approved timestamp policy (2026-10-21): on publication set published_at to its existing value or the current time when null; preserve the original first-publication value on unpublish and all later republish operations.
- Return the authenticated product summary envelope. Every response is private/no-store with correlation handling; generate correlation IDs when absent. Unexpected errors are sanitized.

**Never:** Add migrations, UI, public resolution, media publication, storage effects or inventory changes. Preserve slug, redirects, gallery, revision and associations. Leave the unrelated untracked missing-slug spec unchanged and exclude it from commits.

## I/O & Edge-Case Matrix

| State / Input | Outcome |
|---|---|
| Eligible draft / publish | 200 published, timestamp policy, one audit |
| Ineligible draft / publish | 422 issues; unchanged |
| Published / unpublish | 200 draft, timestamp policy, one audit |
| Already target / repeat | 200 unchanged; no audit |
| Missing / archived | 404 / 409 |
| Guest, customer, revoked, forbidden role, invalid CSRF | 401/403 before disclosure |
| Malformed/extra fields/oversized/non-JSON body | 400/413/415 |
| Audit failure | 500 sanitized, complete rollback |
| Concurrent aggregate edit | Wait for lock; evaluate committed facts |

</frozen-after-approval>

## Code Map

- `src/modules/catalog/products/application/publication-readiness-service.ts`: reuse getPublicationReadiness(tx,id).
- `src/modules/catalog/products/application/product-service.ts`: reuse getProductById; product edits lock parent first.
- `src/modules/catalog/products/application/gallery-service.ts`: gallery writers also lock parent first; retain Draft-only rules.
- `src/db/tx.ts`, `src/shared/authz/audit.ts`: reuse transactions/savepoints and writeAudit.
- `src/shared/api/errors.ts`, `src/shared/api/error-handler.ts`: standard envelope; retain issue codes in details.
- `src/shared/api/bounded-json.ts`, `src/modules/content/settings/infrastructure/admin-auth.ts`: bounded body and requireCatalogStaffSession(req,true).
- `src/test-utils/catalog.ts`, `src/test-utils/db.ts`: live sessions and isolated fixtures.
- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`: read; promised params, uncached POST.

## Tasks & Acceptance

**Execution:**
- [x] `src/modules/catalog/products/application/publication-service.ts`: locked transitions, gate, no-op and atomic audit.
- [x] `src/modules/catalog/products/contracts/publication.ts`: strict request and failure contracts.
- [x] `src/modules/catalog/products/infrastructure/publication-handler.ts`: shared private/authenticated adapter.
- [x] `src/app/api/catalog/products/[id]/publish/route.ts`, `src/app/api/catalog/products/[id]/unpublish/route.ts`: exact POST endpoints.
- [x] `src/modules/catalog/products/application/publication-service.test.ts`: matrix, timestamp policy, rollback, aggregate immutability.
- [x] `src/app/api/catalog/products/[id]/publish/route.test.ts`: both commands, live auth/CSRF, validation, privacy, errors.
- [x] `src/modules/catalog/products/application/publication.postgres.test.ts`: dedicated database/random schema, concurrent commands/writers and rollback.

**Acceptance Criteria:**
- Given an eligible draft and authorized staff, when publishing, then status and audit commit atomically.
- Given competing commands or edits, when transitioning, then serialized facts determine the result without duplicate audits.
- Given rejection, when inspecting state, then no partial transition or media exposure exists.

## Implementation Notes

Implemented strict POST adapters and parent-locked transactional transitions. Added optional code to shared ErrorDetail so readiness issues survive standard error serialization. Added src/test-utils/publication.ts to share isolated ready fixtures.

Verification on 2026-10-21: implementation agent passed 27 publication/readiness/product tests, 85 gallery/variant-image tests, seven PostgreSQL tests, typecheck, lint (six existing warnings) and Webpack production build with both routes. Parent independently reran all seven new service/API tests and all seven PostgreSQL tests successfully, inspecting verbose output against every matrix row. PostgreSQL used a newly provisioned dedicated local bmadecomm_test database and disposable random schemas; application data/environment files were not modified. Full suite reached its 180-second bound with only the RUN banner; no global success is claimed. Default Turbopack limitation remains deferred. The forbidden untracked spec hash remains unchanged.

Review corrections completed: correlated unexpected-error logging, explicit updatedAt transition assertions, expired-session/existing-ID denial coverage, nonempty attribute/mapping/operation-key preservation, full initial no-op row comparison and controlled editor-rollback concurrency. The earlier story's walkthrough acceptance record was reconciled without claiming manual observations were performed. Parent reran the combined seven-file regression selection: 112 tests passed; PostgreSQL publication suite: eight tests passed. Typecheck and repository lint passed after corrections (same six existing warnings).

Final parent Webpack production build passed after review corrections and listed both exact publication endpoints as dynamic routes. Implementation is complete; sprint remains review for human acceptance. Full-suite timeout and the previously documented default-Turbopack limitation are not claimed resolved.

Matrix audit: eligible/ineligible/unpublish/repeat/missing/archived rows are exercised by the service and API suites; identity/CSRF and malformed/oversized/non-JSON rows by both-command API loops; audit failure by service/API and PostgreSQL trigger injection; concurrent edits by real product/gallery writers and explicit lock-wait observation. All covering suites ran successfully; no disabled or skipped tests were counted.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence / Resolution |
|---|---|---|---|
| Blind: Unexpected HTTP exceptions are silently discarded | medium | patch | The new adapter catches unknown errors without the existing shared handler's correlated console.error. Restore diagnostic logging while retaining sanitized responses. |
| Blind: Reverse competing product edit not exercised | false | reject | saveProduct already allows edits to published products and locks the parent first; this story preserves that behavior. No permanent readiness invariant is promised after a later edit; the existing product-service regression explicitly tests published editing. |
| Blind: Waiting publisher after editor rollback untested | low | patch | Commit-after-wait is covered but rollback-after-wait is not. Add a controlled rollback case to the existing PostgreSQL harness. |
| Blind: Preservation snapshot omits variant attributes/mappings and operation keys | low | patch | Current snapshots omit these records. Add nonempty fixtures and include them in before/after assertions. |
| Blind: Expired sessions and existing-ID denial absent | low | patch | The route suite covers revoked sessions and denied missing IDs only. Extend existing auth tests with expired sessions and both IDs. |
| Blind: Initial draft no-op lacks full-row assertion | low | patch | Only timestamp-null/audit are checked for the initial no-op. Compare complete persisted product rows. |
| Blind: Prior walkthrough approval record still says review | low | patch | The introduction records approval but a historical paragraph/checklist remains ambiguous. Reconcile accepted criteria while preserving unperformed manual observations. |
| Verification: Real transitions do not assert updatedAt advances | medium | patch | Existing transition assertions would pass if updatedAt were omitted. Add controlled distinct transition times and persisted/returned timestamp assertions. |

Edge-case reviewer returned no findings.

## Design Notes

Intent gaps: none after explicit human approval of the first-publication timestamp policy. No migration, deployment or live-data execution. Footprint: service, contract, adapter, two routes and tests. Separate lock acquisition from snapshot reading to avoid pre-wait stale facts. Current product/gallery writers share the parent lock; this does not guarantee permanent readiness after future edits. Category deletion rejects assigned categories. No new slug claim or redirect write is introduced.

## Verification

Run focused service/API, readiness/product/gallery regressions, real PostgreSQL concurrency tests, typecheck, lint and Webpack build. Attempt a bounded full suite; report actual outcomes and setup limitations. Existing full-suite/default-Turbopack limitations remain explicit.
