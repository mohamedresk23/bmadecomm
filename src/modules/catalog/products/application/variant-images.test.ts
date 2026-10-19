import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { setupTestDb, withIsolatedTx } from "../../../../test-utils/db";
import { media, productMedia, products, auditEvents } from "../../../../db/schema";
import { createCategory } from "../../categories/application/category-service";
import { createProduct, updateProduct, getProductById } from "./product-service";
import { deleteGalleryImage, getGalleryByProductId, resolveVariantImage, updateGallery } from "./gallery-service";

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

  it("soft-removes attachment, clears variant mapping, compacts remaining sortOrder, and increments revision atomically", async () => {
    await withIsolatedTx(async tx => {
      const category = await createCategory(tx, { name: "Remove" }, "owner");
      const input = {
        name: "Remove draft",
        categoryIds: [category.id],
        variants: [
          { sku: "REM-1", priceMinor: "100", attributes: { color: "red" } },
          { sku: "REM-2", priceMinor: "200", attributes: { color: "blue" } },
        ],
      };
      const product = await createProduct(tx, input, "owner");
      await tx.insert(media).values([
        { id: "m0", filename: "m0.png", mimeType: "image/png", size: 100, status: "pending" },
        { id: "m1", filename: "m1.png", mimeType: "image/png", size: 200, status: "pending" },
        { id: "m2", filename: "m2.png", mimeType: "image/png", size: 300, status: "pending" },
      ]);
      await tx.insert(productMedia).values([
        { id: "img0", productId: product.id, mediaId: "m0", sortOrder: 0, altText: "First" },
        { id: "img1", productId: product.id, mediaId: "m1", sortOrder: 1, altText: "Second" },
        { id: "img2", productId: product.id, mediaId: "m2", sortOrder: 2, altText: "Third" },
      ]);
      // Map variant 0 to img0, variant 1 to img1
      await updateGallery(tx, {
        productId: product.id,
        staffUserId: "owner",
        requestId: "init-map",
        payload: {
          expectedRevision: "0",
          images: [{ id: "img0", altText: "First" }, { id: "img1", altText: "Second" }, { id: "img2", altText: "Third" }],
          variantImages: [
            { variantId: product.variants[0].id, imageId: "img0" },
            { variantId: product.variants[1].id, imageId: "img1" },
          ],
        },
      });

      // Remove img0 (the primary image and mapped to variant 0)
      const afterRemove0 = await deleteGalleryImage(tx, {
        productId: product.id,
        imageId: "img0",
        staffUserId: "owner",
        requestId: "delete-0",
        payload: { expectedRevision: "1" },
      });

      expect(afterRemove0.revision).toBe("2");
      expect(afterRemove0.primaryImageId).toBe("img1");
      expect(afterRemove0.images).toHaveLength(2);
      expect(afterRemove0.images[0].id).toBe("img1");
      expect(afterRemove0.images[0].position).toBe(0);
      expect(afterRemove0.images[1].id).toBe("img2");
      expect(afterRemove0.images[1].position).toBe(1);
      // Mapping for img0 cleared; mapping for img1 preserved
      expect(afterRemove0.variantImages).toEqual([{ variantId: product.variants[1].id, imageId: "img1" }]);
      // Unmapped variant 0 falls back to new primary (img1)
      expect(resolveVariantImage(afterRemove0, product.variants[0].id)?.id).toBe("img1");

      // Verify media row survived intact (physical row not deleted)
      const mediaRows = await tx.select().from(media).where(eq(media.id, "m0"));
      expect(mediaRows).toHaveLength(1);
      // productMedia row has removedAt set
      const [pm0] = await tx.select().from(productMedia).where(eq(productMedia.id, "img0"));
      expect(pm0.removedAt).not.toBeNull();

      // Audit recorded
      const audits = await tx.select().from(auditEvents).where(eq(auditEvents.resource, `product:${product.id}`));
      const detachAudit = audits.find(a => a.action === "catalog.product.image.detach");
      expect(detachAudit).toBeTruthy();
      expect(detachAudit?.diff).toMatchObject({
        productMediaId: "img0",
        mediaId: "m0",
        mediaRevision: "2",
      });

      // Stale expectedRevision rejects with 409
      await expect(
        deleteGalleryImage(tx, {
          productId: product.id,
          imageId: "img1",
          staffUserId: "owner",
          requestId: "stale-del",
          payload: { expectedRevision: "1" },
        })
      ).rejects.toMatchObject({ code: "STALE_GALLERY" });

      // Remove img1 and img2 until empty
      await deleteGalleryImage(tx, {
        productId: product.id,
        imageId: "img1",
        staffUserId: "owner",
        requestId: "delete-1",
        payload: { expectedRevision: "2" },
      });
      const emptyGallery = await deleteGalleryImage(tx, {
        productId: product.id,
        imageId: "img2",
        staffUserId: "owner",
        requestId: "delete-2",
        payload: { expectedRevision: "3" },
      });

      expect(emptyGallery.revision).toBe("4");
      expect(emptyGallery.primaryImageId).toBeNull();
      expect(emptyGallery.images).toEqual([]);
      expect(emptyGallery.variantImages).toEqual([]);
      expect(resolveVariantImage(emptyGallery, product.variants[0].id)).toBeNull();
    });
  });
});

