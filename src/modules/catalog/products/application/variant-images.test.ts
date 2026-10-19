import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { setupTestDb, withIsolatedTx } from "../../../../test-utils/db";
import { media, productMedia, products, auditEvents } from "../../../../db/schema";
import { createCategory } from "../../categories/application/category-service";
import { createProduct, updateProduct, getProductById } from "./product-service";
import { getGalleryByProductId, resolveVariantImage, updateGallery } from "./gallery-service";

beforeAll(setupTestDb);
describe("variant image aggregate", () => {
  it("preserves retained IDs across SKU/attribute edits and audits removed mappings once", async () => {
    await withIsolatedTx(async tx => {
      const category = await createCategory(tx, { name: "Images" }, "owner");
      const input = { name: "Mapped draft", categoryIds: [category.id], variants: [
        { sku: "MAP-A", priceMinor: "10", attributes: { size: "s" } },
        { sku: "MAP-B", priceMinor: "20", attributes: { size: "m" } },
      ] };
      const product = await createProduct(tx, input, "owner");
      await tx.insert(media).values({ id: "m", filename: "m.png", mimeType: "image/png", size: 10, status: "pending" });
      await tx.insert(productMedia).values({ id: "i", productId: product.id, mediaId: "m", sortOrder: 0, altText: "Front" });
      const mapping = product.variants.map(variant => ({ variantId: variant.id, imageId: "i" }));
      const gallery = await updateGallery(tx, { productId: product.id, staffUserId: "owner", requestId: "map", payload: { expectedRevision: "0", images: [{ id: "i", altText: "Front" }], variantImages: mapping } });
      expect(gallery.revision).toBe("1");
      expect(resolveVariantImage(gallery, product.variants[0].id)?.id).toBe("i");
      expect(resolveVariantImage({ ...gallery, variantImages: [] }, "unmapped")?.id).toBe("i");
      expect(resolveVariantImage({ ...gallery, images: [], primaryImageId: null }, "unmapped")).toBeNull();
      const edited = { ...input, variants: product.variants.map((variant, index) => ({ ...input.variants[index], id: variant.id, sku: index ? "MAP-A" : "MAP-B", attributes: { size: index ? "l" : "xs" } })) };
      await updateProduct(tx, product.id, edited, "owner");
      expect((await getGalleryByProductId(tx, product.id)).variantImages).toEqual(gallery.variantImages);
      expect((await getGalleryByProductId(tx, product.id)).revision).toBe("1");
      await updateProduct(tx, product.id, { ...edited, variants: [edited.variants[0]] }, "owner");
      const after = await getGalleryByProductId(tx, product.id);
      expect(after).toMatchObject({ revision: "2", variantImages: [mapping[0]] });
      await expect(updateGallery(tx, { productId: product.id, staffUserId: "owner", requestId: "stale", payload: { expectedRevision: "1", images: [{ id: "i", altText: "Front" }], variantImages: mapping } })).rejects.toMatchObject({ code: "STALE_GALLERY" });
      expect(JSON.stringify(await getProductById(tx, product.id))).not.toContain("previewUrl");
      const audits = await tx.select().from(auditEvents).where(eq(auditEvents.resource, `product:${product.id}`));
      expect(audits).toHaveLength(4);
      expect(audits[3].diff).toHaveProperty("clearedVariantImages");
    });
  });
  it("rolls back replacement and mapping writes when audit fails", async () => {
    await withIsolatedTx(async tx => {
      const category = await createCategory(tx, { name: "Rollback" }, "owner");
      const input = { name: "Before", categoryIds: [category.id], variants: [{ sku: "ROLL-MAP", priceMinor: "0", attributes: {} }] };
      const product = await createProduct(tx, input, "owner");
      await tx.insert(media).values({ id: "m", filename: "m.png", mimeType: "image/png", size: 10, status: "pending" });
      await tx.insert(productMedia).values({ id: "i", productId: product.id, mediaId: "m", sortOrder: 0, altText: "Front" });
      const payload = { expectedRevision: "0", images: [{ id: "i", altText: "Front" }], variantImages: [{ variantId: product.variants[0].id, imageId: "i" }] };
      await tx.execute(sql.raw("CREATE FUNCTION reject_variant_image_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$"));
      await tx.execute(sql.raw("CREATE TRIGGER reject_variant_image_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_variant_image_audit()"));
      await expect(updateGallery(tx, { productId: product.id, staffUserId: "owner", requestId: "failed", payload })).rejects.toThrow();
      expect((await getGalleryByProductId(tx, product.id)).revision).toBe("0");
      await tx.execute(sql.raw("DROP TRIGGER reject_variant_image_audit ON audit_events"));
      const before = await updateGallery(tx, { productId: product.id, staffUserId: "owner", requestId: "map", payload });
      const beforeProduct = await getProductById(tx, product.id);
      await tx.execute(sql.raw("CREATE TRIGGER reject_variant_image_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_variant_image_audit()"));
      await expect(updateProduct(tx, product.id, { ...input, name: "Failure", variants: [{ ...input.variants[0], id: product.variants[0].id, sku: "CHANGED" }] }, "owner")).rejects.toThrow();
      expect(await getGalleryByProductId(tx, product.id)).toEqual(before);
      expect(await getProductById(tx, product.id)).toEqual(beforeProduct);
      expect((await tx.select().from(products)).length).toBe(1);
    });
  });
});
