import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { setupTestDb, withIsolatedTx } from "../../../../test-utils/db";
import { products, slugRedirects } from "../../../../db/schema";
import {
  SLUG_REGEX,
  MAX_SLUG_LENGTH,
  MAX_BASE_SLUG_LENGTH,
  normalizeSlug,
  isValidSlug,
  slugify,
  deriveBaseSlug,
  assertSlugAvailable,
  generateUniqueSlug,
  handleSlugRedirects,
} from "./slug-service";

beforeAll(setupTestDb);

describe("slug-service unit tests", () => {
  it("normalizes and validates slug strings according to format rules", () => {
    expect(normalizeSlug("  Summer-Shirt-2026  ")).toBe("summer-shirt-2026");
    expect(normalizeSlug("LIVE-A")).toBe("live-a");

    expect(isValidSlug("summer-shirt")).toBe(true);
    expect(isValidSlug("a")).toBe(true);
    expect(isValidSlug("product-123-x")).toBe(true);
    expect(isValidSlug("a".repeat(255))).toBe(true);

    // Invalid format
    expect(isValidSlug("")).toBe(false);
    expect(isValidSlug("   ")).toBe(false);
    expect(isValidSlug("Bad_Slug!")).toBe(false);
    expect(isValidSlug("-leading")).toBe(false);
    expect(isValidSlug("trailing-")).toBe(false);
    expect(isValidSlug("double--hyphen")).toBe(false);
    expect(isValidSlug("Upper-Case")).toBe(false);
    expect(isValidSlug("with space")).toBe(false);
    expect(isValidSlug("a".repeat(256))).toBe(false);
    expect(isValidSlug(null)).toBe(false);
    expect(isValidSlug(undefined)).toBe(false);
  });

  it("slugifies text into safe kebab-case with bounding, Unicode decomposition and trailing hyphen trimming", () => {
    expect(slugify("Summer Linen Shirt")).toBe("summer-linen-shirt");
    expect(slugify("Shirt #1 (Special Edition)!")).toBe("shirt-1-special-edition");
    expect(slugify("---Multiple---Dashes---")).toBe("multiple-dashes");
    // Accented Latin characters convert to their base equivalents
    expect(slugify("Café au Lait")).toBe("cafe-au-lait");
    expect(slugify("Crème Brûlée")).toBe("creme-brulee");
    expect(slugify("Schön")).toBe("schon");
    // Non-Latin characters yield empty string
    expect(slugify("قميص صيفي")).toBe("");

    // Maximum base slug length is 240
    const longText = "a".repeat(300);
    const slugified = slugify(longText, MAX_BASE_SLUG_LENGTH);
    expect(slugified.length).toBe(240);
    expect(slugified).toBe("a".repeat(240));

    // Trailing hyphen after slice is trimmed
    const textEndingHyphen = "a".repeat(239) + "-b";
    expect(slugify(textEndingHyphen, 240)).toBe("a".repeat(239));
  });

  it("derives base slug with proper fallbacks when name yields empty slug", () => {
    expect(deriveBaseSlug("Summer Linen Shirt")).toBe("summer-linen-shirt");
    // Arabic name produces empty slug -> fallback to productId
    expect(deriveBaseSlug("قميص صيفي", "prd_custom_123")).toBe("prd-custom-123");
    // Empty name and empty productId -> fallback to "product"
    expect(deriveBaseSlug("قميص صيفي", "")).toBe("product");
    expect(deriveBaseSlug("", undefined)).toBe("product");
  });
});

