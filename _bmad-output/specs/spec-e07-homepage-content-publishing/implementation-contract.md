# Epic 07 — Homepage Content Publishing Implementation Contract

Created: 2026-10-22.
Scope: Homepage Sections Draft Editor (`E07-01`), Authorized Preview (`E07-02`), and Publish & Public Homepage (`E07-03`).
Building on: `E02-02` (Action & Field Permission Enforcement) and `E04-04` (Product Publish, Slug Redirects & SEO Metadata).

---

## 1. Database Schema Specifications (Migration 0019)

### 1.1 Table `homepage_drafts`
Stores the current working homepage draft (`key = 'default'`) edited in `A-12`.
```typescript
export const homepageDrafts = pgTable("homepage_drafts", {
  key: text("key").primaryKey().default("default"),
  sections: jsonb("sections").notNull().$type<HomepageSectionConfig[]>(),
  revision: integer("revision").notNull().default(1),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("homepage_drafts_key_singleton", sql`${t.key} = 'default'`),
  check("homepage_drafts_revision_positive", sql`${t.revision} >= 1`),
  check("homepage_drafts_sections_array", sql`jsonb_typeof(${t.sections}) = 'array'`),
]);
```

### 1.2 Table `homepage_publications`
Stores immutable published snapshots of the homepage consumed by public `S-01`.
```typescript
export const homepagePublications = pgTable("homepage_publications", {
  id: text("id").primaryKey(),
  version: integer("version").notNull(),
  sourceDraftRevision: integer("source_draft_revision").notNull(),
  sections: jsonb("sections").notNull().$type<HomepageSectionConfig[]>(),
  publishedBy: text("published_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  publishedAt: timestamp("published_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("homepage_publications_version_uq").on(t.version),
  index("homepage_publications_published_at_idx").on(t.publishedAt),
  check("homepage_publications_version_positive", sql`${t.version} >= 1`),
  check("homepage_publications_sections_array", sql`jsonb_typeof(${t.sections}) = 'array'`),
]);
```

---

## 2. Homepage Content Schema Contract (`🚧 content schema` Gate Resolution)

Derived strictly from `FR-08`, `FR-11`, and `EXPERIENCE.md` (`S-01`, `A-12`) without inventing unapproved CMS fields:

### 2.1 Approved Section Types (`FR-08`)
`type HomepageSectionType = "hero" | "featured_categories" | "featured_products" | "best_sellers" | "new_arrivals" | "promotions"`

### 2.2 Discriminated Section Union (`HomepageSectionConfig`)
Every section entry in `sections` is validated at runtime with Zod:
- Common fields on every section:
  - `id`: `string` (non-empty opaque identifier, unique within the `sections` array)
  - `type`: `HomepageSectionType`
  - `enabled`: `boolean`
  - `position`: `number` (0-based contiguous integer matching array index `0..N-1`)
- Type-specific reference & configuration fields:
  1. **`hero`**:
     - `productIds`: `string[]` (0..4 referenced product IDs to highlight in the hero section; validated against `products.id`, no duplicates)
     - `categoryIds`: `string[]` (0..4 referenced category IDs; validated against `categories.id`, no duplicates)
  2. **`featured_categories`**:
     - `categoryIds`: `string[]` (1..12 ordered category IDs when `enabled = true`, 0..12 when `enabled = false`; validated against `categories.id`, no duplicates)
  3. **`featured_products`** (Editorial / Recommended order per `FR-11`):
     - `productIds`: `string[]` (1..24 editorially ordered product IDs when `enabled = true`, 0..24 when `enabled = false`; validated against `products.id`, no duplicates)
  4. **`best_sellers`** (`FR-08`, `FR-11`):
     - `limit`: `number` (integer `1..24`, default `8`; dynamically queries published products ordered by `Delivered - Returned` in 30 days once Epic 13 facts exist, falling back to `published_at DESC, id ASC` tie-break per `epics.md` Epic 06/07 contract)
  5. **`new_arrivals`** (`FR-08`, `FR-11`):
     - `limit`: `number` (integer `1..24`, default `8`; dynamically queries published products ordered by `published_at DESC, id ASC`)
  6. **`promotions`** (`FR-08`):
     - `productIds`: `string[]` (1..24 ordered product IDs when `enabled = true`, 0..24 when `enabled = false`; validated against `products.id`, no duplicates; at render time resolves published products and highlights active compare-at price / promotional items)

### 2.3 Validation Rules (`E07-01`)
1. Maximum `12` sections total in a homepage draft.
2. Any `type` outside the six approved `FR-08` section types is rejected with `400 Bad Request` / `422 Unprocessable Entity`.
3. Every `productId` in `productIds` must exist in `products.id`; non-existent IDs return `422` with structured field path (e.g. `sections[2].productIds[0]`).
4. Every `categoryId` in `categoryIds` must exist in `categories.id`; non-existent IDs return `422` with structured field path.
5. Duplicate `section.id` values or duplicate reference IDs within the same section are rejected with `422`.

---

## 3. Authorization, Caching & Isolation Rules

