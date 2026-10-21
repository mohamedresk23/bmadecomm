# E04-04 Implementation Contract

Created: 2026-10-20.
Scope: Product Publish, Slug Redirects, and SEO Metadata.
Building on: E04-02 (Product & Variant Drafts) and E04-03 (Product Images).

---

## 1. Database Schema Specifications (Migration 0017)

### 1.1 Alterations to `products` table
Add the following columns to `products`:
* `slug`: `text("slug").notNull()`. Format constraint: `^[a-z0-9]+(-[a-z0-9]+)*$`, length between 1 and 255. Unique index: `uniqueIndex("products_slug_unique").on(t.slug)`.
  * *Migration backfill strategy*: For existing rows without slugs, compute `lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'))`, trim hyphens, and append numeric suffix on collisions.
* `meta_title`: `text("meta_title")` — nullable, max 70 characters.
* `meta_description`: `text("meta_description")` — nullable, max 160 characters.
* `published_at`: `timestamp("published_at", { withTimezone: true })` — nullable. Set on first publication, kept or refreshed per policy.

### 1.2 New table `slug_redirects`
```typescript
export const slugRedirects = pgTable("slug_redirects", {
  id: text("id").primaryKey(),
  sourceSlug: text("source_slug").notNull(),
  targetSlug: text("target_slug").notNull(),
  productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  uniqueIndex("slug_redirects_source_slug_uq").on(t.sourceSlug),
  index("slug_redirects_product_id_idx").on(t.productId),
  check("slug_redirects_no_self_redirect", sql`${t.sourceSlug} <> ${t.targetSlug}`),
]);
```

---

## 2. Business Rules & Validation Contract

### 2.1 Slug Rules & Normalization
1. **Normalization**: Slugs must be lowercase, alphanumeric with hyphens, no consecutive hyphens, no leading/trailing hyphens (`^[a-z0-9]+(-[a-z0-9]+)*$`).
2. **Uniqueness**:
   - A new slug cannot collide with any existing product slug.
   - A new slug cannot collide with an active `slug_redirects.source_slug` pointing to a different product unless that redirect is reassigned/retired.
3. **Redirect Creation & Chain Collapsing**:
   - When a product is currently `published` and its `slug` is changed from `old_slug` to `new_slug`:
     - If `old_slug` had existing redirects pointing to it (e.g. `prev_slug -> old_slug`), update all existing rows where `targetSlug = old_slug` to set `targetSlug = new_slug` (one-hop direct resolution).
     - Insert a new redirect: `sourceSlug = old_slug`, `targetSlug = new_slug`, `productId = product.id`.
     - If `new_slug` previously existed as a redirect pointing to this same product, delete that row to prevent a cycle (`A -> B` followed by `B -> A`).

### 2.2 Publication Gate Evaluation Matrix (FR-14, FR-15, AC-19)
A product can only transition from `draft` to `published` if it satisfies **all** readiness checks:
1. **Basic Info**:
   - `name`: non-empty, trimmed, min 1 character.
   - `description`: non-empty string.
   - `slug`: non-empty, valid slug format, globally unique.
2. **Variants**:
   - At least 1 active variant must exist.
   - Each variant must have a non-empty `sku` and a `priceMinor > 0`.
3. **Gallery & Media (FR-15)**:
   - At least 1 active image attached to the product in `product_media`.
   - Every active attachment (`removedAt IS NULL`) must have a non-empty `altText` (trimmed length > 0).
4. **Categories**:
   - At least 1 category associated in `product_categories`.
5. **Errors response**:
   - If any condition is unmet, return HTTP 422 with structured issue list:
   ```json
   {
     "error": "PUBLICATION_READINESS_FAILED",
     "message": "Product does not meet the requirements for publication.",
     "issues": [
       { "field": "gallery", "code": "MISSING_ALT_TEXT", "message": "Image 1 is missing alternative text." }
     ]
   }
   ```

### 2.3 Unpublish Rules
- Unpublishing a product changes `status` from `published` back to `draft`.
- The slug and redirects remain intact.
- An unpublish audit event is recorded.
- Immediate consequence: Public requests for this product slug will instantly return 404.

---

## 3. Endpoints & API Contracts

### 3.1 Staff Catalog APIs (Requires `requireCatalogStaffSession`)
* `GET /api/catalog/products/[id]/readiness`
  * Evaluates current product state against publication rules without changing status.
  * Returns: `{ isReady: boolean, issues: { field: string, code: string, message: string }[] }`
* `POST /api/catalog/products/[id]/publish`
  * Body: `{}` (or revision guard)
  * Runs readiness evaluation inside a PostgreSQL transaction.
  * If valid: updates `status = 'published'`, sets `publishedAt = NOW()`, writes audit log `product.publish`.
  * Returns: `200 OK` with updated product summary.
* `POST /api/catalog/products/[id]/unpublish`
  * Updates `status = 'draft'`, writes audit log `product.unpublish`.
  * Returns: `200 OK`.
* `PUT /api/catalog/products/[id]/seo`
  * Body: `{ slug?: string, metaTitle?: string | null, metaDescription?: string | null }`
  * Validates slug format and uniqueness; applies redirect creation/collapse if published.
  * Writes audit log `product.seo_update`.

### 3.2 Public Catalog Storefront Resolution (Customer & Guest)
* `GET /api/public/products/by-slug/[slug]`
  * If `products.slug == slug AND products.status == 'published'`:
    * Returns `200 OK` with public product DTO (id, name, description, slug, variants, images, SEO meta).
  * Else, query `slug_redirects WHERE source_slug = slug`:
    * If found: returns `301 Moved Permanently` with `Location: /products/${targetSlug}` or `{ redirectUrl: ... }`.
  * Else:
    * Returns `404 Not Found` (Drafts and Archived products strictly return 404; AC-19).

---

## 4. Proposed Story Breakdown for Sprint Execution

1. **E04-04-01**: Database migration 0017 (slug, meta fields, published_at, and slug_redirects table).
2. **E04-04-02**: Slug validation, uniqueness enforcement, and redirect chain collapsing service.
3. **E04-04-03**: Product publication readiness evaluation service & GET readiness endpoint.
4. **E04-04-04**: Atomic publish & unpublish actions with audit logging.
5. **E04-04-05**: Public catalog slug resolution and 301 redirection handler (enforcing draft isolation).
6. **E04-04-06**: Admin UI integration (Publish button, readiness issue callouts, Slug/SEO form fields).

