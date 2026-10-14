---
status: final
created: 2026-10-14
scope: E04-03-product-images-only
stepsCompleted: [step-01-validate-prerequisites, step-02-design-epics, step-03-create-stories, step-04-final-validation]
inputDocuments:
  - ../specs/spec-e04-03-product-images/SPEC.md
  - ../specs/spec-e04-03-product-images/implementation-contract.md
  - prds/prd-bmadecomm-v2-2026-10-05/prd.md
  - architecture/architecture-bmadecomm-2026-10-05/ARCHITECTURE-SPINE.md
  - architecture/architecture-bmadecomm-2026-10-05/SOLUTION-DESIGN.md
  - ux-designs/ux-bmadecomm-2026-10-05/DESIGN.md
  - ux-designs/ux-bmadecomm-2026-10-05/EXPERIENCE.md
  - ../implementation-artifacts/epic-4-context.md
  - ../implementation-artifacts/spec-e04-02.md
  - ../implementation-artifacts/spec-f00-07-media-storage-foundation.md
  - stories/stories-bmadecomm-2026-10-05/stories.md
---

# bmadecomm — E04-03 implementation breakdown

## Overview

This workflow is restricted to original E04-03 Product images, within existing Epic 04 Sellable catalog management. It does not replace the project-wide epics or the proposed decomposed Epic 04 stories. The user confirmed the original numbering and approved the existing spec and its referenced requirements as input. No implementation is authorized in this run.

The implementation contract remains authoritative for endpoint schemas, validation details, error codes, transaction boundaries, compatibility and IMG-01 through IMG-12. Stories will refine delivery order without changing that contract. Story IDs will use E04-03-nn so they cannot collide with original E04-04/E04-05 or proposed decomposed E04 IDs.

## Requirements Inventory

### Functional Requirements

- FR-15: Staff attach validated product images, maintain an ordered gallery and derive the primary image from the first active attachment.
- FR-12/13: Each persisted variant may select one same-product active attachment; many variants may share it; unmapped variants use primary/null fallback. Public PDP rendering remains deferred.
- FR-09/14: Image mutations operate on existing Draft products only; Draft media never becomes public through upload or preview; publication remains deferred.
- FR-55/56: Soft removal clears current mappings and compacts the gallery while retaining media bytes, metadata and historical references; no order snapshot changes or physical deletion.
- FR-56: Reject empty, oversized, spoofed, unsupported or undecodable files; validate bytes, re-encode and strip metadata before attachment.
- FR-06/07: Every request resolves a live staff session; customer/guest and client-generated permission headers cannot authorize access; revocation applies on the next request.
- FR-57/58: Strict server schemas and same-product FKs enforce IDs, ordering and mapping; revision guards reject stale updates; upload keys deduplicate identical retries.
- FR-45: Each successful mutation commits a redacted audit event with actor, resource and correlation ID; rollback/no-op/replay does not add success audits.

### NonFunctional Requirements

- NFR-08: Visible focus, labelled fields, readable errors, alt text and keyboard alternatives to dragging; manual accessibility verification accompanies automated checks.
- NFR-09: JPEG/PNG/WebP, responsive RTL gallery at 320/768/1024/1440px. Existing file bound is 5 MiB; 10 active images/product remains a proposed policy, not a new approval.
- NFR-12: Session, Origin/CSRF, bounded streaming/body/decode, safe types and nosniff, private/no-store responses, safe logs and proposed shared rate limiting.
- NFR-14: Additive schema changes, isolated migration up/down/reapply evidence, compatibility regression checks, production durable-storage and recovery gates.

### Additional Requirements

