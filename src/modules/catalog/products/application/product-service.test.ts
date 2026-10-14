import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { setupTestDb, withIsolatedTx } from "../../../../test-utils/db";
import { withTransaction } from "../../../../db/tx";
import { auditEvents, products, storeSettings, variants } from "../../../../db/schema";
import { createCategory, deleteCategory } from "../../categories/application/category-service";
import { createProduct, updateProduct, getProductById, listProducts, getProductFormMetadata } from "./product-service";
import { CreateProductInput } from "../contracts/product";

beforeAll(setupTestDb);
describe("product draft persistence", () => {
  it("persists a matrix, edits atomically with retained IDs and audits, and hides drafts publicly", async () => {
    await withIsolatedTx(async tx => {
      const category = await createCategory(tx, { name: "Clothes" }, "owner");
      const input = { name: "Shirt", description: "Cotton", categoryIds: [category.id], variants: [
        { sku: " shirt-red ", priceMinor: "9007199254740993", comparePriceMinor: "9007199254740994", attributes: { Color: "Red", Size: "M" } },
        { sku: "shirt-blue", priceMinor: "29", attributes: { Size: "M", Color: "Blue" } },
      ] };
      const draft = await createProduct(tx, input, "owner", "create-request");
      expect(draft.status).toBe("draft");
      expect(draft.categoryIds).toEqual([category.id]);
      expect(draft.variants[0].priceMinor).toBe("9007199254740993");
      expect(draft.variants[0].attributes).toEqual({ color: "red", size: "m" });
      const [settings] = await tx.select().from(storeSettings);
      expect(draft.variants[0].currency).toBe(settings.currency);
      expect(draft.variants[0].currencyScale).toBe(settings.currencyExponent);
      expect(await getProductById(tx, draft.id)).toEqual(draft);
      expect((await listProducts(tx, true)).some(product => product.id === draft.id)).toBe(false);
      await expect(getProductById(tx, draft.id, true)).rejects.toMatchObject({ statusCode: 404 });
      await expect(deleteCategory(tx, category.id, "owner")).rejects.toMatchObject({ statusCode: 409, message: "Cannot delete category assigned to products" });
      const updated = await updateProduct(tx, draft.id, { ...input, name: "Edited", variants: [
        { ...input.variants[1], id: draft.variants[0].id }, { ...input.variants[0], id: draft.variants[1].id },
      ] }, "owner", "edit-request");
      expect(updated.variants.map(variant => variant.id)).toEqual(draft.variants.map(variant => variant.id));
      expect(updated.status).toBe("draft");
      expect((await getProductById(tx, draft.id)).name).toBe("Edited");
      const audits = await tx.select().from(auditEvents).where(eq(auditEvents.resource, `product:${draft.id}`));
      expect(audits.map(event => event.action)).toEqual(["product.created", "product.updated"]);
      expect(audits[1].requestId).toBe("edit-request");
      await tx.update(products).set({ status: "published" }).where(eq(products.id, draft.id));
      expect((await getProductById(tx, draft.id, true)).variants).toHaveLength(2);
      const privateDraft = await createProduct(tx, { ...input, variants: [{ sku: "PRIVATE", priceMinor: "1", attributes: {} }] }, "owner");
      const publicProducts = await listProducts(tx, true);
      expect(publicProducts.find(product => product.id === draft.id)?.variants).toEqual(updated.variants);
      expect(publicProducts.some(product => product.id === privateDraft.id)).toBe(false);
      await expect(updateProduct(tx, draft.id, input, "owner")).rejects.toMatchObject({ statusCode: 409 });
    });
  });
  it("leaves all business and audit state intact after invalid create or edit", async () => {
    await withIsolatedTx(async tx => {
      const category = await createCategory(tx, { name: "Test" }, "owner");
      const input: CreateProductInput = { name: "Original", categoryIds: [category.id], variants: [{ sku: "unique", priceMinor: "100", attributes: {} }] };
      const draft = await createProduct(tx, input, "owner");
      const beforeAudits = await tx.select().from(auditEvents);
      await expect(createProduct(tx, input, "owner")).rejects.toMatchObject({ statusCode: 409 });
      await expect(updateProduct(tx, draft.id, { ...input, name: "Invalid", categoryIds: ["missing"] }, "owner")).rejects.toMatchObject({ statusCode: 422 });
      await expect(updateProduct(tx, draft.id, { ...input, variants: [{ ...input.variants[0], id: "forged" }] }, "owner")).rejects.toMatchObject({ statusCode: 422 });
      await expect(createProduct(tx, { ...input, variants: [{ sku: "A", priceMinor: "0", attributes: { size: "s" } }, { sku: " a ", priceMinor: "1", attributes: { size: "m" } }] }, "owner")).rejects.toMatchObject({ statusCode: 409 });
      expect(await getProductById(tx, draft.id)).toEqual(draft);
      expect(await tx.select().from(auditEvents)).toEqual(beforeAudits);
      expect(await tx.select().from(products)).toHaveLength(1);
    });
  });
  it("rolls back complete create and edit when transactional audit writing fails", async () => {
    await withIsolatedTx(async tx => {
      const category = await createCategory(tx, { name: "Test" }, "owner");
      const input = { name: "Original", categoryIds: [category.id], variants: [{ sku: "audit-test", priceMinor: "100", attributes: {} }] };
      const draft = await createProduct(tx, input, "owner");
      await tx.execute(sql.raw("CREATE FUNCTION reject_product_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'product.%' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$"));
      await tx.execute(sql.raw("CREATE TRIGGER reject_product_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_product_audit()"));
      await expect(updateProduct(tx, draft.id, { ...input, name: "Failed", variants: [{ ...input.variants[0], id: draft.variants[0].id, priceMinor: "200" }] }, "owner")).rejects.toThrow();
      await expect(createProduct(tx, { ...input, variants: [{ ...input.variants[0], sku: "new-failed" }] }, "owner")).rejects.toThrow();
      expect(await getProductById(tx, draft.id)).toEqual(draft);
      expect(await tx.select().from(products)).toHaveLength(1);
      expect(await tx.select().from(auditEvents).where(eq(auditEvents.resource, `product:${draft.id}`))).toHaveLength(1);
    });
  });
  it("enforces database SKU, combination, foreign key and monetary constraints", async () => {
    await withIsolatedTx(async tx => {
      const category = await createCategory(tx, { name: "Test" }, "owner");
      const draft = await createProduct(tx, { name: "Simple", categoryIds: [category.id], variants: [{ sku: "DB-ONE", priceMinor: "0", attributes: {} }] }, "owner");
      const [row] = await tx.select().from(variants).where(eq(variants.productId, draft.id));
      for (const change of [{ sku: "DB-ONE", combinationKey: "other" }, { sku: "DB-TWO" }, { sku: "DB-TWO", combinationKey: "other", priceMinor: BigInt(-1) }, { sku: "DB-TWO", combinationKey: "other", comparePriceMinor: BigInt(-1) }, { sku: "lower", combinationKey: "other" }, { sku: "DB-TWO", combinationKey: "other", productId: "missing" }]) {
        await expect(withTransaction(tx, async nested => { await nested.insert(variants).values({ ...row, id: "constraint-probe", ...change }); })).rejects.toThrow();
      }
      expect(await getProductById(tx, draft.id)).toEqual(draft);
    });
  });
  it("translates a database-time SKU collision after rollback and keeps the connection usable", async () => {
    await withIsolatedTx(async tx => {
      const category = await createCategory(tx, { name: "Test" }, "owner");
      const input = { name: "Original", categoryIds: [category.id], variants: [{ sku: "DB-COLLISION", priceMinor: "0", attributes: {} }] };
      const draft = await createProduct(tx, input, "owner");
      // Simulate a conflict materializing after the service's preflight query.
      await tx.execute(sql.raw("CREATE FUNCTION collide_product_sku() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.sku := 'DB-COLLISION'; RETURN NEW; END $$"));
      await tx.execute(sql.raw("CREATE TRIGGER collide_product_sku BEFORE INSERT ON variants FOR EACH ROW EXECUTE FUNCTION collide_product_sku()"));
      await expect(createProduct(tx, { ...input, variants: [{ ...input.variants[0], sku: "PREFLIGHT-FREE" }] }, "owner")).rejects.toMatchObject({ statusCode: 409, details: [{ field: "variants.0.sku", message: "SKU already in use" }] });
      expect(await getProductById(tx, draft.id)).toEqual(draft);
      expect(await tx.select().from(products)).toHaveLength(1);
      expect(await tx.select().from(auditEvents).where(eq(auditEvents.action, "product.created"))).toHaveLength(1);
    });
  });
  it("derives currency and scale from the locked store settings row", async () => {
    await withIsolatedTx(async tx => {
      const category = await createCategory(tx, { name: "Test" }, "owner");
      await tx.update(storeSettings).set({ currency: "KWD", currencyExponent: 3 }).where(eq(storeSettings.id, "default"));
      const draft = await createProduct(tx, { name: "Three decimals", categoryIds: [category.id], variants: [{ sku: "CURRENCY-TEST", priceMinor: "1234", attributes: {} }] }, "owner");
      expect(draft.variants[0]).toMatchObject({ priceMinor: "1234", currency: "KWD", currencyScale: 3 });
    });
  });
  it("rejects a stale pricing revision without product or audit mutation", async () => {
    await withIsolatedTx(async tx => {
      const category = await createCategory(tx, { name: "Test" }, "owner");
      const metadata = await getProductFormMetadata(tx);
      await tx.update(storeSettings).set({ currency: "KWD", currencyExponent: 3 }).where(eq(storeSettings.id, "default"));
      const input = { name: "Stale", categoryIds: [category.id], variants: [{ sku: "STALE", priceMinor: "29", attributes: {} }] };
      await expect(createProduct(tx, input, "owner", undefined, metadata.pricingRevision)).rejects.toMatchObject({ statusCode: 409 });
      expect(await tx.select().from(products)).toHaveLength(0);
      expect(await tx.select().from(auditEvents).where(eq(auditEvents.action, "product.created"))).toHaveLength(0);
    });
  });
  it("reads all aggregate versions in one statement without per-product query fan-out", async () => {
    await withIsolatedTx(async tx => {
      const parent = await createCategory(tx, { name: "Parent" }, "owner");
      const child = await createCategory(tx, { name: "Child", parentId: parent.id }, "owner");
      expect((await getProductFormMetadata(tx)).categories.find(category => category.id === child.id)?.name).toBe("Parent / Child");
      const input = { name: "Version one", categoryIds: [parent.id, child.id], variants: [{ sku: "SNAPSHOT", priceMinor: "9007199254740993", attributes: { color: "red", size: "m" } }] };
      const draft = await createProduct(tx, input, "owner");
      const select = vi.spyOn(tx, "select");
      const oldVersion = await getProductById(tx, draft.id);
      expect(select).toHaveBeenCalledTimes(1); select.mockClear();
      expect(await listProducts(tx)).toEqual([oldVersion]); expect(select).toHaveBeenCalledTimes(1); select.mockRestore();
      const updated = await updateProduct(tx, draft.id, { ...input, name: "Version two", categoryIds: [child.id], variants: [{ id: draft.variants[0].id, sku: "SNAPSHOT", priceMinor: "9007199254740994", attributes: { color: "blue" } }] }, "owner");
      expect(await getProductById(tx, draft.id)).toEqual(updated);
      expect(oldVersion).toEqual(draft);
    });
  });
});
