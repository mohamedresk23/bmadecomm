# E04-03-05 verification

Date: 2026-10-19. Specification: spec-e04-03-05-reorder-the-gallery-accessibly.md.

## Human acceptance

Accepted by the owner on 2026-10-19 after the BMAD walkthrough, detail pass and suggested manual observations. Explicit decision: "أقبل القصة". Sprint story 4-305 is done. Implementation commit: 18b37b929da23b378aa7bc1f500e7b369da93469.

## Implemented behavior

- Earlier/later buttons swap adjacent images in local logical array order. Position and primary update immediately in RTL. Save gallery submits that order with ID-keyed descriptions; restoring saved order returns to clean state.
- Buttons support keyboard/touch, have 44px minimum height and visible focus, and announce position and primary changes through a persistent polite live region. Boundary buttons use aria-disabled and ignore activation while retaining keyboard focus.
- Dirty order participates in the existing product navigation and unload guards. Upload requires confirmed discard; local descriptions and order survive upload/save failure. Save/upload/loading block conflicting edits. Stale writes remain blocked until explicit confirmed reload, which discards local gallery changes without touching product form fields.
- Gallery reads use one joined statement for revision and active images, preserving missing-product and empty-gallery responses. Reordering selects distinct temporary integer slots outside both occupied and final slots. Positions, alt text, revision and audit remain in the existing transaction. No dependencies/schema/API changes.

## Executed checks

| Check | Result |
| --- | --- |
| Gallery component suite | 29 passed |
| Catalog regression command below | 139 passed, 6 files |
| Real PostgreSQL reorder suite | 7 passed |
| npm.cmd run typecheck | Passed |
| npm.cmd run lint | Passed; existing src/components/Upload.tsx next/no-img-element warning |
| npm.cmd run build | Failed: Turbopack traverses pre-existing access-denied local/render directories; elevated retry also failed |
| npm.cmd run build -- --webpack | Passed, full production route generation |
| npx.cmd tsx scripts/verify-gallery-reorder-browser.ts | Passed, installed headless Edge |

Catalog regression command: `npx.cmd vitest run "src/app/admin/(workspace)/catalog/products/product-gallery.test.tsx" "src/app/admin/(workspace)/catalog/products/product-manager.test.tsx" "src/app/api/v1/admin/catalog/products" "src/modules/catalog/products" "src/app/api/v1/store/products"`.

Real PostgreSQL: `TEST_DATABASE_URL` was supplied privately to `vitest run --config vitest.postgres.config.ts gallery-reorder`, targeting dedicated `bmadecomm_gallery_reorder_test`, separate from the development database. Each run creates/drops a random `gallery_reorder_<hex>` schema and uses independent one-connection clients. Tests prove cycles/swaps, description identity, primary, contiguous positions, no-op audit/revision, occupied 10000/integer-max slots, one winner/one stale concurrent write, rollback after temporary/final/audit failures, complete old aggregate during a trigger/advisory-gated writer and complete new aggregate after commit, and preserved not-found behavior. No development tables are modified by these tests.

Browser: runner creates/drops a random isolated schema, applies migrations and the existing session compatibility conventions, creates a server-issued live staff session, seeds three persisted private Draft images, starts a dedicated built Next server on loopback, and uses a disposable Edge context. At 320, 768, 1024 and 1440px the initial run verified RTL, keyboard Enter reordering, boundary focus retention, computed solid focus outline, nonempty polite announcement, save HTTP 200 and persisted order/descriptions after page reload, touch swap/undo, 44px minimum button height and no document horizontal overflow. The runner closes browser/server, drops schema and unlinks only its allocated private files. Secret-free machine evidence: `.local/gallery-reorder-browser-verification.json`.

## Review fixes and targeted verification

- Existing-product saves now leave the independent gallery draft intact; initial product creation still loads its gallery. The manager regression edits local order and alt text, saves unrelated product description through real API handlers, and verifies no gallery reload or loss of gallery edits.
- Move announcements include stable attachment identity and a monotonically increasing sequence. Tests cover different images moving to the same destination and the same move repeating. Loading tests assert all three labelled skeletons rather than the persistent move live region.
- Browser checks now traverse all earlier/later controls with Tab before Enter, and assert moved identity, destination position and primary-change text in the polite live region. The runner allocates an available loopback port and requires its spawned server's Ready output with error/exit tracking before HTTP readiness. Cleanup independently attempts browser/server/files/client/schema/admin teardown, tolerates missing files and registers files after successful creation; server termination has a bounded wait.
- The PostgreSQL suite now commits a writer immediately after the first reader SQL result, before any possible second statement. The current joined reader retains a complete old snapshot. An explicit reproduction of the old two-statement algorithm demonstrates the same schedule yields old revision/new order; replacing the implementation with that algorithm fails the current-reader assertion.
- Targeted follow-up execution: gallery and product-manager suites passed 43 tests across 2 files; PostgreSQL reorder suite passed 9 tests.
- Final parent verification after patches: 141 catalog tests across 6 files and all 9 PostgreSQL tests passed. Typecheck and lint passed (one existing Upload.tsx warning). A fresh Webpack production build passed. The strengthened browser runner passed at 320/768/1024/1440px, including Tab reachability of all move controls, boundary focus, solid focus outline, moved identity/destination/primary announcements, save/reload persistence, touch and reflow.
- All three independent BMAD review layers completed. Every implementation/test finding was patched and verified. One low-impact agent-context documentation issue was deferred in deferred-work.md; no product-code security controls changed.

## Actual limitations

The standard Turbopack build remains blocked by pre-existing filesystem ACL errors (initially `.local/owner-setup`, then `_bmad/render/bmad-build/...-old/...` on elevated retry). No permissions or unrelated storage code were altered. Installed Next CLI documentation supports the successful `--webpack` fallback.

Browser automation verifies DOM live-region content/focus/computed styles and real keyboard/touch events; no human screen-reader listening session was performed. No production deployment or migration was performed. The local PostgreSQL server was started for verification and the empty dedicated test database remains available; disposable schemas and image files were cleaned up.