- AD-1/2: Catalog owns gallery commands; HTTP adapters call application services; storage processing uses an adapter; no Next.js dependency in application code.
- AD-4/14: History retains immutable references; validated files stay private until a later authorized publication workflow.
- AD-9/10/16: Reuse staff session/role checks, errors and bounded validation; harden both legacy media endpoints against x-mock-user and Draft publication bypasses.
- AD-14: Stage file work outside short DB transactions; DB attachment, revision and audit commit atomically; safely compensate/record staged orphan resources and test missing-object recovery.
- AD-15: Uniform audit and correlation; never log tokens, file bytes or sensitive EXIF.
- Database: Add product_media and media_revision when attachment capability lands; add variant_media and composite same-product FKs when mapping lands, using the next unused migration per story.
- Compatibility: Current product edits delete/reinsert variants. Mapping implementation must preserve retained-ID assignments and clear only truly removed variants in the same transaction; all commands share product-first lock order.
- API: Product-scoped POST/GET gallery, authenticated GET image content, revision-guarded PUT and DELETE; strict DTOs, opaque IDs, bigint revision strings and UTC timestamps.
- Recovery: Reauthorize upload replay, hash actual file bytes/canonical metadata, reuse operation-key lifetime, prevent concurrent duplicate attachment/audit effects.
- Gates: Numeric text/body/count/rate/pixel limits need adoption as specified. Durable production provider/region and retention remain unresolved; local development may proceed within the existing foundation decision. Do not invent a provider or launch policy.
- Dependencies: Existing original E04-02, F00-07, F00-02/03/06 and staff-session/audit foundations. New stories must depend only on existing foundations and earlier breakdown stories.

### UX Design Requirements

- UX-DR1: Add a labelled gallery section to the persisted Draft editor; unsaved products must save before attaching images.
- UX-DR2: File selection displays accepted formats/limits, measured or indeterminate upload progress, duplicate-submit protection and safe same-key retries.
- UX-DR3: Gallery loading reserves thumbnail space; empty gallery offers upload; broken previews show retry/placeholder without removing attachments.
- UX-DR4: Move earlier/later controls work with keyboard/touch, preserve logical order in RTL and announce reorder/primary changes.
- UX-DR5: Alt fields save plain text, render field and unmatched errors accessibly, and expose blank-alt publication blockers while permitting Draft saves.
- UX-DR6: Variant selectors use stable persisted IDs and SKU/attribute labels, show primary fallback and refresh/announce mapping changes after product edits.
- UX-DR7: Removal confirmation describes detachment and mapping fallback; cancelling preserves state; removing the last image produces the empty state with maintained focus.
- UX-DR8: Stale/network/session errors retain entered values and offer explicit reload/review or reauthentication; no silent overwrite/reapply.
- UX-DR9: Upload/removal persist immediately, while order/alt/mapping use Save gallery; pending or dirty conflicting operations require explicit save/discard handling; unrelated product fields must remain intact.
- UX-DR10: Navigation/replacement warns on unsaved gallery changes; temporary object URLs are revoked on replacement/unmount; supported viewport reflow uses existing visual tokens.

### FR Coverage Map

FR-06/07, FR-09/14, FR-12/13, FR-15, FR-45, FR-55/56 and FR-57/58 map to the existing E04-03 grouping within Epic 04. Coverage is limited to image authorization, private Drafts, optional variant images, gallery management, audit, retained history and image API integrity. Publication, storefront rendering and other lifecycle obligations remain outside this scope.

## Epic List

### Epic 04 / E04-03: Product images

Approved by the user: retain original E04-03 under Epic 04. Authorized staff manage a private, validated gallery and optional variant images without losing history. Existing original E04-02 and media/session foundations are external prerequisites. This grouping works without later publication or storefront stories. No separate frontend/backend/database epics are introduced.

## Story Breakdown

The user approved all seven stories. The focused handoff is [stories-e04-03-product-images/stories.md](stories/stories-e04-03-product-images/stories.md). The approved breakdown is included below. Final validation passed for the scoped contract; implementation policy gates remain explicit. No implementation has begun.

## Epic 04 / E04-03: Private product image management

Staff can manage validated Draft product images, gallery order and alt text, optional variant images and safe removal. Seven bounded stories use original E04-03 numbering with suffixes. Each is independently implementable and testable **after its listed prerequisites**, without a dependency on a future story. A coding session is a sizing target, not a duration guarantee.

The [implementation contract](../specs/spec-e04-03-product-images/implementation-contract.md) remains authoritative for complete API schemas, error handling and IMG acceptance cases. These stories do not approve unresolved numeric policies or production storage. The SPEC and its companions must be read before implementing any story; installed Next.js guides must be read before code changes.

### Delivery sequence

