import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../../../db";
import { products, productMedia, slugRedirects, variants, variantAttributes, media, auditEvents } from "../../../../db/schema";
import { setupTestDb, withIsolatedTx } from "../../../../test-utils/db";
import { seedPublication } from "../../../../test-utils/publication";
import { resolvePublicProductBySlug } from "./public-product-service";
import { handleSlugRedirects } from "./slug-service";

describe("public product snapshot resolution", () => {
  beforeAll(setupTestDb);
  it("projects only public fields, integer money, ordered active images, Unicode SEO and performs no writes", async () => {
    await withIsolatedTx(async tx => {
      const id = await seedPublication(tx);
      await tx.update(products).set({ status: "published", description: String.fromCodePoint(0x1f600).repeat(161), metaTitle: "  ", metaDescription: " " }).where(eq(products.id, id));
      await tx.update(variants).set({ priceMinor: BigInt("9007199254740993"), comparePriceMinor: BigInt("9007199254740994") }).where(eq(variants.id, `${id}-v`));
      await tx.insert(variantAttributes).values({ variantId: `${id}-v`, name: "color", value: "blue" });
      await tx.insert(media).values([{ id: "second-m", filename: "secret.png", mimeType: "image/png", size: 10, status: "pending" }, { id: "removed-m", filename: "removed.png", mimeType: "image/png", size: 10, status: "pending" }]);
      await tx.insert(productMedia).values([{ id: "second-i", productId: id, mediaId: "second-m", sortOrder: 1, altText: "Second" }, { id: "removed-i", productId: id, mediaId: "removed-m", sortOrder: 2, removedAt: new Date() }]);
      const snapshot = async () => ({ products: await tx.select().from(products), variants: await tx.select().from(variants), images: await tx.select().from(productMedia), media: await tx.select().from(media), redirects: await tx.select().from(slugRedirects), audit: await tx.select().from(auditEvents) });
      const before = await snapshot();
      const select = vi.spyOn(tx, "select");
      const result = await resolvePublicProductBySlug(tx, id);
      expect(select).toHaveBeenCalledTimes(1);
      select.mockRestore();
      expect(result).toEqual({ kind: "product", product: {
        id, name: "Publishable", description: String.fromCodePoint(0x1f600).repeat(161), slug: id,
        metaTitle: "Publishable", metaDescription: String.fromCodePoint(0x1f600).repeat(160),
        variants: [{ id: `${id}-v`, sku: `${id}-sku`.toUpperCase(), priceMinor: "9007199254740993", comparePriceMinor: "9007199254740994", currency: "EGP", currencyScale: 2, attributes: { color: "blue" } }],
        images: [{ id: `${id}-i`, position: 0, altText: "Product image" }, { id: "second-i", position: 1, altText: "Second" }],
      } });
      expect(await snapshot()).toEqual(before);
      await tx.update(products).set({ metaTitle: " Custom ", metaDescription: " Description " }).where(eq(products.id, id));
      expect(await resolvePublicProductBySlug(tx, id)).toMatchObject({ product: { metaTitle: " Custom ", metaDescription: " Description " } });
    });
  });
  it("orders variants by position and then ID regardless of insertion order", async () => {
    await withIsolatedTx(async tx => {
      const id = await seedPublication(tx);
      await tx.update(products).set({ status: "published" }).where(eq(products.id, id));
      await tx.update(variants).set({ sortOrder: 2 }).where(eq(variants.id, `${id}-v`));
      await tx.insert(variants).values([
        { id: "z-first", sortOrder: 0 },
        { id: "b-tied", sortOrder: 1 },
        { id: "a-tied", sortOrder: 1 },
      ].map(variant => ({ ...variant, productId: id, sku: variant.id.toUpperCase(), combinationKey: variant.id, priceMinor: BigInt(100), currency: "EGP", currencyScale: 2 })));
      const result = await resolvePublicProductBySlug(tx, id);
      expect(result.kind).toBe("product");
      if (result.kind !== "product") throw new Error("Expected public product");
      expect(result.product.variants.map(variant => variant.id)).toEqual(["z-first", "a-tied", "b-tied", `${id}-v`]);
    });
  });
  it("prefers a direct published product and preserves nullable and empty public fields", async () => {
    await withIsolatedTx(async tx => {
      const owner = await seedPublication(tx);
      await tx.update(products).set({ status: "published" }).where(eq(products.id, owner));
      await tx.insert(slugRedirects).values({ sourceSlug: "direct-slug", targetSlug: owner, productId: owner });
      await tx.insert(products).values({ id: "direct-product", name: "Direct product", slug: "direct-slug", status: "published", description: null });
      await tx.insert(variants).values({ id: "direct-variant", productId: "direct-product", sku: "DIRECT-SKU", combinationKey: "", priceMinor: BigInt(100), comparePriceMinor: null, currency: "EGP", currencyScale: 2, sortOrder: 0 });
      expect(await resolvePublicProductBySlug(tx, "direct-slug")).toEqual({ kind: "product", product: {
        id: "direct-product", name: "Direct product", slug: "direct-slug", description: null,
        metaTitle: "Direct product", metaDescription: "", images: [],
        variants: [{ id: "direct-variant", sku: "DIRECT-SKU", priceMinor: "100", comparePriceMinor: null, currency: "EGP", currencyScale: 2, attributes: {} }],
      } });
    });
  });
  it("follows owner canonical slug through chains, draft edits and stale targets", async () => {
    await withIsolatedTx(async tx => {
      const id = await seedPublication(tx);
      await tx.update(products).set({ status: "published" }).where(eq(products.id, id));
      await handleSlugRedirects(tx, id, id, "middle", "published");
      await tx.update(products).set({ slug: "middle" }).where(eq(products.id, id));
      await handleSlugRedirects(tx, id, "middle", "canonical", "published");
      await tx.update(products).set({ slug: "canonical" }).where(eq(products.id, id));
      for (const slug of [id, "middle"]) expect(await resolvePublicProductBySlug(tx, slug)).toEqual({ kind: "redirect", location: "/products/canonical" });
      await tx.update(products).set({ status: "draft", slug: "draft-edit" }).where(eq(products.id, id));
      for (const slug of [id, "middle", "draft-edit"]) expect(await resolvePublicProductBySlug(tx, slug)).toEqual({ kind: "not-found" });
      await tx.insert(products).values({ id: "other", name: "Other", slug: "canonical", status: "published" });
      await tx.update(products).set({ status: "published" }).where(eq(products.id, id));
      expect(await resolvePublicProductBySlug(tx, "middle")).toEqual({ kind: "redirect", location: "/products/draft-edit" });
      // A direct unavailable match wins over a redirect belonging to another owner.
      await tx.insert(products).values({ id: "direct", name: "Direct", slug: "middle" });
      expect(await resolvePublicProductBySlug(tx, "middle")).toEqual({ kind: "not-found" });
      await tx.update(products).set({ status: "archived" }).where(eq(products.id, id));
      for (const slug of [id, "draft-edit"]) expect(await resolvePublicProductBySlug(tx, slug)).toEqual({ kind: "not-found" });
    });
  });
  it.each(["", "UPPER", " space", "two--parts", "trailing-", "a/b", "a".repeat(256), undefined, "missing"])("hides malformed or missing slug %s", async slug => {
    expect(await resolvePublicProductBySlug(db, slug)).toEqual({ kind: "not-found" });
  });
});

