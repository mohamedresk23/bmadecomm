---
id: SPEC-e04-03-product-images
created: 2026-10-14
companions:
  - implementation-contract.md
  - ../../planning-artifacts/prds/prd-bmadecomm-v2-2026-10-05/prd.md
  - ../../planning-artifacts/architecture/architecture-bmadecomm-2026-10-05/ARCHITECTURE-SPINE.md
  - ../../planning-artifacts/architecture/architecture-bmadecomm-2026-10-05/SOLUTION-DESIGN.md
  - ../../planning-artifacts/ux-designs/ux-bmadecomm-2026-10-05/DESIGN.md
  - ../../planning-artifacts/ux-designs/ux-bmadecomm-2026-10-05/EXPERIENCE.md
  - ../../implementation-artifacts/epic-4-context.md
  - ../../implementation-artifacts/spec-e04-02.md
  - ../../planning-artifacts/stories/stories-bmadecomm-2026-10-05/stories.md
  - ../../implementation-artifacts/spec-f00-07-media-storage-foundation.md
sources: []
---

# E04-03 — Product images

> **Accepted delivery amendment (2026-10-22):** Read the [A4 reconciliation record](../../implementation-artifacts/e04-contract-reconciliation-2026-10-22.md) with this kernel and its contract. It supersedes the earlier assignment of public image promotion/serving to E04-04 with the approved metadata-only delivery. Original requirements below are retained as history where explicitly superseded.

> This kernel and its companions define the implementation contract. Created from the canonical `.memlog.md`; documentation only. Use the original story numbering, explicitly confirmed by the user. The proposed decomposed E04-06/E04-07 cover this same image scope; proposed decomposed E04-03 is not this work.

## Why

Staff already create private products and variants through E04-02, but cannot attach a usable product gallery. Enable safe image upload, ordering, alternative text, optional variant images and removal so later publication and storefront stories can consume validated media without exposing drafts or losing historical references.

## Capabilities

- **CAP-1**
  - **intent:** Authorized staff can attach validated images to a product and preview them privately.
  - **success:** A valid JPEG/PNG/WebP attaches once and survives reload; invalid or unauthorized uploads leave the gallery unchanged and never become public.
- **CAP-2**
  - **intent:** Staff can order gallery images and describe them with alternative text.
  - **success:** Order and alt text survive reload; the first active image is primary; all operations work by keyboard, and blank alt is reported as a publication blocker.
- **CAP-3**
  - **intent:** Staff can select an optional image for each variant.
  - **success:** Same-product assignments survive reload; foreign or removed images are rejected; an unmapped variant falls back to the product primary image.
- **CAP-4**
  - **intent:** Staff can remove an image from the live gallery while preserving historical media.
  - **success:** Removal and mapping cleanup commit atomically; remaining order is valid; media bytes and historical references are retained.

## Constraints

- Reuse the modular catalog application boundary, PostgreSQL transactions, staff-session authorization, Origin/CSRF protection, shared error envelope and transactional audit. Never authorize with client-supplied roles or `x-mock-user`.
- Draft images remain private, with authenticated previews and no shared cache. Upload and preview never publish a product or expose files under `/uploads`.
- File content must decode and be safely re-encoded without metadata before attachment. Schema/domain/database checks enforce same-product mapping and valid gallery order.
- Preserve existing variant mappings during E04-02 product edits; its current variant replacement algorithm is an explicit compatibility hazard.
- No physical deletion of media or rewriting order snapshots in this slice. Production must satisfy AD-14 durable storage; current local storage is a development baseline.
- Owner-adopted local policy: existing 5 MiB file bound plus 64 KiB multipart framing; <=4096 pixels per side AND <=8M total pixels; static-only images; ten-second processing deadline with actual termination, cleanup and no partial result. Other proposed numerical policies and production storage/retention remain unresolved.
- One store per deployment; separate databases/storage between companies. Shared-deployment tenants are outside this contract.

## Non-goals

- Publish/unpublish, SEO, product lifecycle actions, public product UI, stock/cost editing, categories, variant matrix features, image cropping, external-URL import, video/SVG, media library, and automated retention cleanup.
- New role/grant management or order tables. Security corrections needed to use existing media entry points safely are in scope.

## Success signal

An authorized staff member uploads two images to an existing Draft, edits their alt text, reorders them, maps one to a variant, reloads, and removes it. Persistence, primary fallback and audit remain correct; a guest cannot fetch the draft images; invalid uploads and stale edits cause no partial changes.

## Assumptions

- Image writes initially apply to Draft products, matching E04-02; published/archived image mutation is deferred to lifecycle integration.
- Each variant has at most one selected image; one product image may serve many variants. Blank alt is permitted in Draft and blocks later publication.
- Remaining proposed limits: 10 active images/product, alt text 500 characters, JSON 64 KiB, upload 20 files/10 minutes/actor. File/type baseline and owner-adopted multipart/decode/deadline constraints are above.

## Open Questions

- Which durable storage provider/region and historical media retention policy will production use? AD-14 requires object storage, while F00-07 selected local storage; production integration remains gated.
- Are the proposed count/alt/JSON/rate limits accepted for their affected later stories? The multipart/decode/deadline policy is adopted; unapproved launch targets remain proposed.