| ID | Outcome | Layers | Prerequisites |
|---|---|---|---|
| E04-03-01 | Existing media upload is genuinely authorized and validated | Frontend, backend | Existing F00-07 and staff sessions |
| E04-03-02 | Staff view an authenticated private product gallery | Frontend, backend, database | 01; original E04-02 |
| E04-03-03 | Staff upload an image to a Draft exactly once | Frontend, backend, database | 02; existing F00-06 |
| E04-03-04 | Staff save alt text and see publication blockers | Frontend, backend, database | 03 |
| E04-03-05 | Staff reorder the gallery using keyboard or touch | Frontend, backend, database | 04 |
| E04-03-06 | Staff select variant images that survive product edits | Frontend, backend, database | 05 |
| E04-03-07 | Staff detach images while retaining historical media | Frontend, backend, database | 06 |

01 is a prerequisite security correction; 02 establishes a usable read/preview path before accepting attachments. All remaining stories are vertical slices. Test fixtures may seed attachments for 02; its read capability and empty state function without 03. Tables are introduced only when needed: product_media/media_revision in 02, variant_media in 06.

### Shared completion requirements

- Every new HTTP path uses live catalog staff sessions; writes validate Origin/CSRF. All responses and errors are private/no-store. Authorize before decoding or disclosing resource data. No x-mock-user trust.
- Preserve the shared error envelope and correlation ID. Strict schemas reject client roles, actor, paths, URLs/status and unknown fields. Draft-only writes reject other states with 409; foreign/missing resources return safe 404 or contract-specified field errors.
- Every committed mutation includes audit and media revision in its transaction; no-op/replay creates no extra success audit. Failed validation/storage/DB/audit leaves no partial committed state. Use product-first, then stable media-ID lock ordering.
- Each feature includes its own validation, failure/loading/empty states, Arabic RTL/accessibility and tests. Do not defer these to a final polish story. Preserve unrelated product edits.
- Run relevant unit/API/component checks and lint/typecheck for each story. Run real PostgreSQL checks for schema/concurrency changes and a build when route/component integration changes. Record limitations and verify the cumulative browser workflow before accepting the final slice.
- Proposed count/body/text/rate values and decoded-pixel budget require explicit policy decisions before affected guards are completed. 01 is gated on decode/body policy; 03 on active-image capacity policy; 04 on alt/JSON bounds. Production storage provider/region/retention remains a release gate; no provider purchase or deployment is included.
- Preserve existing 5 MiB input limit and JPEG/PNG/WebP support. Local development storage follows F00-07; no Draft public promotion. No stock/cost/SEO/publication/order schema or physical media deletion in any story.

### Story 4.3.1: Secure and validate existing media upload

**Story ID:** E04-03-01

As an authorized staff member,
I want uploads to use my real session and validate actual image content,
So that unsafe or forged requests cannot store or publish files.

**Objective:** Make the existing media foundation safe before catalog integration.

**Scope:** Harden existing upload/publish routes, adapt their current component/tests to server-resolved identity, remove automatic publication for previews, enforce bounded streaming before multipart materialization, decode/type/extension validation, metadata stripping and safe processing failures. Audit existing consumers and preserve legitimate response shapes. Add bounded adapter cleanup of newly staged resources on foundation failure. No gallery tables or product upload endpoint.

**Dependencies:** Existing F00-07, staff sessions, F00-03 errors/validation. Resolve proposed multipart/decode resource limits before completing the corresponding guard.

**Affected layers:** Frontend (existing Upload component), backend (legacy routes, processor/storage); no database migration.

**Acceptance Criteria:**

- **Given** forged x-mock-user, absent/customer/revoked session or bad Origin/CSRF, **When** either legacy write endpoint is called, **Then** it is denied before file processing and no bytes or records are written.
- **Given** a real authorized staff session and valid JPEG/PNG/WebP within the current file bound, **When** uploading, **Then** bytes decode, are re-encoded without metadata, and the existing pending-media response is returned **And** the component never auto-publishes to obtain a preview.
- **Given** empty/spoofed/unsupported/truncated/oversized content or an oversized streamed request without trustworthy Content-Length, **When** submitted, **Then** a safe contract-aligned error appears and no public file or success record is produced.
- **Given** processing/storage/metadata failure, **When** an upload fails, **Then** the component offers retry and an accessible error **And** newly allocated private orphan resources are safely compensated or recorded without deleting unrelated media.