describe("slug-service database integration", () => {
  it("assertSlugAvailable validates format and enforces uniqueness against products and redirects", async () => {
    await withIsolatedTx(async tx => {
      // Seed a product and a redirect
      await tx.insert(products).values({
        id: "prod-1",
        name: "Existing Product",
        slug: "existing-slug",
      });

      await tx.insert(products).values({
        id: "prod-2",
        name: "Second Product",
        slug: "other-slug",
      });

      await tx.insert(slugRedirects).values({
        id: "redir-1",
        sourceSlug: "legacy-redirect-slug",
        targetSlug: "existing-slug",
        productId: "prod-1",
      });

      // Free slug passes
      await expect(assertSlugAvailable(tx, "completely-new-slug")).resolves.toBeUndefined();

      // Invalid format throws 422
      await expect(assertSlugAvailable(tx, "Bad_Slug!")).rejects.toMatchObject({
        statusCode: 422,
        details: [{ field: "slug" }],
      });

      // Duplicate product slug throws 409
      await expect(assertSlugAvailable(tx, "existing-slug")).rejects.toMatchObject({
        statusCode: 409,
        details: [{ field: "slug" }],
      });

      // Same product updating to its own slug passes
      await expect(assertSlugAvailable(tx, "existing-slug", "prod-1")).resolves.toBeUndefined();

      // Another product trying to claim existing-slug throws 409
      await expect(assertSlugAvailable(tx, "existing-slug", "prod-2")).rejects.toMatchObject({
        statusCode: 409,
        details: [{ field: "slug" }],
      });

      // Claiming a redirect belonging to another product throws 409
      await expect(assertSlugAvailable(tx, "legacy-redirect-slug", "prod-2")).rejects.toMatchObject({
        statusCode: 409,
        details: [{ field: "slug" }],
      });

      // Same product reclaiming its own redirect slug passes (for cycle prevention)
      await expect(assertSlugAvailable(tx, "legacy-redirect-slug", "prod-1")).resolves.toBeUndefined();
    });
  });

  it("generateUniqueSlug generates unique candidate and appends incrementing suffixes on collision", async () => {
    await withIsolatedTx(async tx => {
      // Seed products and redirects
      await tx.insert(products).values({
        id: "prod-1",
        name: "Summer Shirt",
        slug: "summer-shirt",
      });

      await tx.insert(products).values({
        id: "prod-2",
        name: "Summer Shirt 1",
        slug: "summer-shirt-1",
      });

      await tx.insert(slugRedirects).values({
        id: "redir-1",
        sourceSlug: "summer-shirt-2",
        targetSlug: "summer-shirt",
        productId: "prod-1",
      });

      // Generating for a brand new name returns the direct slug
      const uniqueDirect = await generateUniqueSlug(tx, "Winter Jacket");
      expect(uniqueDirect).toBe("winter-jacket");

      // Collisions against products and redirects increment suffix:
      // summer-shirt (taken) -> summer-shirt-1 (taken) -> summer-shirt-2 (taken as redirect) -> summer-shirt-3 (free)
      const resolvedSlug = await generateUniqueSlug(tx, "Summer Shirt");
      expect(resolvedSlug).toBe("summer-shirt-3");

      // Fallback to productId if name is Arabic
      const arabicSlug = await generateUniqueSlug(tx, "قميص صيفي", "prd_arabic_99");
      expect(arabicSlug).toBe("prd-arabic-99");
    });
  });

  it("handleSlugRedirects manages draft edits, published redirects, chain collapsing and cycle prevention", async () => {
    await withIsolatedTx(async tx => {
      const productId = "prod-lifecycle";
      await tx.insert(products).values({
        id: productId,
        name: "Lifecycle Product",
        slug: "draft-a",
        status: "draft",
      });

      // 1. Edit slug on Draft product -> 0 rows added to slug_redirects
      await handleSlugRedirects(tx, productId, "draft-a", "draft-b", "draft");
      const draftRedirects = await tx
        .select()
        .from(slugRedirects)
        .where(eq(slugRedirects.productId, productId));
      expect(draftRedirects).toHaveLength(0);

      // Unchanged slug -> 0 rows added
      await handleSlugRedirects(tx, productId, "draft-b", "draft-b", "published");
      expect(await tx.select().from(slugRedirects).where(eq(slugRedirects.productId, productId))).toHaveLength(0);

      // 2. Edit slug on Published product (live-a -> live-b) -> 1 row added
      await tx.update(products).set({ status: "published", slug: "live-a" }).where(eq(products.id, productId));
      await handleSlugRedirects(tx, productId, "live-a", "live-b", "published");

      const redirectsAfterFirstEdit = await tx
        .select()
        .from(slugRedirects)
        .where(eq(slugRedirects.productId, productId));
      expect(redirectsAfterFirstEdit).toHaveLength(1);
      expect(redirectsAfterFirstEdit[0].sourceSlug).toBe("live-a");
      expect(redirectsAfterFirstEdit[0].targetSlug).toBe("live-b");

      // 3. Chain collapsing (live-b -> live-c):
      // live-a -> live-b collapses to live-a -> live-c, and new row live-b -> live-c added
      await tx.update(products).set({ slug: "live-b" }).where(eq(products.id, productId));
      await handleSlugRedirects(tx, productId, "live-b", "live-c", "published");

      const redirectsAfterSecondEdit = await tx
        .select()
        .from(slugRedirects)
        .where(eq(slugRedirects.productId, productId))
        .orderBy(slugRedirects.sourceSlug);
      expect(redirectsAfterSecondEdit).toHaveLength(2);
      expect(redirectsAfterSecondEdit[0]).toMatchObject({ sourceSlug: "live-a", targetSlug: "live-c" });
      expect(redirectsAfterSecondEdit[1]).toMatchObject({ sourceSlug: "live-b", targetSlug: "live-c" });

      // 4. Multi-hop collapsing (live-c -> live-d):
      // All prior redirects (live-a, live-b, live-c) must point directly to live-d
      await tx.update(products).set({ slug: "live-c" }).where(eq(products.id, productId));
      await handleSlugRedirects(tx, productId, "live-c", "live-d", "published");

      const redirectsAfterThirdEdit = await tx
        .select()
        .from(slugRedirects)
        .where(eq(slugRedirects.productId, productId))
        .orderBy(slugRedirects.sourceSlug);
      expect(redirectsAfterThirdEdit).toHaveLength(3);
      expect(redirectsAfterThirdEdit[0]).toMatchObject({ sourceSlug: "live-a", targetSlug: "live-d" });
      expect(redirectsAfterThirdEdit[1]).toMatchObject({ sourceSlug: "live-b", targetSlug: "live-d" });
      expect(redirectsAfterThirdEdit[2]).toMatchObject({ sourceSlug: "live-c", targetSlug: "live-d" });

      // 5. Cycle prevention: Revert product slug from live-d back to live-a
      // Must delete live-a -> live-d, collapse live-b and live-c to live-a, and insert live-d -> live-a
      await tx.update(products).set({ slug: "live-d" }).where(eq(products.id, productId));
      await handleSlugRedirects(tx, productId, "live-d", "live-a", "published");

      const redirectsAfterCycle = await tx
        .select()
        .from(slugRedirects)
        .where(eq(slugRedirects.productId, productId))
        .orderBy(slugRedirects.sourceSlug);

      // Verify no self-redirect (live-a -> live-a) and no cycle exists
      expect(redirectsAfterCycle).toHaveLength(3);
      expect(redirectsAfterCycle.some(r => r.sourceSlug === r.targetSlug)).toBe(false);
      expect(redirectsAfterCycle.find(r => r.sourceSlug === "live-a")).toBeUndefined();
      expect(redirectsAfterCycle[0]).toMatchObject({ sourceSlug: "live-b", targetSlug: "live-a" });
      expect(redirectsAfterCycle[1]).toMatchObject({ sourceSlug: "live-c", targetSlug: "live-a" });
      expect(redirectsAfterCycle[2]).toMatchObject({ sourceSlug: "live-d", targetSlug: "live-a" });

      // 6. Chain collapsing on an unpublished product that previously had redirects:
      // If product returns to draft, editing slug from live-a to draft-c should still collapse
      // existing redirects (live-b -> draft-c, live-c -> draft-c, live-d -> draft-c)
      // but NOT insert a new row for live-a -> draft-c.
      await tx.update(products).set({ status: "draft", slug: "live-a" }).where(eq(products.id, productId));
      await handleSlugRedirects(tx, productId, "live-a", "draft-c", "draft");

      const redirectsAfterDraftEdit = await tx
        .select()
        .from(slugRedirects)
        .where(eq(slugRedirects.productId, productId))
        .orderBy(slugRedirects.sourceSlug);
      expect(redirectsAfterDraftEdit).toHaveLength(3);
      expect(redirectsAfterDraftEdit.find(r => r.sourceSlug === "live-a")).toBeUndefined();
      expect(redirectsAfterDraftEdit[0]).toMatchObject({ sourceSlug: "live-b", targetSlug: "draft-c" });
      expect(redirectsAfterDraftEdit[1]).toMatchObject({ sourceSlug: "live-c", targetSlug: "draft-c" });
      expect(redirectsAfterDraftEdit[2]).toMatchObject({ sourceSlug: "live-d", targetSlug: "draft-c" });
    });
  });

  it("scopes chain collapsing strictly to the current product and never mutates other products' redirects", async () => {
    await withIsolatedTx(async tx => {
      // Seed two products
      await tx.insert(products).values({
        id: "p-alpha",
        name: "Alpha Product",
        slug: "target-shared",
        status: "published",
      });

      await tx.insert(products).values({
        id: "p-beta",
        name: "Beta Product",
        slug: "beta-active",
        status: "published",
      });

      // Insert redirect for p-alpha pointing to target-shared
      await tx.insert(slugRedirects).values({
        id: "redir-alpha",
        sourceSlug: "alpha-source",
        targetSlug: "target-shared",
        productId: "p-alpha",
      });

      // Insert redirect for p-beta also having target-shared as target (if it was pointing to same target)
      await tx.insert(slugRedirects).values({
        id: "redir-beta",
        sourceSlug: "beta-source",
        targetSlug: "target-shared",
        productId: "p-beta",
      });

      // Update p-alpha from target-shared to alpha-new
      await handleSlugRedirects(tx, "p-alpha", "target-shared", "alpha-new", "published");

      // Verify p-alpha's redirect was updated to alpha-new
      const alphaRedir = await tx.select().from(slugRedirects).where(eq(slugRedirects.id, "redir-alpha"));
      expect(alphaRedir[0].targetSlug).toBe("alpha-new");

      // Verify p-beta's redirect was NOT mutated
      const betaRedir = await tx.select().from(slugRedirects).where(eq(slugRedirects.id, "redir-beta"));
      expect(betaRedir[0].targetSlug).toBe("target-shared");
    });
  });
});
