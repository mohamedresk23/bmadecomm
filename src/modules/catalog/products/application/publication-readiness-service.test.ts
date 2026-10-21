import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../../../db";
import { auditEvents, operationKeys, categories, media, productCategories, productMedia, products, slugRedirects, variants } from "../../../../db/schema";
import { setupTestDb, withIsolatedTx } from "../../../../test-utils/db";
import { evaluatePublicationReadiness, getPublicationReadiness, type PublicationReadinessSnapshot } from "./publication-readiness-service";

const ready = (): PublicationReadinessSnapshot => ({ name: "Name", description: "Description", slug: "name", slugConflict: false,
  variants: [{ id: "v", sku: "SKU", priceMinor: "9223372036854775807" }], images: [{ id: "i", altText: "Image" }], hasCategory: true });

describe("publication readiness", () => {
  beforeAll(setupTestDb);
  it("evaluates every gate with stable ID paths and without mutating input", () => {
    expect(evaluatePublicationReadiness(ready())).toEqual({ isReady: true, issues: [] });
    const snapshot = { ...ready(), name: " \t", description: " \n", slug: "BAD", slugConflict: true,
      variants: [{ id: "z", sku: " ", priceMinor: BigInt(-1) }, { id: "a", sku: "A", priceMinor: BigInt(0) }], images: [{ id: "i", altText: " \t" }], hasCategory: false };
    const before = structuredClone(snapshot);
    const result = evaluatePublicationReadiness(snapshot);
    expect(result.issues.map(issue => [issue.field, issue.code])).toEqual([
      ["name", "MISSING_NAME"], ["description", "MISSING_DESCRIPTION"], ["slug", "INVALID_SLUG"], ["slug", "SLUG_CONFLICT"],
      ["variants.a.priceMinor", "INVALID_PRICE"], ["variants.z.sku", "MISSING_SKU"], ["variants.z.priceMinor", "INVALID_PRICE"],
      ["gallery.i.altText", "MISSING_ALT_TEXT"], ["categoryIds", "MISSING_CATEGORIES"],
    ]);
    expect(evaluatePublicationReadiness(snapshot)).toEqual(result);
    expect(snapshot).toEqual(before);
    expect(evaluatePublicationReadiness({ ...ready(), variants: [], images: [], description: null }).issues.map(issue => issue.code))
      .toEqual(["MISSING_DESCRIPTION", "MISSING_VARIANTS", "MISSING_IMAGES"]);
  });
  it("blocks an invalid sibling even when another variant has a positive bigint price", () => {
    const snapshot = ready();
    snapshot.variants.push({ id: "zero", sku: "ZERO", priceMinor: BigInt(0) });
    expect(evaluatePublicationReadiness(snapshot)).toEqual({ isReady: false, issues: [
      { field: "variants.zero.priceMinor", code: "INVALID_PRICE", message: "Variant price must be greater than zero." },
    ] });
  });
  it("enforces slug format and length boundaries", () => {
    for (const slug of ["", "-slug", "slug-", "repeated--hyphen", "a".repeat(256)]) {
      expect(evaluatePublicationReadiness({ ...ready(), slug }).issues).toEqual([
        { field: "slug", code: "INVALID_SLUG", message: "Enter a valid product slug." },
      ]);
    }
    expect(evaluatePublicationReadiness({ ...ready(), slug: "a".repeat(255) })).toEqual({ isReady: true, issues: [] });
  });
  it("reads the caller transaction, isolates products, ignores removed images and never writes", async () => {
    await withIsolatedTx(async tx => {
      await tx.insert(products).values([{ id: "readiness-p", name: "Product", description: "Details", slug: "readiness-p" }, { id: "readiness-other", name: "Other", slug: "readiness-other" }]);
      await tx.insert(categories).values({ id: "readiness-c", name: "Category", slug: "readiness-c", isActive: false });
      await tx.insert(productCategories).values({ productId: "readiness-p", categoryId: "readiness-c" });
      await tx.insert(variants).values({ id: "readiness-v", productId: "readiness-p", sku: "READINESS", priceMinor: BigInt("9223372036854775807"), currency: "EGP", currencyScale: 2, combinationKey: "", sortOrder: 0 });
      await tx.insert(media).values([{ id: "readiness-m", filename: "private.png", mimeType: "image/png", size: 10, status: "pending" }, { id: "readiness-old", filename: "old.png", mimeType: "image/png", size: 10, status: "pending" }]);
      await tx.insert(productMedia).values([{ id: "readiness-i", productId: "readiness-p", mediaId: "readiness-m", altText: "Image", sortOrder: 0 }, { id: "readiness-old-i", productId: "readiness-p", mediaId: "readiness-old", altText: "", sortOrder: 1, removedAt: new Date() }]);
      await tx.insert(slugRedirects).values({ sourceSlug: "readiness-p", targetSlug: "elsewhere", productId: "readiness-p" });
      const catalogState = async () => ({
        products: await tx.select().from(products), variants: await tx.select().from(variants),
        images: await tx.select().from(productMedia), media: await tx.select().from(media),
        categories: await tx.select().from(productCategories), redirects: await tx.select().from(slugRedirects),
        auditEvents: await tx.select().from(auditEvents), operationKeys: await tx.select().from(operationKeys),
      });
      const stateBefore = await catalogState();
      const before = await tx.select().from(products).where(eq(products.id, "readiness-p"));
      expect(await getPublicationReadiness(tx, "readiness-p")).toEqual({ isReady: true, issues: [] });
      expect(await getPublicationReadiness(tx, "readiness-p")).toEqual({ isReady: true, issues: [] });
      expect(await catalogState()).toEqual(stateBefore);
      await tx.update(productMedia).set({ altText: " \t" }).where(eq(productMedia.id, "readiness-i"));
      expect((await getPublicationReadiness(tx, "readiness-p")).issues).toEqual([
        { field: "gallery.readiness-i.altText", code: "MISSING_ALT_TEXT", message: "Enter alternative text for this image." },
      ]);
      await tx.update(productMedia).set({ removedAt: new Date() }).where(eq(productMedia.id, "readiness-i"));
      expect((await getPublicationReadiness(tx, "readiness-p")).issues).toEqual([
        { field: "gallery", code: "MISSING_IMAGES", message: "Add at least one product image." },
      ]);
      await tx.update(productMedia).set({ altText: "Image", removedAt: null }).where(eq(productMedia.id, "readiness-i"));
      expect((await getPublicationReadiness(tx, "readiness-other")).issues.map(issue => issue.code)).toEqual(["MISSING_DESCRIPTION", "MISSING_VARIANTS", "MISSING_IMAGES", "MISSING_CATEGORIES"]);
      await tx.update(slugRedirects).set({ productId: "readiness-other" });
      expect((await getPublicationReadiness(tx, "readiness-p")).issues.map(issue => issue.code)).toEqual(["SLUG_CONFLICT"]);
      await tx.update(variants).set({ priceMinor: BigInt(0) }).where(eq(variants.id, "readiness-v"));
      expect((await getPublicationReadiness(tx, "readiness-p")).issues.map(issue => issue.code)).toEqual(["SLUG_CONFLICT", "INVALID_PRICE"]);
      expect(await tx.select().from(products).where(eq(products.id, "readiness-p"))).toEqual(before);
      await expect(getPublicationReadiness(tx, "missing")).rejects.toMatchObject({ statusCode: 404 });
    }, db);
  });
});
