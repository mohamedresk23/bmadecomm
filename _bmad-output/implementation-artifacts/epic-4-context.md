# Epic 4 Context: Sellable catalog management

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Enable authorized staff to manage categories, product and variant drafts, validated images, publication, stable URLs and lifecycle operations without exposing unpublished data or damaging historical references. Retain the original Epic 04 numbering used by the completed E04-02 handoff: the approved E04-03 image breakdown extends that baseline and does not substitute the proposed decomposed numbering. The owner now explicitly authorized E04-03-01 implementation; the separate logo-CSRF prerequisite must remain intact, and stories 02–07 remain unauthorized.

## Stories

- Story E04-01: Category tree management
- Story E04-02: Product and variant drafts (existing handoff recorded done)
- Story E04-03: Product images
- Story E04-03-01: Secure and validate existing media upload
- Story E04-03-02: Read and privately preview a product gallery
- Story E04-03-03: Upload a Draft image with safe retry
- Story E04-03-04: Save alt text and show publication readiness
- Story E04-03-05: Reorder the gallery accessibly
- Story E04-03-06: Map images to variants without losing assignments
- Story E04-03-07: Remove gallery images while retaining history
- Story E04-04: Publish, slug and SEO metadata
- Story E04-05: Duplicate, archive and delete

## Requirements & Constraints

- New products default to Draft and remain excluded from public discovery. Approved image writes target existing Draft products; preview never promotes their bytes to public storage.
- SKU uniqueness applies across variants; duplicate attribute combinations within a product and duplicate slugs are rejected. Categories remain acyclic and cannot be deleted while referenced by children or products.
- Prices use persisted store currency and exact monetary representation. Inventory owns stock balances and movements; catalog editing cannot overwrite them. Cost permissions remain separate from ordinary catalog editing.
- Active attachments form an ordered gallery whose first image is primary. Optional variant assignments reference active same-product images; unmapped variants fall back to primary or null. Publication requires valid alt text; Draft saves may retain missing descriptions and expose readiness issues. Do not invent a requirement to have an image.
- Validate actual format and successful decoding, re-encode and strip metadata. Empty, malformed, spoofed, unsupported or excessive files fail safely without public exposure or partial success. Preserve JPEG/PNG/WebP and the existing 5 MiB file bound. Approved multipart request overhead is 64 KiB above that bound; it does not enlarge the accepted image.
- Detachment clears current mappings and compacts order while preserving media bytes, metadata and historical references. No physical deletion or order snapshot mutation belongs to the image stories.
- Mutations require live server-resolved staff identity, action permissions and Origin/CSRF validation. Client identity/role headers never authorize access. Authorize before processing files or disclosing resources. Private responses and failures remain private/no-store, with safe correlation-aware errors and logs.
- Publication, SEO, slug redirects and lifecycle operations remain later original stories. Duplication creates a fresh Draft and clears SKUs; archival preserves references; deletion is forbidden for historically referenced products/variants. Storefront rendering and order integration are outside the image breakdown.

## Technical Decisions

- Catalog owns gallery commands; HTTP adapters call application services; image processing/storage use adapters. Application services do not depend on Next.js APIs.
- Preserve original E04-02 draft, variant, monetary, category-link and authorization contracts. Its done handoff is recorded evidence, not a claim of newly rerun tests during this planning session.
- Legacy media upload/publish routes remain owner only by the user's planning decision; product-image routes use existing catalog permissions. Replace or isolate legacy x-mock-user trust through live staff-session resolution and server authorization. Do not broaden legacy access while integrating catalog images.
- PostgreSQL constraints and short transactions protect membership, ordering, same-product assignments, revision and audit integrity. Stage files outside transactions; compensate or record new orphans safely without deleting unrelated/retained media. Mutations commit redacted audits; failure, no-op and replay add no extra success event. Lock product first, then media in stable order.
- Additive attachment/revision structures belong to 02; variant-mapping structures to 06. Strict DTOs use opaque IDs, revision strings and UTC timestamps. Revision guards reject stale writes. Actor/product-scoped upload keys deduplicate identical retries while rechecking live authorization.
- Later mapping must preserve retained variant assignments during product edits and clear only truly removed IDs atomically. Preserve existing product-edit behavior until that explicitly scoped compatibility slice.
- Current scope is local development. Production provider/region and retention remain unresolved release gates; no production readiness is implied. The owner approved <=4096 pixels per dimension AND <=8,000,000 total pixels, static-only uploads, and a ten-second processing deadline with actual termination/cleanup and no partial result. Processing implementation is authorized for E04-03-01 only. Later count/rate/text/JSON policies remain unapproved.

## UX & Interaction Patterns

- Follow existing Arabic RTL admin conventions with accessible labels, visible focus and field-linked errors. Each slice includes loading, empty, failure and recovery states rather than deferring accessibility/resilience.
- Persist products before attaching images. Upload shows accepted types/adopted limits, progress/busy state and explicit retry. Never automatically publish an upload to obtain a preview.
- Loading reserves thumbnail space; empty galleries explain the next action. Unavailable bytes show a retryable placeholder without silently deleting an attachment.
- Reorder supports keyboard/touch move controls and announces primary changes; dragging is optional. Alt text is plain text; variant selectors use stable persisted IDs and readable SKU/attribute labels.
- Upload/removal persist immediately; order/alt/mapping use Save gallery. Resolve dirty conflicts with explicit save/discard choices. Stale/session/network failures retain input and require review or reauthentication. Removal confirmation explains detachment/fallback and preserves sensible focus.

## Cross-Story Dependencies

- E04-03-01 local implementation reached review after three independent review layers, 468 passing full-suite tests, typecheck/lint/build and isolated packaged-worker verification on 2026-10-14. Human acceptance remains pending; one PostgreSQL-only skip, one existing todo, official sprint-validator unavailability and two pre-existing publication reliability deferrals are recorded in `verification-e04-03-01.md`. No later story authorization or production readiness is inferred.

- Epic 02 staff permissions/session and audit foundations, Epic 03 store settings and media/error/idempotency foundations underpin catalog work. Evaluate prerequisites through tests and handoff evidence, not code presence alone.
- E04-03-01 depends on F00-07 media storage, live staff sessions and F00-03 errors/validation. This foundation security correction precedes gallery integration. Conflicting F00-07 records require reconciliation and explicit verification gaps; no completion is inferred here.
- Image delivery order is 01 → 02 → 03 → 04 → 05 → 06 → 07. Story 02 also depends on original E04-02; 03 uses F00-06 idempotency; 06 reconciles original variant editing with retained image mappings. No slice depends on a future slice.
- E04-04 depends on image validation/readiness; E04-05 follows publication/lifecycle contracts. Inventory, public discovery and historical order rendering retain their own integration responsibilities.
