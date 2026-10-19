# Epic 4 Context: Private product image management

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Enable authorized catalog staff to manage validated, private Draft product images: an ordered gallery with alt text, optional variant assignments and safe detachment that retains historical media. This is the approved E04-03 grouping within the original Epic 04 Sellable catalog management; retain the original IDs and existing E04-02 contracts. The user has authorized E04-03-05 implementation. Publication, storefront rendering and later lifecycle stories remain outside this image slice. No product brief was found in the planning directory; the scoped epics, PRD, architecture and UX documents supply this context.

## Stories

- Story E04-03-01: Secure and validate existing media upload
- Story E04-03-02: Read and privately preview a product gallery
- Story E04-03-03: Upload a Draft image with safe retry
- Story E04-03-04: Save alt text and show publication readiness
- Story E04-03-05: Reorder the gallery accessibly
- Story E04-03-06: Map images to variants without losing assignments
- Story E04-03-07: Remove gallery images while retaining history

## Requirements & Constraints

- Image writes target persisted Draft products. Draft images remain private; upload and preview must never publish media or generate public access paths.
- Active attachments form a contiguous ordered gallery. The first active image is primary; an empty gallery has a null primary. Optional variant assignments reference active images belonging to the same product, allow shared images and fall back to primary or null when unassigned.
- Draft saves may contain blank alt text and return publication-readiness issues. Valid alt text is required for image publication readiness; do not invent an image-required rule.
- Validate actual image bytes, decoded content, size and supported format; re-encode and strip metadata before attachment. Preserve JPEG/PNG/WebP and the existing 5 MiB bound. Reject empty, malformed, spoofed or excessive input safely without partial success.
- Soft detachment clears current assignments and compacts order while preserving media bytes, metadata and historical references. Physical deletion and changes to order snapshots are outside this grouping.
- Resolve a live staff session and required catalog permission on every request. Client-supplied actor, role or mock identity headers never authorize access. Writes enforce Origin/CSRF; authorize before file processing or resource disclosure. Responses and errors remain private/no-store with safe correlation-aware errors and logs.
- Strict schemas enforce full membership, same-product IDs and valid ordering. Revision guards reject stale submissions. Upload retry keys are actor/product scoped and deduplicate equivalent requests while rechecking authorization.
- Every committed mutation includes its revision and redacted audit atomically. Validation, storage, database or audit failures leave no partial committed aggregate; no-op and replay produce no additional success audit.
- Numeric count, request, text, rate and decode policies must follow the authoritative feature contract and recorded owner decisions. The scoped planning documents retain unresolved policy gates; they do not independently approve proposed limits. Production provider, region and retention remain release decisions; local feature work does not establish production readiness.

## Technical Decisions

- Catalog owns gallery commands. HTTP adapters call application services; file processing and storage use adapters. Application services must not depend on Next.js APIs. Read the installed Next.js guides before changing framework integration.
- Use additive PostgreSQL changes and preserve existing product, variant and media records. Attachment/revision structures precede variant mapping structures. Same-product foreign keys, active-position uniqueness and transactions protect the aggregate.
- Lock product first, then media in stable ID order. Stage file processing outside short database transactions; attach, update revision and audit together. Safely compensate or record newly staged orphans without deleting unrelated or retained objects.
- Gallery DTOs use opaque IDs, bigint revision strings and UTC timestamps. Product-scoped commands provide gallery upload/read/update/detach and authenticated image content; the implementation contract governs exact schemas and errors.
- Preserve original product-edit behavior, category links, monetary representation, authorization and variant identities. Existing variant replacement must preserve retained-ID image assignments and clear genuinely removed assignments atomically when mapping is implemented.
- Production image storage must survive web-process replacement; metadata belongs in PostgreSQL and bytes belong behind a storage adapter. Do not select a provider or region without an owner decision.
- Each slice includes relevant unit, API and component verification, lint/typecheck and integration build checks. Database ordering and concurrency changes require real PostgreSQL evidence, including rollback and consistent reads; automated accessibility checks need manual keyboard/mobile verification.

## UX & Interaction Patterns

- Follow existing Arabic RTL admin conventions and visual tokens. Labels remain visible, errors associate with fields, focus is visible and status does not depend on color. Reflow preserves reading and operation order at 320, 768, 1024 and 1440px; no essential action depends on hover.
- Unsaved products must be saved before attachment. Upload presents supported types/adopted limits, progress or busy state, duplicate-submit protection and safe same-key retry.
- Reserve thumbnail space while loading. Distinguish empty galleries from failed loads. Broken previews offer a placeholder/retry without removing the attachment.
- Reorder supports explicit earlier/later actions usable by keyboard and touch, maintains logical order in RTL, and announces order/primary changes. Dragging is optional. Preserve image descriptions during local movement.
- Upload and detachment persist immediately; ordering, alt text and mappings use Save gallery. Dirty navigation, replacement and conflicting actions require explicit save/discard handling; cancellation preserves gallery and unrelated product edits.
- Stale, network and expired-session errors retain entered values and offer explicit reload/review or reauthentication. Never silently overwrite or reapply stale edits. Confirmation explains detachment and fallback; cancellation and completion maintain sensible focus.

## Cross-Story Dependencies

- Existing original E04-02 product/variant drafts and media, staff-session, permission, validation, audit and idempotency foundations underpin this work. Use prerequisite handoff and test evidence rather than assuming completion from code presence.
- Delivery order is E04-03-01 through E04-03-07. Gallery reads precede attachment; attachment precedes editing; editing precedes accessible ordering; mapping follows ordering; safe removal completes the cumulative workflow.
- Variant mapping must reconcile existing product edits before assignments can be considered durable. The final slice validates the combined upload/edit/order/map/reload/remove journey and privacy boundaries.
- Publication, inventory, storefront discovery and historical order rendering retain their own integration responsibilities. Retained-reference fixtures do not establish future order-table integration.