### 3.1 Staff RBAC (`E02-02` Matrix)
- **Read Draft & Preview (`E07-01`, `E07-02`):** Requires active staff session (`resolveStaffSession`) with permission `content.read` or `content.manage` (default roles: `owner`, `marketing`).
- **Save Draft & Publish (`E07-01`, `E07-03`):** Requires active staff session with permission `content.manage` (default roles: `owner`, `marketing`), plus `Origin` and `x-csrf-token` validation.
- **Staff Navigation (`staff-navigation.ts`):** Expose `{ href: "/admin/content/homepage", label: "Homepage content" }` when the staff member holds `owner` or `marketing` (or `content.read` / `content.manage`).

### 3.2 Cache & Indexing Headers (`AD-12`, `FR-16`)
- **Admin Draft APIs & Preview Route (`/admin/content/homepage`, `/admin/content/homepage/preview`, `/api/v1/admin/content/homepage/*`):**
  - `Cache-Control: private, no-store`
  - `Pragma: no-cache`
  - `X-Robots-Tag: noindex, nofollow` (and `<meta name="robots" content="noindex, nofollow" />` on the preview page)
- **Public Homepage (`/` and `GET /api/v1/store/homepage`):**
  - Reads exclusively from the latest `homepage_publications` snapshot.
  - On `POST /api/v1/admin/content/homepage/publish`, calls Next.js `revalidatePath("/")` (and `revalidateTag("homepage")` if tagged) after transaction commit.

### 3.3 Live Catalog Filtering at Render (`FR-08`, `AC-19`)
When rendering `S-01`:
- **Public Mode (`S-01`):**
  - Only sections with `enabled === true` are rendered.
  - Referenced products are joined against `products` where `status = 'published'` (excluding `draft` and `archived` products).
  - Referenced categories are joined against `categories` where `isActive = true`.
  - If a curated section (`featured_products`, `featured_categories`, `promotions`, `hero`) has all of its referenced items filtered out because they were unpublished/deactivated, that section is cleanly omitted at render time rather than rendering broken cards or throwing an error.
- **Authorized Preview Mode (`E07-02`):**
  - Uses the exact same `S-01` presentation components fed from `homepage_drafts` instead of `homepage_publications`, applying the same `enabled === true` and `status = 'published'` catalog filtering rules so staff see accurately what shoppers will see upon publishing (with a non-intrusive preview banner indicating Draft revision and any skipped unpublished product references).

---

## 4. Endpoints & API Contracts

### 4.1 Staff Homepage Content APIs
- `GET /api/v1/admin/content/homepage`
  - Auth: `content.read` or `content.manage`
  - Returns: `{ success: true, draft: { sections, revision, updatedAt, updatedBy }, latestPublication: { version, sourceDraftRevision, publishedAt, publishedBy } | null, csrf }`
- `PUT /api/v1/admin/content/homepage`
  - Auth: `content.manage` + CSRF
  - Body: `{ expectedRevision: number, sections: HomepageSectionConfig[] }`
  - Behavior: Validates schema and catalog references; locks `homepage_drafts` row (`FOR UPDATE`); verifies `expectedRevision` (`409 Conflict` if stale); increments `revision`; writes `audit_events` (`action: "content.homepage.draft.save"`, `resource: "homepage_draft:default"`); returns updated draft.
- `GET /api/v1/admin/content/homepage/preview`
  - Auth: `content.read` or `content.manage`
  - Headers: `Cache-Control: private, no-store`, `X-Robots-Tag: noindex, nofollow`
  - Returns resolved preview projection of the current draft using the `S-01` section view model.
- `POST /api/v1/admin/content/homepage/publish`
  - Auth: `content.manage` + CSRF
  - Body: `{ expectedRevision: number }`
  - Behavior: Inside a PostgreSQL transaction, locks `homepage_drafts`, checks `expectedRevision` (`409` if stale), re-validates section schema and references, inserts immutable `homepage_publications` row (`version = COALESCE(MAX(version), 0) + 1`), writes `audit_events` (`action: "content.homepage.publish"`, `resource: "homepage_publication:{version}"`), commits, and triggers cache invalidation for `/`.

### 4.2 Public Storefront Homepage API & Page
- `GET /api/v1/store/homepage` and Server Component `/` (`src/app/page.tsx`)
  - Auth: Public (Guest / Customer)
  - Returns / renders the latest `homepage_publications` snapshot with resolved public product cards (`id`, `name`, `slug`, `priceMinor`, `comparePriceMinor`, `currency`, `primaryImage: { id, altText } | null`, `inStock: boolean`) and active category links (`id`, `name`, `slug`).

---

## 5. Story Delivery Sequence (`stories.md`)

1. **E07-01 — Homepage sections draft editor:** Migration `0019_homepage_content.sql`, `homepage_drafts` domain/service/API (`GET`/`PUT`), reference validation, audit logging, and `A-12` RTL editor UI (`/admin/content/homepage`) with accessible keyboard reordering.
2. **E07-02 — Authorized preview:** Permission-protected preview API and `/admin/content/homepage/preview` route rendering the draft through `S-01` storefront section components with strict `private, no-store` and `noindex` enforcement.
3. **E07-03 — Publish and public homepage:** `POST /api/v1/admin/content/homepage/publish` creating immutable `homepage_publications` snapshots, cache invalidation, and public `/` (`S-01`) rendering the latest publication with live filtering of unpublished/archived products.

