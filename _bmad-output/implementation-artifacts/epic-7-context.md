# Epic 7 Context: Homepage content publishing

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Enable authorized staff to curate, preview, and publish storefront homepage sections safely while guaranteeing that unfinished layout drafts remain strictly invisible to shoppers and that public homepage rendering dynamically filters out unpublished or archived catalog items.

## Stories

- Story 7.101: Homepage sections draft editor (E07-01)
- Story 7.102: Authorized draft preview (E07-02)
- Story 7.103: Publish and public storefront homepage (E07-03)

## Requirements & Constraints

- Only the six approved section types are permitted: `hero`, `featured_categories`, `featured_products`, `best_sellers`, `new_arrivals`, and `promotions`. General-purpose CMS blocks and arbitrary HTML injection are forbidden.
- Draft and preview isolation is strictly enforced: draft APIs and preview routes must set `Cache-Control: private, no-store` and `noindex`. Unpublished draft modifications must never leak to the public storefront root.
- Live catalog filtering at render: referenced catalog items must be checked dynamically against live published products and active categories so that unpublishing or archiving an item immediately removes it from public display without breaking the layout.
- Access control requires active staff sessions: viewing drafts or preview requires `content.read` or `content.manage` (default `owner`, `marketing`); saving drafts or publishing requires `content.manage` and valid CSRF tokens. Customer and guest requests are rejected with 401/403.
- All draft updates and publication commands enforce optimistic concurrency (`expectedRevision`) and record append-only audit events.

## Technical Decisions

- The homepage domain resides in `src/modules/content/homepage/` with clean application service boundaries decoupled from Next.js request objects.
- Database foundation introduces `homepage_drafts` (singleton key `'default'` holding JSONB section configurations and incrementing `revision`) and `homepage_publications` (immutable snapshots with incrementing `version` and publication audit trail).
- Content validation is implemented with Zod discriminated unions ensuring section IDs are unique, positions are contiguous, and all referenced product and category IDs exist in the database.
- Public storefront root (`/`) reads from the latest publication snapshot, and publishing triggers immediate Next.js cache revalidation (`revalidatePath("/")`).

## UX & Interaction Patterns

- Staff curate sections through admin screen `A-12` (`/admin/content/homepage`) with Arabic RTL support, visible labels, and accessible keyboard-driven Move Up / Move Down controls (satisfying WCAG 2.5.7 without requiring drag-and-drop).
- Authorized preview route `/admin/content/homepage/preview` displays the current draft using `S-01` storefront presentation components with a clear preview banner and no public caching.
- Storefront homepage root (`S-01`) renders responsive layouts across 320px–1440px with graceful empty states and strictly omits deferred P1 controls (Wishlists, Ratings, Brands).

## Cross-Story Dependencies

- Foundation relies on existing staff authentication (`E02-02`) and published catalog records (`E04-04`).
- Story 7.101 (`E07-01`) delivers the database migration, draft service/API, and `A-12` editor. Story 7.102 (`E07-02`) builds the authorized preview route on top of the draft service. Story 7.103 (`E07-03`) delivers the atomic publication mutation and public `S-01` storefront rendering.

