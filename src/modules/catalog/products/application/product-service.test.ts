import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { setupTestDb, withIsolatedTx } from "../../../../test-utils/db";
import { withTransaction } from "../../../../db/tx";
import { auditEvents, products, slugRedirects, storeSettings, variants } from "../../../../db/schema";
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
      expect(draft.slug).toBe("shirt");
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

      // Updating a published product is allowed
      const publishedUpdated = await updateProduct(tx, draft.id, { ...input, name: "Published Edited" }, "owner");
      expect(publishedUpdated.name).toBe("Published Edited");

      // Archived products cannot be edited
      await tx.update(products).set({ status: "archived" }).where(eq(products.id, draft.id));
      await expect(updateProduct(tx, draft.id, input, "owner")).rejects.toMatchObject({ statusCode: 409 });
    });
  });

  it("auto-generates unique normalized slugs on create, handles collisions with suffixes, and supports explicit slug & SEO metadata", async () => {
    await withIsolatedTx(async tx => {
      const category = await createCategory(tx, { name: "Fashion" }, "owner");

      // 1. Omitted slug auto-generates normalized slug from name
      const p1 = await createProduct(tx, {
        name: "Summer Linen Shirt",
        categoryIds: [category.id],
        variants: [{ sku: "LINEN-1", priceMinor: "1500", attributes: {} }],
      }, "owner");
      expect(p1.slug).toBe("summer-linen-shirt");

      // 2. Collision during auto-generation appends numeric suffix -1
      const p2 = await createProduct(tx, {
        name: "Summer Linen Shirt",
        categoryIds: [category.id],
        variants: [{ sku: "LINEN-2", priceMinor: "1500", attributes: {} }],
      }, "owner");
      expect(p2.slug).toBe("summer-linen-shirt-1");

      // 3. Explicit valid slug and SEO metadata
      const p3 = await createProduct(tx, {
        name: "Another Item",
        slug: "custom-linen-top",
        metaTitle: "Custom Linen Top | Shop",
        metaDescription: "A fine breathable custom linen top for sunny days.",
        categoryIds: [category.id],
        variants: [{ sku: "LINEN-3", priceMinor: "1800", attributes: {} }],
      }, "owner");
      expect(p3.slug).toBe("custom-linen-top");
      expect(p3.metaTitle).toBe("Custom Linen Top | Shop");
      expect(p3.metaDescription).toBe("A fine breathable custom linen top for sunny days.");

      // 4. Duplicate slug on create rejected with 409
      await expect(createProduct(tx, {
        name: "Duplicate Attempt",
        slug: "custom-linen-top",
        categoryIds: [category.id],
        variants: [{ sku: "LINEN-4", priceMinor: "1000", attributes: {} }],
      }, "owner")).rejects.toMatchObject({
        statusCode: 409,
        details: [{ field: "slug" }],
      });
    });
  });

  it("retains, updates and nulls metaTitle and metaDescription properly on updateProduct", async () => {
    await withIsolatedTx(async tx => {
      const category = await createCategory(tx, { name: "SEO Category" }, "owner");

      // Create product with initial SEO metadata
      const created = await createProduct(tx, {
        name: "SEO Product",
        slug: "seo-product",
        metaTitle: "Initial Meta Title",
        metaDescription: "Initial Meta Description",
        categoryIds: [category.id],
        variants: [{ sku: "SEO-1", priceMinor: "2000", attributes: {} }],
      }, "owner");

      expect(created.metaTitle).toBe("Initial Meta Title");
      expect(created.metaDescription).toBe("Initial Meta Description");

      // 1. Updating without passing metaTitle or metaDescription retains their existing values
      const retained = await updateProduct(tx, created.id, {
        name: "SEO Product Renamed",
        categoryIds: [category.id],
        variants: [{ id: created.variants[0].id, sku: "SEO-1", priceMinor: "2000", attributes: {} }],
      }, "owner");
      expect(retained.name).toBe("SEO Product Renamed");
      expect(retained.metaTitle).toBe("Initial Meta Title");
      expect(retained.metaDescription).toBe("Initial Meta Description");

      // 2. Updating with new values modifies them
      const modified = await updateProduct(tx, created.id, {
        name: "SEO Product Renamed",
        metaTitle: "Updated Meta Title",
        metaDescription: "Updated Meta Description",
        categoryIds: [category.id],
        variants: [{ id: created.variants[0].id, sku: "SEO-1", priceMinor: "2000", attributes: {} }],
      }, "owner");
      expect(modified.metaTitle).toBe("Updated Meta Title");
      expect(modified.metaDescription).toBe("Updated Meta Description");

      // 3. Explicitly passing null clears them to null
      const nulled = await updateProduct(tx, created.id, {
        name: "SEO Product Renamed",
        metaTitle: null,
        metaDescription: null,
        categoryIds: [category.id],
        variants: [{ id: created.variants[0].id, sku: "SEO-1", priceMinor: "2000", attributes: {} }],
      }, "owner");
      expect(nulled.metaTitle).toBeNull();
      expect(nulled.metaDescription).toBeNull();
    });
  });

  it("preserves existing slug and creates no redirect rows when updateProduct omits slug", async () => {
    await withIsolatedTx(async tx => {
      const category = await createCategory(tx, { name: "Preserve Slug Cat" }, "owner");

      const created = await createProduct(tx, {
        name: "Preserve Slug Product",
        slug: "stable-slug",
        categoryIds: [category.id],
        variants: [{ sku: "STABLE-1", priceMinor: "1200", attributes: {} }],
      }, "owner");

      // Publish product
      await tx.update(products).set({ status: "published" }).where(eq(products.id, created.id));

      // Update product without passing slug
      const updated = await updateProduct(tx, created.id, {
        name: "Updated Name Only",
        categoryIds: [category.id],
        variants: [{ id: created.variants[0].id, sku: "STABLE-1", priceMinor: "1300", attributes: {} }],
      }, "owner");

      // Slug is preserved unchanged
      expect(updated.slug).toBe("stable-slug");
      expect(updated.name).toBe("Updated Name Only");

      // 0 redirect rows are created in slug_redirects
      const redirs = await tx.select().from(slugRedirects).where(eq(slugRedirects.productId, created.id));
      expect(redirs).toHaveLength(0);
    });
  });

  it("differentiates draft vs published slug edits, collapses redirect chains, prevents cycles, and writes slug_update audit events", async () => {
    await withIsolatedTx(async tx => {
      const category = await createCategory(tx, { name: "Shoes" }, "owner");
      const baseInput: CreateProductInput = {
        name: "Running Shoes",
        slug: "draft-a",
        categoryIds: [category.id],
        variants: [{ sku: "RUN-1", priceMinor: "5000", attributes: {} }],
      };

      // 1. Create draft product
      const product = await createProduct(tx, baseInput, "owner", "req-create");
      expect(product.slug).toBe("draft-a");
      expect(product.status).toBe("draft");

      // 2. Edit slug on DRAFT product -> products.slug updated, but 0 rows in slug_redirects
      const draftUpdated = await updateProduct(tx, product.id, {
        ...baseInput,
        slug: "draft-b",
      }, "owner", "req-draft-slug-update");
      expect(draftUpdated.slug).toBe("draft-b");

      const draftRedirects = await tx.select().from(slugRedirects).where(eq(slugRedirects.productId, product.id));
      expect(draftRedirects).toHaveLength(0);

      // Audit event for slug_update written
      const draftAudits = await tx.select().from(auditEvents).where(eq(auditEvents.action, "catalog.product.slug_update"));
      expect(draftAudits).toHaveLength(1);
      expect(draftAudits[0].diff).toMatchObject({ oldSlug: "draft-a", newSlug: "draft-b", status: "draft" });

      // 3. Publish product and change slug from draft-b to live-a
      await tx.update(products).set({ status: "published" }).where(eq(products.id, product.id));

      const pubUpdated1 = await updateProduct(tx, product.id, {
        ...baseInput,
        slug: "live-a",
      }, "owner", "req-pub-slug-1");
      expect(pubUpdated1.slug).toBe("live-a");

      // 1 redirect row created: draft-b -> live-a
      const pubRedirects1 = await tx.select().from(slugRedirects).where(eq(slugRedirects.productId, product.id));
      expect(pubRedirects1).toHaveLength(1);
      expect(pubRedirects1[0]).toMatchObject({ sourceSlug: "draft-b", targetSlug: "live-a" });

      // 4. Change published slug again: live-a to live-b (Redirect chain collapsing)
      const pubUpdated2 = await updateProduct(tx, product.id, {
        ...baseInput,
        slug: "live-b",
      }, "owner", "req-pub-slug-2");
      expect(pubUpdated2.slug).toBe("live-b");

      const pubRedirects2 = await tx.select().from(slugRedirects).where(eq(slugRedirects.productId, product.id)).orderBy(slugRedirects.sourceSlug);
      // Both previous slugs must point directly to live-b
      expect(pubRedirects2).toHaveLength(2);
      expect(pubRedirects2[0]).toMatchObject({ sourceSlug: "draft-b", targetSlug: "live-b" });
      expect(pubRedirects2[1]).toMatchObject({ sourceSlug: "live-a", targetSlug: "live-b" });

      // 5. Change published slug back to live-a (Redirect cycle prevention)
      const pubUpdatedCycle = await updateProduct(tx, product.id, {
        ...baseInput,
        slug: "live-a",
      }, "owner", "req-pub-slug-cycle");
      expect(pubUpdatedCycle.slug).toBe("live-a");

      const pubRedirectsCycle = await tx.select().from(slugRedirects).where(eq(slugRedirects.productId, product.id)).orderBy(slugRedirects.sourceSlug);
      // live-a -> live-b deleted to prevent cycle, draft-b updated to live-a, live-b points to live-a
      expect(pubRedirectsCycle).toHaveLength(2);
      expect(pubRedirectsCycle.some(r => r.sourceSlug === r.targetSlug)).toBe(false);
      expect(pubRedirectsCycle.find(r => r.sourceSlug === "live-a")).toBeUndefined();
      expect(pubRedirectsCycle[0]).toMatchObject({ sourceSlug: "draft-b", targetSlug: "live-a" });
      expect(pubRedirectsCycle[1]).toMatchObject({ sourceSlug: "live-b", targetSlug: "live-a" });
    });
  });

  it("rejects editing slug when target slug is claimed by another product or another product redirect", async () => {
    await withIsolatedTx(async tx => {
      const category = await createCategory(tx, { name: "Electronics" }, "owner");

      const p1 = await createProduct(tx, {
        name: "Phone",
        slug: "phone",
        categoryIds: [category.id],
        variants: [{ sku: "PHONE-1", priceMinor: "10000", attributes: {} }],
      }, "owner");

      const p2 = await createProduct(tx, {
        name: "Tablet",
        slug: "tablet",
        categoryIds: [category.id],
        variants: [{ sku: "TAB-1", priceMinor: "8000", attributes: {} }],
      }, "owner");

      // p2 cannot claim p1's slug
      await expect(updateProduct(tx, p2.id, {
        name: "Tablet",
        slug: "phone",
        categoryIds: [category.id],
        variants: [{ id: p2.variants[0].id, sku: "TAB-1", priceMinor: "8000", attributes: {} }],
      }, "owner")).rejects.toMatchObject({
        statusCode: 409,
        details: [{ field: "slug" }],
      });

      // Publish p1 and change its slug to create a redirect
      await tx.update(products).set({ status: "published" }).where(eq(products.id, p1.id));
      await updateProduct(tx, p1.id, {
        name: "Phone",
        slug: "phone-pro",
        categoryIds: [category.id],
        variants: [{ id: p1.variants[0].id, sku: "PHONE-1", priceMinor: "10000", attributes: {} }],
      }, "owner");

      // p2 cannot claim p1's old redirect slug ("phone")
      await expect(updateProduct(tx, p2.id, {
        name: "Tablet",
        slug: "phone",
        categoryIds: [category.id],
        variants: [{ id: p2.variants[0].id, sku: "TAB-1", priceMinor: "8000", attributes: {} }],
      }, "owner")).rejects.toMatchObject({
        statusCode: 409,
        details: [{ field: "slug" }],
      });
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
      await tx.execute(sql.raw("CREATE FUNCTION reject_product_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'product.%' OR NEW.action LIKE 'catalog.product.%' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$"));
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

  it("translates database-time slug collision and format constraint errors into ApiError", async () => {
    await withIsolatedTx(async tx => {
      const category = await createCategory(tx, { name: "Test" }, "owner");
      const p1 = await createProduct(tx, { name: "Existing", slug: "collide-slug", categoryIds: [category.id], variants: [{ sku: "S-1", priceMinor: "0", attributes: {} }] }, "owner");

      // 1. Simulate a slug conflict forced at insert trigger time (code 23505) -> 409
      await tx.execute(sql.raw("CREATE FUNCTION collide_product_slug() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.slug := 'collide-slug'; RETURN NEW; END $$"));
      await tx.execute(sql.raw("CREATE TRIGGER collide_product_slug BEFORE INSERT ON products FOR EACH ROW EXECUTE FUNCTION collide_product_slug()"));

      await expect(createProduct(tx, {
        name: "New Product",
        slug: "will-be-overridden",
        categoryIds: [category.id],
        variants: [{ sku: "S-2", priceMinor: "0", attributes: {} }],
      }, "owner")).rejects.toMatchObject({
        statusCode: 409,
        details: [{ field: "slug", message: "Slug already in use" }],
      });
      expect(await getProductById(tx, p1.id)).toEqual(p1);

      // Clean up collision trigger
      await tx.execute(sql.raw("DROP TRIGGER collide_product_slug ON products"));
      await tx.execute(sql.raw("DROP FUNCTION collide_product_slug()"));

      // 2. Simulate a check constraint violation forced at trigger time (code 23514) -> 422
      await tx.execute(sql.raw("CREATE FUNCTION violate_slug_check() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.slug := 'Bad_Uppercase_Slug!'; RETURN NEW; END $$"));
      await tx.execute(sql.raw("CREATE TRIGGER violate_slug_check BEFORE INSERT ON products FOR EACH ROW EXECUTE FUNCTION violate_slug_check()"));

      await expect(createProduct(tx, {
        name: "Check Violation Product",
        slug: "valid-input-slug",
        categoryIds: [category.id],
        variants: [{ sku: "S-3", priceMinor: "0", attributes: {} }],
      }, "owner")).rejects.toMatchObject({
        statusCode: 422,
        details: [{ field: "slug", message: "Invalid slug format" }],
      });
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