**Test expectations:** Session/CSRF route matrix including both mock-header bypasses; actual decoder/MIME and metadata tests; exact-limit/one-byte-over and streamed-body tests; storage/DB fault injection; component pending/error/retry and no-auto-publish assertions. Server-side fixtures replace browser-granted permissions. Maps IMG-02/05/08, FR-06/07/56, NFR-12 and UX-DR2/8.

### Story 4.3.2: Read and privately preview a product gallery

**Story ID:** E04-03-02

As authorized catalog staff,
I want a private gallery on a persisted product,
So that I can inspect product images without exposing Draft files.

**Objective:** Establish the gallery persistence/read boundary and protected preview.

**Scope:** Add product_media and products.media_revision with required FKs, active-position uniqueness and indexes; GET gallery and GET image content; storage adapter private reads; gallery section with loading/empty/thumbnail-failure states. Return primary/null fallback, revision string and empty variantImages; blank-alt issues may be computed read-only. No upload or PUT/DELETE controls yet.

**Dependencies:** E04-03-01, original E04-02. Seed gallery fixtures for testing; no future upload dependency.

**Affected layers:** Frontend, backend, database.

**Acceptance Criteria:**

- **Given** an existing product, **When** authorized staff opens its gallery, **Then** a consistent ordered DTO and revision load **And** a product without attachments displays the empty state and primaryImageId null.
- **Given** a seeded active attachment, **When** staff requests its preview, **Then** validated bytes use a safe MIME, nosniff and private/no-store **And** no public path is generated or file promoted.
- **Given** a guest, foreign/removed attachment or missing object bytes, **When** preview is requested, **Then** no private bytes/path leak **And** missing bytes produce a safe unavailable response and retry placeholder without removing the attachment.
- **Given** existing products/variants/media, **When** the additive migration is applied/down/reapplied in an isolated database, **Then** original records/bytes survive **And** new constraints reject duplicate active positions and deleting referenced media.

**Test expectations:** Real migration and FK/index tests; gallery aggregate/empty/primary tests; auth/private-header/removed/foreign/missing-object route tests; component loading/reflow/empty/error tests and authenticated seeded-preview browser check. Maps IMG-05/11/12 and UX-DR1/3/10.

### Story 4.3.3: Upload a Draft image with safe retry

**Story ID:** E04-03-03

As authorized catalog staff,
I want to upload an image directly into a Draft gallery,
So that it persists once even when the response is lost.

**Objective:** Deliver the first end-to-end attachment capability.

**Scope:** Product-scoped multipart POST, required actor/product-scoped idempotency key and byte-based hash, privately staged validation through the foundation, transactional attachment append/revision/audit, capacity locking, compensation/recovery record and upload UI with same-key retry. Guard generic publication against product-owned Draft media once ownership tables exist. No order/alt/mapping editing or remove control.

**Dependencies:** E04-03-02, existing F00-06. Capacity policy and applicable limiter adoption must be resolved; retain production storage gate.

**Affected layers:** Frontend, backend, database (transactional use of existing/new tables; migration only if required by adopted shared limiter).

**Acceptance Criteria:**

- **Given** a saved Draft and valid file, **When** staff uploads, **Then** 201 returns one image plus gallery, appended at the next position with one audit/revision increment **And** reload displays the protected thumbnail without publication.
- **Given** an unsaved product or a published/archived product, **When** attaching, **Then** unsaved UI requires saving first and non-Draft writes fail without mutation.
- **Given** parallel identical keys/files or a lost response, **When** upload is retried, **Then** one attachment/audit commits; reused key with different file returns 409; replay rechecks live authorization.
- **Given** concurrent uploads near the accepted capacity or exhausted adopted shared rate limit, **When** they execute, **Then** capacity is never exceeded and 429 provides Retry-After when applicable.
- **Given** injected storage/DB/audit failure or duplicate staging, **When** attachment cannot commit, **Then** no false success/public file appears and new staged orphans are safely cleaned or recorded.

**Test expectations:** Actual valid upload/reload browser flow; real PostgreSQL duplicate-key/capacity races; replay payload/session tests; fault injection and cleanup-scope tests; generic publish Draft bypass regression; busy/double-submit/network retry UI tests and object URL cleanup. Maps CAP-1, IMG-01/02/05/07/08/09, UX-DR1/2/3/8/10.

