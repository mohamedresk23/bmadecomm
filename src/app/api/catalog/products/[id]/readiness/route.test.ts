import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../../../../../db";
import { media, productCategories, productMedia, products, sessions, variants } from "../../../../../../db/schema";
import { setupTestDb } from "../../../../../../test-utils/db";
import { catalogFixture } from "../../../../../../test-utils/catalog";
import * as readiness from "../../../../../../modules/catalog/products/application/publication-readiness-service";
import { GET } from "./route";

describe("GET product readiness", () => {
  beforeAll(setupTestDb);
  const context = (id: string) => ({ params: Promise.resolve({ id }) });
  function privateResponse(response: Response, status: number) {
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
  }
  it("uses live staff auth, returns the exact DTO and sanitizes correlated errors", async () => {
    const fixture = await catalogFixture();
    const id = `ready-${fixture.userId}`;
    fixture.productIds.push(id);
    try {
      await db.insert(products).values({ id, name: "Draft", slug: id });
      const request = () => fixture.request("GET", undefined, id, { "x-correlation-id": "readiness-request" });
      const incomplete = await GET(request(), context(id));
      privateResponse(incomplete, 200);
      expect(incomplete.headers.get("x-correlation-id")).toBe("readiness-request");
      expect(await incomplete.json()).toEqual({ isReady: false, issues: [
        { field: "description", code: "MISSING_DESCRIPTION", message: "Enter a product description." },
        { field: "variants", code: "MISSING_VARIANTS", message: "Add at least one variant." },
        { field: "gallery", code: "MISSING_IMAGES", message: "Add at least one product image." },
        { field: "categoryIds", code: "MISSING_CATEGORIES", message: "Associate at least one category." },
      ] });
      const missing = await GET(request(), context("missing"));
      privateResponse(missing, 404);
      expect(await missing.json()).toMatchObject({ error: { code: "NOT_FOUND", request_id: "readiness-request" } });
      await db.update(products).set({ description: "Product details" }).where(eq(products.id, id));
      await db.insert(variants).values({ id: `${id}-v`, productId: id, sku: `READY-${fixture.userId.toUpperCase()}`, priceMinor: BigInt(100), currency: "EGP", currencyScale: 2, combinationKey: "", sortOrder: 0 });
      await db.insert(productCategories).values({ productId: id, categoryId: fixture.categoryId });
      await db.insert(media).values({ id: `${id}-m`, filename: "private.png", mimeType: "image/png", size: 10, status: "pending" });
      await db.insert(productMedia).values({ id: `${id}-i`, productId: id, mediaId: `${id}-m`, altText: "Product image", sortOrder: 0 });
      const complete = await GET(request(), context(id));
      privateResponse(complete, 200);
      expect(await complete.json()).toEqual({ isReady: true, issues: [] });
      const spy = vi.spyOn(readiness, "getPublicationReadiness");
      try {
        spy.mockRejectedValueOnce(new Error("private database details"));
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
          const failed = await GET(request(), context(id));
          privateResponse(failed, 500);
          expect(await failed.json()).toEqual({ error: { code: "INTERNAL_SERVER_ERROR", message: "Internal Server Error", request_id: "readiness-request" } });
        } finally { log.mockRestore(); }
      } finally { spy.mockRestore(); }
      await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, fixture.sessionId));
      privateResponse(await GET(request(), context(id)), 401);
    } finally {
      await fixture.cleanup();
      await db.delete(media).where(eq(media.id, `${id}-m`));
    }
  });
  it("denies guests, customer cookies and disallowed staff before product disclosure", async () => {
    const spy = vi.spyOn(readiness, "getPublicationReadiness");
    try {
      for (const cookie of ["", "__Host-customer-session=customer"]) {
        for (const id of ["existing", "missing"]) {
          privateResponse(await GET(new Request("http://localhost/api/catalog/products/x/readiness", { headers: { Cookie: cookie } }), context(id)), 401);
        }
      }
      privateResponse(await GET(new Request("http://localhost/api/catalog/products/x/readiness", {
        headers: { "x-mock-user": "owner", "x-user-id": "staff:owner", "x-user-role": "owner", "x-role": "catalog_manager" },
      }), context("existing")), 401);
      const fixture = await catalogFixture("support");
      try { privateResponse(await GET(fixture.request("GET", undefined, "missing", { "x-user-role": "owner", "x-role": "owner" }), context("missing")), 403); }
      finally { await fixture.cleanup(); }
      const expired = await catalogFixture();
      try {
        await db.update(sessions).set({ absoluteExpiresAt: new Date(Date.now() - 60000), expiresAt: new Date(Date.now() - 60000) }).where(eq(sessions.id, expired.sessionId));
        privateResponse(await GET(expired.request(), context("existing")), 401);
      } finally { await expired.cleanup(); }
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
});
