# E04-03-06 verification

Date: 2026-10-19. Local development only; no production migration or deployment.

Implemented optional shared variant image mappings with same-product restrictive foreign keys, atomic gallery replacement, order-independent mapping no-ops, primary/null fallback (verified by service tests), and preservation across retained-ID variant replacement. Removed variants clear mappings and increment the gallery revision once inside the product transaction and product audit.

The editor presents saved variant IDs with SKU/attribute labels. Generated rows receive selectors after saving. Browser evidence covers fallback selector state; actual explicit/primary/null resolution is verified by service tests. Product and gallery writes are coordinated; product saves refresh gallery metadata. Dirty local order/alt/mappings keep their reviewed snapshot and original revision when mapping changes arrive. Explicit discard is applied only after a successful refresh; failed/null refreshes preserve local work. Cleared assignments are announced.

## Executed checks

- `npm.cmd test -- src/modules/catalog/products/contracts/gallery.test.ts src/modules/catalog/products/application/variant-images.test.ts src/modules/catalog/products/application/product-service.test.ts "src/app/admin/(workspace)/catalog/products/product-gallery.test.tsx" "src/app/admin/(workspace)/catalog/products/product-manager.test.tsx" "src/app/api/v1/admin/catalog/products/[id]/images/route.test.ts"`: **133 passed, six files**.
- Real PostgreSQL: `vitest run --config vitest.postgres.config.ts src/modules/catalog/products/application/variant-images.postgres.test.ts src/modules/catalog/products/application/gallery-reorder.postgres.test.ts`: **17 passed, two files**. `TEST_DATABASE_URL` was derived privately from local development credentials with the database changed to the dedicated `bmadecomm_gallery_reorder_test`; each suite creates and removes a random isolated schema.
- `npm.cmd run typecheck`: passed.
- `npm.cmd run lint`: passed with the existing `src/components/Upload.tsx` image-element warning.
- `npm.cmd run build`: reproduced the existing Windows Turbopack ACL failure reading `.local/owner-setup` through media storage directory tracing. No ACL or storage policy was changed.
- `npm.cmd run build -- --webpack`: passed; final rebuild after audit metadata and announcement changes also executed.
- Authenticated Edge browser: `scripts/verify-variant-images-browser.ts` passed all journeys at **320, 768, 1024, 1440px RTL**. Evidence: `.local/variant-images-browser-verification.json`. Server-side session fixtures and a random disposable schema were used, with private image files and the child server cleaned up afterwards.

## Matrix evidence

| Requirement | Executed evidence |
|---|---|
| Map/share/clear and reload | API test persists shared assignments, equivalent reversed mapping no-op, duplicate rejection, omitted mapping clear; browser selects/shares/clears and reloads |
| Missing/foreign/inactive references | PostgreSQL invalid mapping test rejects missing/foreign variants, missing/foreign/removed attachments and duplicate variants with unchanged gallery/revision/audit |
| Retained IDs and removed IDs | Service and PostgreSQL tests perform actual SKU/attribute swaps and product saves; retained mappings survive, removed IDs clear once with audit/revision |
| Concurrency | Two independent connection schedules hold the canonical product lock: gallery first versus replacement first; stale mapping cannot restore removed IDs |
| Atomic failures | Service and real PostgreSQL audit-trigger failures roll back mapping writes and product row replacement, including revision/audit state |
| Snapshot reads | Controlled independent commit after the gallery statement proves old revision/images/mappings stay coherent; following read sees the new aggregate |
| Database migration | Disposable-schema down/reapply preserves original products/variants/media; composite FKs and restrictive delete behavior are exercised |
| Unsaved/dirty state | Component tests preserve local order/alt/mapping through null/failed/stale refresh, explicit discard recovery, HTTP 401/422/503 failures; manager regression saves actual unrelated product fields without losing gallery edits |
| Keyboard/touch and generated variants | Browser keyboard selects mappings; touch generates/removes a variant, persists changes, preserves dirty gallery review and explicitly reloads; selectors use saved IDs only |
| Fallback and privacy | Service resolves explicit image, primary fallback and empty null; public product projection remains free of preview URLs; existing route auth/CSRF/private-preview regressions pass |

Browser invocation used a process-local fallback for Node `os.userInfo()` because this restricted Windows environment returns `uv_os_get_passwd ENOMEM` before tsx starts. No application code or global machine configuration was changed. The browser fixture explicitly aligns currency/scale with its variants to avoid the unrelated existing pricing-review guard.

No production release readiness is claimed. The down migration intentionally loses only the new assignment metadata and was executed solely in disposable schemas.

## Review corrections and final parent verification

Three independent BMAD layers completed. Corrected cross-product snapshot adoption and failed-switch recovery; same-revision removal of locally assigned variants now offers explicit reload without silent loss. Updated discard text, linked indexed errors to selectors, and added blank-description option labels. Concurrency tests now observe the competing connection blocked by the canonical product lock before release. Deferred gallery PUT/POST tests prove product actions are disabled and direct submissions blocked until success/failure. Removed the unsupported browser fallback flag; fallback resolution is covered by service tests.

Final parent execution after patches: 141 application tests in six files and 17 real PostgreSQL tests in two files passed. Typecheck and lint passed (the existing Upload.tsx warning remains). Fresh Webpack production build and authenticated browser at 320/768/1024/1440px passed. Corrected an unsupported test-query option found by TypeScript before the final successful build. No new findings deferred. Browser DOM/status checks do not constitute a human screen-reader listening session.

`npm.cmd run db:migrate:local` applied the additive `0017_variant_media` successfully to local development after the sandbox tsx user-info failure was resolved by approved elevated execution. Existing product/media data was retained; production was untouched. The feature is ready for local human walkthrough and acceptance.