### Story 4.3.4: Save alt text and show publication readiness

**Story ID:** E04-03-04

As catalog staff,
I want to save image descriptions and see missing-alt warnings,
So that I can prepare accessible images while the product remains a Draft.

**Objective:** Add safe, revision-guarded gallery editing and readiness feedback.

**Scope:** PUT gallery with strict full membership validation, expectedRevision, unchanged-image-order submission, alt text editing and blank-alt readiness helper; Save gallery, dirty-navigation confirmation, session/stale/error retention. Before mapping exists, variantImages must remain empty. The backend may accept valid permutations per the canonical PUT contract, but reorder controls ship in 05. No publication action.

**Dependencies:** E04-03-03; adopted alt/JSON validation limits.

**Affected layers:** Frontend, backend, database (transactional updates; no new table).

**Acceptance Criteria:**

- **Given** current gallery revision, **When** trimmed valid alt text is saved, **Then** it persists after remount with one revision/audit change; an unchanged PUT creates neither.
- **Given** blank alt in a Draft, **When** saved, **Then** save succeeds and readiness returns one field issue per affected active image without publishing or inventing an image-required rule.
- **Given** duplicate/missing/foreign attachment, unknown fields, invalid text or stale revision, **When** PUT executes, **Then** it fails atomically with appropriate field/409 feedback and retains entered values.
- **Given** dirty gallery edits and navigation, upload, or product replacement, **When** the action is requested, **Then** explicit save/discard handling prevents silent loss and cancellation keeps gallery and unrelated product fields.

**Test expectations:** Normalization/bounds/readiness unit tests; strict PUT and audit/no-op tests; real PostgreSQL competing-revision writes; accessible field/unmatched-summary tests; dirty-navigation cancellation, session expiry and network recovery tests. Maps CAP-2, IMG-03/07/08/09/11, UX-DR5/8/9/10.

### Story 4.3.5: Reorder the gallery accessibly

**Story ID:** E04-03-05

As catalog staff,
I want to change image order using keyboard or touch controls,
So that I can choose the primary product image reliably.

**Objective:** Deliver accessible gallery ordering through the existing Save gallery contract.

**Scope:** Move earlier/later UI controls, primary indicator, focus/live announcements and PUT ordering transaction with uniqueness-safe temporary positions. Keep alt edits intact during reorder. Drag is optional, never required. No variant mapping or removal.

**Dependencies:** E04-03-04.

**Affected layers:** Frontend, backend, database (ordering transaction; no new table).

**Acceptance Criteria:**

- **Given** two or more active images, **When** staff moves one and saves, **Then** reload reproduces contiguous order and the first image is primary, including in RTL.
- **Given** only keyboard/touch access, **When** reordering, **Then** every operation remains reachable, focus is visible and the change is announced without requiring dragging.
- **Given** a stale competing save or failure mid-position-update/audit, **When** reorder executes, **Then** no partial order commits and local order/alt values remain reviewable.

**Test expectations:** Permutation and boundary tests; real PostgreSQL uniqueness-safe swaps/rollback and consistent reader snapshots; keyboard focus/announcement tests; browser reorder/save/reload at 320px and desktop. Maps CAP-2, IMG-03/07/08/11, UX-DR4/8/9/10.

### Story 4.3.6: Map images to variants without losing assignments

**Story ID:** E04-03-06

As catalog staff,
I want to select a variant image that survives editing that variant,
So that each variant consistently shows its intended image.

**Objective:** Deliver optional same-product mappings with E04-02 compatibility in the same slice.

**Scope:** Add variant_media with one-image-per-variant and composite same-product FKs; extend gallery PUT/GET and variant selector; fallback lookup; transactional reconciliation of current delete/reinsert variant updates; refresh/announce cleared assignments. Preserve private preview/public filtering boundaries; no storefront rendering.

**Dependencies:** E04-03-05; existing E04-02 variant edit path.

**Affected layers:** Frontend, backend, database.

**Acceptance Criteria:**

