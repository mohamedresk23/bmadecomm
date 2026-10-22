import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../../../../../db";
import { categories, media, products, slugRedirects } from "../../../../../../db/schema";
import { setupTestDb } from "../../../../../../test-utils/db";
import { seedPublication } from "../../../../../../test-utils/publication";
import { unpublishProduct } from "../../../../../../modules/catalog/products/application/publication-service";
import * as service from "../../../../../../modules/catalog/products/application/public-product-service";
import { GET, dynamic } from "./route";
import { setupIsolatedPublicationStorage } from "../../../../../../test-utils/publication-storage";

setupIsolatedPublicationStorage();

const call = (slug: string, headers?: HeadersInit) => GET(new Request(`http://localhost/api/public/products/by-slug/${encodeURIComponent(slug)}`, { headers }), { params: Promise.resolve({ slug }) });
describe("public slug HTTP resolution", () => {
  beforeAll(setupTestDb);
  afterEach(() => vi.restoreAllMocks());
  it("allows guests/customers, protects private data and observes committed unpublication for both addresses", async () => {
    const id = `public-${randomUUID()}`, old = `old-${id}`;
    try {
      await seedPublication(db, id);
      await db.update(products).set({ status: "published" }).where(eq(products.id, id));
      await db.insert(slugRedirects).values({ sourceSlug: old, targetSlug: "stale-target", productId: id });
      expect(dynamic).toBe("force-dynamic");
      for (const headers of [undefined, { Cookie: "session=customer", "x-mock-role": "owner", "x-user-id": "staff", "x-correlation-id": "public-request" }]) {
        const response = await call(id, headers);
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("x-correlation-id")).toBeTruthy();
        const body = await response.json();
        expect(Object.keys(body).sort()).toEqual(["id", "name", "description", "slug", "variants", "images", "metaTitle", "metaDescription"].sort());
        expect(body.images).toEqual([{ id: `${id}-i`, position: 0, altText: "Product image" }]);
        expect(Object.keys(body.variants[0]).sort()).toEqual(["id", "sku", "priceMinor", "comparePriceMinor", "currency", "currencyScale", "attributes"].sort());
        expect(JSON.stringify(body)).not.toMatch(/private\.png|mediaId|storage|preview|publishedAt|updatedAt|revision|status/);
      }
      const redirect = await call(old);
      expect(redirect.status).toBe(301);
      expect(redirect.headers.get("location")).toBe(`/products/${id}`);
      expect(redirect.headers.get("cache-control")).toBe("no-store");
      expect(redirect.headers.get("x-correlation-id")).toBeTruthy();
      await unpublishProduct(db, id, "public-test");
      for (const slug of [id, old, "missing", "UPPER", "a".repeat(256)]) {
        const response = await call(slug, { "x-correlation-id": "hidden", "x-mock-role": "owner", Cookie: "staff=owner" });
        expect(response.status).toBe(404);
        expect(response.headers.get("location")).toBeNull();
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("x-correlation-id")).toBe("hidden");
        expect(await response.json()).toEqual({ error: { code: "NOT_FOUND", message: "Product not found", request_id: "hidden" } });
      }
    } finally {
      await db.delete(products).where(eq(products.id, id));
      await db.delete(media).where(eq(media.id, `${id}-m`));
      await db.delete(categories).where(eq(categories.id, `${id}-c`));
    }
  });
  it("sanitizes database errors and generates correlated no-store errors", async () => {
    vi.spyOn(service, "resolvePublicProductBySlug").mockRejectedValueOnce(new Error("private database password"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await call("valid-slug");
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const correlation = response.headers.get("x-correlation-id");
    expect(correlation).toBeTruthy();
    expect(await response.json()).toEqual({ error: { code: "INTERNAL_SERVER_ERROR", message: "Internal Server Error", request_id: correlation } });
    expect(log).toHaveBeenCalled();
  });
});
