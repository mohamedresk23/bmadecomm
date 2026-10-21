# Epic 4 Context: Sellable catalog management

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Enable authorized staff to create correct products, variants, categories and images, then publish products safely while preserving stable URLs and historical references. The current approved delivery grouping is E04-04: product publication, slug redirects and SEO metadata, building on product drafts and private image management. Original Epic 04 IDs remain authoritative; tracking aliases 4.401–4.406 do not renumber the approved stories. No product brief was found; the epics, approved scoped stories, specification, implementation contract, PRD, architecture and UX documents supply this context.

## Stories

- Story E04-01: Categories and cycle-free hierarchy
- Story E04-02: Product and variant drafts
- Story E04-03: Product image management
- Story E04-04-01: Schema migration for slug, SEO fields and redirects
- Story E04-04-02: Slug validation, generation and redirect management
- Story E04-04-03: Product publication readiness service and API
- Story E04-04-04: Atomic publish and unpublish actions
- Story E04-04-05: Public slug resolution, redirects and draft isolation
- Story E04-04-06: Staff publication checklist and Slug/SEO editor
- Story E04-05: Duplicate, archive and delete lifecycle

## Requirements & Constraints

- Draft products and their media remain private. Public resolution excludes Draft and Archived products, including when resolving historical slugs. Unpublishing removes public availability immediately. Availability such as Out of Stock remains separate from publication status.
- Publication readiness is a read-only assessment; the approved E04-04 contract governs its checks and structured field issues. Actual publication must recheck readiness inside its mutation transaction. An unsuccessful assessment or transition must not partially publish, change data or append a success audit.
- The approved publication matrix requires basic product content, a valid unique slug, active sellable variants with SKU and positive price, category membership, an active gallery image, and nonblank alternative text on active attachments. Earlier image-only planning deliberately added no image-required gate; the later E04-04 publication contract supplies that requirement. Exact rule and error-key interpretation belongs in the story specification, not additional invented policy.
- Slugs are normalized lowercase ASCII alphanumeric segments separated by single hyphens and unique across the deployed single-store catalog. Historical redirect sources belonging to another product must not be silently claimed. Published slug changes preserve old URLs through direct redirects and prevent loops.
- Preserve draft editing, variant identities, category relationships, monetary representation and retained image references. Historical order snapshots must not change when catalog data changes. Catalog editing does not own stock adjustment, reservation or allocation.
- Live staff authorization is checked on every request; client role or mock identity headers do not authorize. Staff and draft responses use private/no-store behavior; authorization precedes resource disclosure. Mutations enforce Origin/CSRF, validation, safe errors, correlation-aware logs and redacted audit.
- Production storage/provider, region, privacy retention and release policies remain owner decisions. Local feature completion does not establish production readiness. Duplicate/archive/delete lifecycle, storefront UI, advanced SEO generation, Brands and Reviews are outside the current publication grouping.

## Technical Decisions

- Catalog owns product, variant, category, media and publication commands. HTTP adapters invoke application services; domain/application logic must not depend on Next.js APIs. Read installed framework guides before changing framework integration.
- Use additive PostgreSQL migrations, uniqueness and foreign-key constraints rather than application-only integrity checks. Slug, optional SEO metadata, publication timestamp and product-owned redirect records extend existing catalog storage.
- A published slug change updates prior targets to the new canonical slug in one transaction, creates the old-slug redirect and handles a return to an owned historical slug without creating a cycle. Publication and unpublication commit status, timestamp policy and audit atomically.
- Readiness and publication must use consistent database facts rather than cache or client state. Keep the evaluator reusable by both the read API and the later transactional publication command. Readiness reports structured field/code/message issues without writes.
- API identifiers are opaque strings; revision values and money retain established contracts. Store timestamps in a unified UTC reference. Custom SEO title and description use the approved bounds; public fallbacks derive from content when optional metadata is blank.
- Public published catalog caching requires invalidation after commit. Staff, account and draft data cannot enter shared caches. Storage bytes sit behind an adapter with metadata owned by catalog; retained media must survive gallery detachment.
- Verification covers authorization boundaries, validation failures and database invariants. Database migration, atomicity and concurrency claims need real PostgreSQL evidence. UI work also needs keyboard, RTL and responsive verification.

## UX & Interaction Patterns

- Staff first save a Draft, manage variants, categories and gallery, then inspect publication blockers and explicitly publish. The editor provides publication status, actionable readiness issues, Slug/SEO fields and confirmation for publication changes.
- Preserve Arabic RTL conventions, independent visible labels, visible focus and field-associated errors. Error summaries lead to invalid inputs; status is understandable without color. SKU and slug text retain correct character order.
- Distinguish loading, empty, validation failure, conflict, expired session and network failure. Preserve entered values after failed saves; never silently overwrite stale edits. Essential actions work by keyboard and touch and reflow at supported widths.
- Images remain ordered, with the first active attachment primary; variant images fall back to primary or null. Alt text remains editable in Draft and becomes a publication blocker when missing. Detachment preserves historical media.

## Cross-Story Dependencies

- Epic 02 authorization, Epic 03 store settings, shared storage/audit/transaction foundations, E04-02 drafts and E04-03 galleries underpin publication. Existing prerequisite evidence must be checked rather than inferred from code presence.
- E04-04-01 establishes storage; E04-04-02 supplies slug behavior. E04-04-03 depends on storage and image alt-text support. Both slug management and readiness precede atomic publish/unpublish; public resolution follows transitions; staff UI completes the combined journey.
- Public product rendering and broader SEO output belong to the later storefront epic. Inventory remains separately owned. Future duplication must create an unpublished draft without copied SKU identities, and archive/delete must preserve historical references.