- **Given** persisted variants and active same-product images, **When** assignments are saved, **Then** one image may serve multiple variants; omission clears an assignment; reload preserves explicit mappings and primary/null fallback.
- **Given** foreign variants/images, removed attachments or duplicate mapping entries, **When** submitted, **Then** strict validation/FKs reject them atomically without revealing foreign resources.
- **Given** an assigned retained variant ID, **When** SKU/attributes change through existing product save, **Then** its image remains assigned despite row replacement; truly removed IDs lose mappings and membership changes increment gallery revision.
- **Given** concurrent product variant edits and gallery writes, **When** transactions overlap, **Then** shared lock order preserves a valid committed aggregate and stale submissions cannot restore foreign/deleted IDs.
- **Given** unsaved generated variant rows, **When** using the selector, **Then** mapping waits for persisted IDs and subsequent product saves refresh/announce cleared mappings.

**Test expectations:** Migration up/down/reapply and composite-FK tests; map/share/clear/fallback API and UI tests; actual product edit/save/reload mapping regression; real PostgreSQL replacement-versus-gallery race; public DTO regression contains no private preview URL. Maps CAP-3, IMG-04/07/08/10/12, UX-DR6/8/9.

### Story 4.3.7: Remove gallery images while retaining history

**Story ID:** E04-03-07

As catalog staff,
I want to detach an image from the current gallery,
So that obsolete images disappear without destroying historical references.

**Objective:** Complete safe removal and validate the cumulative image-management workflow.

**Scope:** Revision-guarded DELETE, soft removal, atomic mapping cleanup/order compaction/revision/audit; removal confirmation/focus/fallback/empty states. Retained-reference fixture and recovery/rollback notes. No physical deletion, order schema or public historical URL revocation.

**Dependencies:** E04-03-06.

**Affected layers:** Frontend, backend, database (transactional updates; no new table).

**Acceptance Criteria:**

- **Given** a primary or mapped active attachment, **When** staff confirms removal using current revision, **Then** it is soft-removed, relevant assignments clear, remaining positions compact and primary fallback changes in one audited transaction.
- **Given** the last image or a cancelled confirmation, **When** removal finishes or is cancelled, **Then** the empty/null state is correct or all previous state remains intact, with sensible focus and feedback.
- **Given** retained media/historical references, **When** removing the attachment, **Then** media row/bytes survive, no physical-delete operation runs and removed current-preview access returns 404.
- **Given** stale revision, simultaneous map/reorder or injected cleanup/audit failure, **When** removal executes, **Then** stale work fails or a single valid outcome commits; no partial detach/order/mapping state persists.
- **Given** the seven completed slices, **When** staff uploads two images, edits alt, reorders, maps, reloads, edits a retained variant and removes the mapped image, **Then** all persistence, privacy, fallback and audit outcomes meet the spec; guest requests expose no Draft bytes.

**Test expectations:** Real PostgreSQL remove-versus-map/reorder tests; rollback/audit and retained-reference tests; keyboard confirmation/cancel/focus/last-image tests; cumulative authenticated browser workflow, session expiry and 320px RTL/manual accessibility checks; final relevant product/category/media regressions, lint/typecheck/build. Future orders story must add real order-snapshot regression when order tables exist; fixture evidence does not claim that integration. Maps CAP-4, IMG-06/07/08/09/10/11, UX-DR7/8/9/10.

### Coverage and remaining gates

| Spec acceptance | Stories |
|---|---|
| IMG-01 | 03 |
| IMG-02 | 01, 03 |
| IMG-03 | 04, 05 |
| IMG-04 | 06 |
| IMG-05 | 01, 02, 03; shared checks on 04–07 |
| IMG-06 | 07 |
| IMG-07 | 03–07 |
| IMG-08 | 01, 03–07 |
| IMG-09 | 03, 04, 06, 07 |
| IMG-10 | 06, 07 |
| IMG-11 | 02, 04, 05, 07 |
| IMG-12 | 02, 06 |

All four capabilities and all ten UX-DR requirements have owners above. Acceptance of this breakdown approves its organization only; it does not resolve the SPEC's open policy/storage questions. Production integration remains outside these local feature stories until provider/region/retention decisions are made; adopting rate limits requires the relevant shared-limiter work and abuse tests in 03. No implementation, migration execution or runtime testing occurred while authoring these stories.
