import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql, eq } from "drizzle-orm";
import { runMigrations, rollbackMigration } from "./migrate";
import * as schema from "./schema";

const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

async function checkTableExists(client: PGlite, tableName: string): Promise<boolean> {
  const res = await client.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = '${tableName}'
    ) as exists
  `);
  return Boolean(res.rows[0]?.exists);
}

async function checkIndexExists(client: PGlite, indexName: string): Promise<boolean> {
  const res = await client.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1 
      FROM pg_indexes 
      WHERE schemaname = 'public' 
      AND indexname = '${indexName}'
    ) as exists
  `);
  return Boolean(res.rows[0]?.exists);
}

async function getProductColumns(client: PGlite): Promise<string[]> {
  const res = await client.query<{ column_name: string }>(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'products'
  `);
  return res.rows.map(r => r.column_name);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function expectConstraintViolation(fn: () => Promise<unknown>, constraintName: string) {
  try {
    await fn();
    expect.unreachable(`Expected constraint violation for ${constraintName}`);
  } catch (err: any) {
    const fullError = `${err?.message ?? ""} ${err?.cause?.message ?? ""} ${err?.cause?.constraint ?? ""}`;
    expect(fullError).toContain(constraintName);
  }
}

describe("E04-04-01: Product publish, slug, SEO schema migration (0018)", () => {
  let client: PGlite;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let testDb: any;

  beforeEach(() => {
    client = new PGlite();
    testDb = drizzle(client, { schema });
  });

  afterEach(async () => {
    await client.close();
  });

  it("backfills unique, valid slugs for existing draft products at migration 0017 with collision suffixes and 240-char safety bounds", async () => {
    // 1. Run all migrations up, then roll back 0018 so we are at 0017 state
    await runMigrations({ db: testDb, quiet: true });
    await rollbackMigration({ db: testDb, target: "0017_variant_media", quiet: true });

    // Verify 0018 objects do not exist yet
    expect(await checkTableExists(client, "slug_redirects")).toBe(false);
    let columns = await getProductColumns(client);
    expect(columns).not.toContain("slug");
    expect(columns).not.toContain("meta_title");
    expect(columns).not.toContain("meta_description");
    expect(columns).not.toContain("published_at");

    // 2. Seed draft products without slugs (as existed in 0017), including a 300-char name
    const longName = "A Very Long Product Name Exceeding Two Hundred And Forty Characters " + "repeat ".repeat(40);
    expect(longName.length).toBeGreaterThan(255);

    await testDb.execute(sql`
      INSERT INTO products (id, name, description, status) VALUES
      ('p1', 'Organic Cotton T-Shirt', 'First t-shirt', 'draft'),
      ('p2', 'Organic Cotton T-Shirt', 'Second t-shirt collision', 'draft'),
      ('p3', 'Organic Cotton T-Shirt', 'Third t-shirt collision', 'draft'),
      ('p4', '   ---   ', 'Special characters only fallback to id', 'draft'),
      ('p5', 'Special & Product @ 2026!', 'Punctuation and spaces', 'draft'),
      ('p6', ${longName}, 'Long name over 255 chars', 'draft')
    `);

    // 3. Apply migration 0018
    const result = await runMigrations({ db: testDb, quiet: true });
    expect(result.applied).toEqual(["0018_product_publish_slug_seo"]);

    // 4. Verify columns and table were created
    expect(await checkTableExists(client, "slug_redirects")).toBe(true);
    columns = await getProductColumns(client);
    expect(columns).toContain("slug");
    expect(columns).toContain("meta_title");
    expect(columns).toContain("meta_description");
    expect(columns).toContain("published_at");

    // 5. Inspect backfilled slugs
    const rows = await testDb.execute(sql`
      SELECT id, name, slug FROM products ORDER BY id ASC
    `);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const productRows = (Array.isArray(rows) ? rows : (rows as any)?.rows ?? []) as { id: string; name: string; slug: string }[];

    expect(productRows).toHaveLength(6);
    const slugMap = new Map(productRows.map(r => [r.id, r.slug]));

    // p1 receives base normalized slug
    expect(slugMap.get("p1")).toBe("organic-cotton-t-shirt");
    // p2 and p3 receive collision numeric suffixes -1, -2
    expect(slugMap.get("p2")).toBe("organic-cotton-t-shirt-1");
    expect(slugMap.get("p3")).toBe("organic-cotton-t-shirt-2");
    // p4 had empty name after normalization, so fell back to id
    expect(slugMap.get("p4")).toBe("p4");
    // p5 had symbols converted to hyphens
    expect(slugMap.get("p5")).toBe("special-product-2026");

    // p6 had long name: must be safely bounded <= 255 characters
    const p6Slug = slugMap.get("p6")!;
    expect(p6Slug.length).toBeLessThanOrEqual(240);
    expect(p6Slug).toMatch(SLUG_REGEX);

    // All backfilled slugs must strictly satisfy format regex
    for (const row of productRows) {
      expect(row.slug).toMatch(SLUG_REGEX);
      expect(row.slug).toBe(row.slug.toLowerCase());
      expect(row.slug.startsWith("-")).toBe(false);
      expect(row.slug.endsWith("-")).toBe(false);
      expect(row.slug.includes("--")).toBe(false);
      expect(row.slug.length).toBeLessThanOrEqual(255);
    }
  });

  it("enforces lowercase alphanumeric hyphen slug check constraint, global slug uniqueness, and SEO length limits", async () => {
    await runMigrations({ db: testDb, quiet: true });

    // Valid slug insert succeeds with SEO metadata
    await testDb.execute(sql`
      INSERT INTO products (id, name, slug, meta_title, meta_description)
      VALUES ('p-valid', 'Valid Product', 'organic-cotton-tshirt', 'Valid SEO Title <= 70 chars', 'Valid SEO Description <= 160 chars')
    `);
    const validRow = await client.query<{ slug: string; meta_title: string; meta_description: string }>(
      "SELECT slug, meta_title, meta_description FROM products WHERE id = 'p-valid'"
    );
    expect(validRow.rows[0]?.slug).toBe("organic-cotton-tshirt");
    expect(validRow.rows[0]?.meta_title).toBe("Valid SEO Title <= 70 chars");
    expect(validRow.rows[0]?.meta_description).toBe("Valid SEO Description <= 160 chars");

    // Null SEO metadata succeeds
    await testDb.execute(sql`
      INSERT INTO products (id, name, slug, meta_title, meta_description)
      VALUES ('p-null-seo', 'Null SEO', 'null-seo-product', NULL, NULL)
    `);

    // Invalid slug: uppercase characters rejected by products_slug_normalized
    await expectConstraintViolation(
      () => testDb.execute(sql`INSERT INTO products (id, name, slug) VALUES ('p-bad-1', 'Bad 1', 'Organic Cotton!')`),
      "products_slug_normalized"
    );

    // Invalid slug: leading hyphen rejected
    await expectConstraintViolation(
      () => testDb.execute(sql`INSERT INTO products (id, name, slug) VALUES ('p-bad-2', 'Bad 2', '-bad-')`),
      "products_slug_normalized"
    );

    // Invalid slug: trailing hyphen rejected
    await expectConstraintViolation(
      () => testDb.execute(sql`INSERT INTO products (id, name, slug) VALUES ('p-bad-3', 'Bad 3', 'bad-')`),
      "products_slug_normalized"
    );

    // Invalid slug: consecutive hyphens rejected
    await expectConstraintViolation(
      () => testDb.execute(sql`INSERT INTO products (id, name, slug) VALUES ('p-bad-4', 'Bad 4', 'bad--slug')`),
      "products_slug_normalized"
    );

    // Invalid slug: whitespace rejected
    await expectConstraintViolation(
      () => testDb.execute(sql`INSERT INTO products (id, name, slug) VALUES ('p-bad-5', 'Bad 5', 'bad slug')`),
      "products_slug_normalized"
    );

    // Invalid slug: underscores rejected
    await expectConstraintViolation(
      () => testDb.execute(sql`INSERT INTO products (id, name, slug) VALUES ('p-bad-6', 'Bad 6', 'bad_slug')`),
      "products_slug_normalized"
    );

    // Invalid slug: exceeding max length 255 rejected
    const tooLongSlug = "a".repeat(256);
    await expectConstraintViolation(
      () => testDb.execute(sql`INSERT INTO products (id, name, slug) VALUES ('p-bad-7', 'Bad 7', ${tooLongSlug})`),
      "products_slug_normalized"
    );

    // Duplicate slug insert rejected by products_slug_unique
    await expect(
      testDb.execute(sql`INSERT INTO products (id, name, slug) VALUES ('p-dup', 'Duplicate', 'organic-cotton-tshirt')`)
    ).rejects.toThrow();

    // SEO meta_title exceeding 70 characters rejected by products_meta_title_len
    const tooLongTitle = "a".repeat(71);
    await expectConstraintViolation(
      () => testDb.execute(sql`INSERT INTO products (id, name, slug, meta_title) VALUES ('p-bad-title', 'Bad Title', 'bad-title-slug', ${tooLongTitle})`),
      "products_meta_title_len"
    );

    // SEO meta_description exceeding 160 characters rejected by products_meta_description_len
    const tooLongDesc = "a".repeat(161);
    await expectConstraintViolation(
      () => testDb.execute(sql`INSERT INTO products (id, name, slug, meta_description) VALUES ('p-bad-desc', 'Bad Desc', 'bad-desc-slug', ${tooLongDesc})`),
      "products_meta_description_len"
    );
  });

  it("enforces slug_redirects constraints, prevents self-redirects, validates normalized format, and cascades on product deletion", async () => {
    await runMigrations({ db: testDb, quiet: true });

    // Verify target_slug index was created
    expect(await checkIndexExists(client, "slug_redirects_target_slug_idx")).toBe(true);
    expect(await checkIndexExists(client, "slug_redirects_source_slug_uq")).toBe(true);

    // Insert base product
    await testDb.execute(sql`
      INSERT INTO products (id, name, slug) VALUES ('p-redirect-test', 'Redirect Product', 'current-slug')
    `);

    // Valid redirect insertion
    await testDb.execute(sql`
      INSERT INTO slug_redirects (id, source_slug, target_slug, product_id)
      VALUES ('redir-1', 'old-slug-1', 'current-slug', 'p-redirect-test')
    `);

    const redirRows = await client.query<{ source_slug: string; target_slug: string }>(
      "SELECT source_slug, target_slug FROM slug_redirects WHERE id = 'redir-1'"
    );
    expect(redirRows.rows[0]).toEqual({ source_slug: "old-slug-1", target_slug: "current-slug" });

    // Self-redirect rejected by slug_redirects_no_self_redirect check constraint
    await expectConstraintViolation(
      () => testDb.execute(sql`
        INSERT INTO slug_redirects (id, source_slug, target_slug, product_id)
        VALUES ('redir-self', 'same-slug', 'same-slug', 'p-redirect-test')
      `),
      "slug_redirects_no_self_redirect"
    );

    // Duplicate source_slug rejected by slug_redirects_source_slug_uq unique index
    await expect(
      testDb.execute(sql`
        INSERT INTO slug_redirects (id, source_slug, target_slug, product_id)
        VALUES ('redir-dup', 'old-slug-1', 'other-target', 'p-redirect-test')
      `)
    ).rejects.toThrow();

    // Invalid source_slug format rejected by slug_redirects_source_slug_normalized
    await expectConstraintViolation(
      () => testDb.execute(sql`
        INSERT INTO slug_redirects (id, source_slug, target_slug, product_id)
        VALUES ('redir-bad-src', 'Old Slug!', 'current-slug', 'p-redirect-test')
      `),
      "slug_redirects_source_slug_normalized"
    );

    // Invalid target_slug format rejected by slug_redirects_target_slug_normalized
    await expectConstraintViolation(
      () => testDb.execute(sql`
        INSERT INTO slug_redirects (id, source_slug, target_slug, product_id)
        VALUES ('redir-bad-tgt', 'valid-src', 'Target Slug!', 'p-redirect-test')
      `),
      "slug_redirects_target_slug_normalized"
    );

    // Autofill trigger checks slug_redirects to prevent collision with legacy redirects
    await testDb.execute(sql`
      INSERT INTO products (id, name) VALUES ('p-colliding', 'Old Slug 1')
    `);
    const autoSlugRow = await client.query<{ slug: string }>("SELECT slug FROM products WHERE id = 'p-colliding'");
    // Since 'old-slug-1' was already claimed as a source_slug in slug_redirects, trigger avoided it and assigned suffix
    expect(autoSlugRow.rows[0]?.slug).toBe("old-slug-1-1");

    // Foreign key with ON DELETE CASCADE: deleting the product removes its redirects
    await testDb.execute(sql`DELETE FROM products WHERE id = 'p-redirect-test'`);
    const remainingRedirs = await client.query("SELECT * FROM slug_redirects WHERE id = 'redir-1'");
    expect(remainingRedirs.rows).toHaveLength(0);
  });

  it("supports clean rollback 1 step, drops added tables/columns, and preserves prior product data", async () => {
    await runMigrations({ db: testDb, quiet: true });

    // Seed draft product and variant under 0018
    await testDb.execute(sql`
      INSERT INTO products (id, name, description, slug, meta_title, meta_description, published_at, status)
      VALUES ('retained-product', 'Retained Product', 'Retained description', 'retained-slug', 'Meta Title', 'Meta Desc', NOW(), 'draft')
    `);
    await testDb.execute(sql`
      INSERT INTO variants (id, product_id, sku, combination_key, price_minor, currency, currency_scale, sort_order)
      VALUES ('retained-variant', 'retained-product', 'SKU-0018', '[]', 5000, 'EGP', 2, 0)
    `);
    await testDb.execute(sql`
      INSERT INTO slug_redirects (id, source_slug, target_slug, product_id)
      VALUES ('retained-redir', 'legacy-slug', 'retained-slug', 'retained-product')
    `);

    // Rollback 1 step (reversing 0018)
    const rollback = await rollbackMigration({ db: testDb, steps: 1, quiet: true });
    expect(rollback.rolledBack).toEqual(["0018_product_publish_slug_seo"]);

    // slug_redirects table dropped
    expect(await checkTableExists(client, "slug_redirects")).toBe(false);

    // Columns dropped from products
    const columns = await getProductColumns(client);
    expect(columns).not.toContain("slug");
    expect(columns).not.toContain("meta_title");
    expect(columns).not.toContain("meta_description");
    expect(columns).not.toContain("published_at");

    // Existing product and variant data remain intact
    const productCheck = await client.query<{ id: string; name: string; description: string; status: string }>(
      "SELECT id, name, description, status FROM products WHERE id = 'retained-product'"
    );
    expect(productCheck.rows[0]).toEqual({
      id: "retained-product",
      name: "Retained Product",
      description: "Retained description",
      status: "draft",
    });

    const variantCheck = await client.query<{ sku: string; price_minor: string }>(
      "SELECT sku, price_minor::text FROM variants WHERE id = 'retained-variant'"
    );
    expect(variantCheck.rows[0]).toEqual({ sku: "SKU-0018", price_minor: "5000" });

    // Reapply 0018 up
    const reapply = await runMigrations({ db: testDb, quiet: true });
    expect(reapply.applied).toEqual(["0018_product_publish_slug_seo"]);

    // Schema restored and slug was backfilled for the retained product
    expect(await checkTableExists(client, "slug_redirects")).toBe(true);
    const restoredCols = await getProductColumns(client);
    expect(restoredCols).toContain("slug");

    const restoredProduct = await client.query<{ slug: string }>(
      "SELECT slug FROM products WHERE id = 'retained-product'"
    );
    expect(restoredProduct.rows[0]?.slug).toBe("retained-product");
  });

  it("interoperates seamlessly with Drizzle ORM schema definitions and types, including default ID generation", async () => {
    await runMigrations({ db: testDb, quiet: true });

    // Insert via Drizzle using products and slugRedirects (omitting id on slugRedirects to verify $defaultFn)
    const [insertedProduct] = await testDb.insert(schema.products).values({
      id: "drizzle-p1",
      name: "Drizzle Product",
      slug: "drizzle-product",
      metaTitle: "Drizzle SEO Title",
      metaDescription: "Drizzle SEO Description",
      status: "draft",
    }).returning();

    expect(insertedProduct.slug).toBe("drizzle-product");
    expect(insertedProduct.metaTitle).toBe("Drizzle SEO Title");
    expect(insertedProduct.metaDescription).toBe("Drizzle SEO Description");

    const [insertedRedirect] = await testDb.insert(schema.slugRedirects).values({
      sourceSlug: "old-drizzle-slug",
      targetSlug: "drizzle-product",
      productId: insertedProduct.id,
    }).returning();

    expect(insertedRedirect.id).toBeDefined();
    expect(typeof insertedRedirect.id).toBe("string");
    expect(insertedRedirect.id.length).toBeGreaterThan(0);
    expect(insertedRedirect.sourceSlug).toBe("old-drizzle-slug");
    expect(insertedRedirect.targetSlug).toBe("drizzle-product");
    expect(insertedRedirect.productId).toBe("drizzle-p1");

    // Select with Drizzle relational filter
    const foundRedirects = await testDb
      .select()
      .from(schema.slugRedirects)
      .where(eq(schema.slugRedirects.productId, "drizzle-p1"));

    expect(foundRedirects).toHaveLength(1);
    expect(foundRedirects[0].sourceSlug).toBe("old-drizzle-slug");
  });
});
