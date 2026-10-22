import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../../../db";
import { auditEvents, media, productMedia, products, slugRedirects, variants, productCategories, variantAttributes, variantMedia, operationKeys } from "../../../../db/schema";
import { setupTestDb, withIsolatedTx } from "../../../../test-utils/db";
import { seedPublication } from "../../../../test-utils/publication";
import * as audit from "../../../../shared/authz/audit";
import { publishProduct, unpublishProduct } from "./publication-service";
import { setupIsolatedPublicationStorage } from "../../../../test-utils/publication-storage";

setupIsolatedPublicationStorage();

describe("atomic publication service", () => {
  beforeAll(setupTestDb);
  afterEach(() => vi.useRealTimers());
  it("preserves the first timestamp, aggregate and media across transitions and no-ops", async () => {
    await withIsolatedTx(async tx => {
      const id = await seedPublication(tx);
      await tx.update(products).set({ updatedAt: new Date("2020-01-01T00:00:00Z") }).where(eq(products.id, id));
      await tx.insert(variantAttributes).values({ variantId: `${id}-v`, name: "color", value: "blue" });
      await tx.insert(variantMedia).values({ productId: id, variantId: `${id}-v`, productMediaId: `${id}-i` });
      await tx.insert(operationKeys).values({ id: "publication-operation", actor: "staff:staff", operation: "product.create", key: "existing", payloadHash: "a".repeat(64), result: { id }, completedAt: new Date("2020-01-01T00:00:00Z") });
      await tx.insert(slugRedirects).values({ sourceSlug: "old-publication", targetSlug: id, productId: id });
      const aggregate = async () => ({ media: await tx.select().from(media), images: await tx.select().from(productMedia), variants: await tx.select().from(variants), categories: await tx.select().from(productCategories), redirects: await tx.select().from(slugRedirects), attributes: await tx.select().from(variantAttributes), mappings: await tx.select().from(variantMedia), operations: await tx.select().from(operationKeys) });
      const before = await aggregate();
      const persisted = () => tx.select().from(products).where(eq(products.id, id));
      const initialRows = await persisted();
      const draft = await unpublishProduct(tx, id, "staff", "noop");
      expect(draft.publishedAt).toBeNull();
      expect(await persisted()).toEqual(initialRows);
      expect(await tx.select().from(auditEvents)).toHaveLength(0);
      vi.useFakeTimers({ toFake: ["Date"] });
      const publishTime = new Date("2026-10-21T10:00:00Z");
      vi.setSystemTime(publishTime);
      const published = await publishProduct(tx, id, "staff", "publish-request");
      expect(published.updatedAt).toBe(publishTime.toISOString());
      expect((await persisted())[0].updatedAt).toEqual(publishTime);
      expect(publishTime.getTime()).toBeGreaterThan(initialRows[0].updatedAt.getTime());
      expect(published.status).toBe("published"); expect(published.publishedAt).not.toBeNull();
      expect(await publishProduct(tx, id, "staff", "repeat")).toEqual(published);
      // A same-target request remains a no-op even if facts have since become ineligible.
      await tx.update(products).set({ description: null }).where(eq(products.id, id));
      expect((await publishProduct(tx, id, "staff")).status).toBe("published");
      const unpublishTime = new Date("2026-10-21T11:00:00Z");
      vi.setSystemTime(unpublishTime);
      const unpublished = await unpublishProduct(tx, id, "staff:staff", "unpublish-request");
      expect(unpublished.updatedAt).toBe(unpublishTime.toISOString());
      expect((await persisted())[0].updatedAt).toEqual(unpublishTime);
      expect(unpublishTime.getTime()).toBeGreaterThan(publishTime.getTime());
      expect(unpublished.status).toBe("draft"); expect(unpublished.publishedAt).toBe(published.publishedAt);
      expect(await unpublishProduct(tx, id, "staff")).toEqual(unpublished);
      await tx.update(products).set({ description: "Details" }).where(eq(products.id, id));
      expect((await publishProduct(tx, id, "staff")).publishedAt).toBe(published.publishedAt);
      const events = await tx.select().from(auditEvents);
      expect(events.map(event => event.action)).toEqual(["product.publish", "product.unpublish", "product.publish"]);
      expect(events[0]).toMatchObject({ actor: "staff:staff", requestId: "publish-request", resource: `product:${id}`, diff: { before: { status: "draft", publishedAt: null }, after: { status: "published", publishedAt: published.publishedAt } } });
      expect(await aggregate()).toEqual(before);
      const [row] = await tx.select().from(products).where(eq(products.id, id));
      expect(row.mediaRevision).toBe(BigInt(0));
    }, db);
  });
  it("rejects readiness, missing and archived without changes", async () => {
    await withIsolatedTx(async tx => {
      const id = await seedPublication(tx);
      await tx.update(products).set({ description: null }).where(eq(products.id, id));
      const before = await tx.select().from(products);
      await expect(publishProduct(tx, id, "staff")).rejects.toMatchObject({ statusCode: 422, code: "PUBLICATION_READINESS_FAILED", details: [{ field: "description", code: "MISSING_DESCRIPTION", message: "Enter a product description." }] });
      expect(await tx.select().from(products)).toEqual(before);
      for (const command of [publishProduct, unpublishProduct]) {
        await expect(command(tx, "missing", "staff")).rejects.toMatchObject({ statusCode: 404 });
        await tx.update(products).set({ status: "archived" }).where(eq(products.id, id));
        await expect(command(tx, id, "staff")).rejects.toMatchObject({ statusCode: 409 });
      }
      expect(await tx.select().from(auditEvents)).toHaveLength(0);
    });
  });
  it.each(["publish", "unpublish"])("rolls back %s when audit insertion fails", async command => {
    await withIsolatedTx(async tx => {
      const id = await seedPublication(tx);
      if (command === "unpublish") await publishProduct(tx, id, "staff");
      const before = await tx.select().from(products);
      const events = await tx.select().from(auditEvents);
      const spy = vi.spyOn(audit, "writeAudit").mockRejectedValueOnce(new Error("audit failed"));
      try { await expect((command === "publish" ? publishProduct : unpublishProduct)(tx, id, "staff")).rejects.toThrow("audit failed"); }
      finally { spy.mockRestore(); }
      expect(await tx.select().from(products)).toEqual(before);
      expect(await tx.select().from(auditEvents)).toEqual(events);
    });
  });
});
