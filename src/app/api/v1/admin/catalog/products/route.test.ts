import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../../../../../../test-utils/db";
import { catalogFixture } from "../../../../../../test-utils/catalog";
import { db } from "../../../../../../db";
import { auditEvents, products, sessions, staffAccounts, storeSettings } from "../../../../../../db/schema";
import { GET, POST } from "./route";
import { GET as detail, PUT } from "./[id]/route";
import { GET as publicList } from "../../../store/products/route";
import { GET as publicDetail } from "../../../store/products/[id]/route";
import { DELETE as deleteCategory } from "../categories/[id]/route";

beforeAll(setupTestDb);
let fixture: Awaited<ReturnType<typeof catalogFixture>>;
afterEach(async () => { if (fixture) await fixture.cleanup(); });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const input = (categoryId: string) => ({ name: "Shirt", description: "Cotton", categoryIds: [categoryId], variants: [{ sku: "ROUTE-ONE", priceMinor: "29", attributes: {} }] });
describe("product draft routes", () => {
  it("creates, reads, updates and reloads a private draft and prevents assigned-category deletion", async () => {
    fixture = await catalogFixture("catalog_manager");
    const metadata = await GET(fixture.request());
    expect(metadata.status).toBe(200);
    expect(metadata.headers.get("cache-control")).toBe("private, no-store");
    expect((await metadata.json()).csrf).toBe(fixture.csrf);
    const response = await POST(fixture.request("POST", input(fixture.categoryId), undefined, { "x-correlation-id": "create-flow" }));
    expect(response.status).toBe(201);
    const { product } = await response.json(); fixture.productIds.push(product.id);
    expect(product.variants[0].priceMinor).toBe("29");
    const fetched = await detail(fixture.request("GET", undefined, product.id), ctx(product.id));
    expect((await fetched.json()).product).toEqual(product);
    const edit = await PUT(fixture.request("PUT", { ...input(fixture.categoryId), name: "Edited", variants: [{ ...input(fixture.categoryId).variants[0], id: product.variants[0].id, priceMinor: "1999" }] }, product.id), ctx(product.id));
    expect(edit.status).toBe(200);
    const reloaded = await detail(fixture.request("GET", undefined, product.id), ctx(product.id));
    expect((await reloaded.json()).product).toMatchObject({ name: "Edited", status: "draft", variants: [{ id: product.variants[0].id, priceMinor: "1999" }] });
    const audits = await db.select().from(auditEvents).where(eq(auditEvents.resource, `product:${product.id}`));
    expect(audits).toHaveLength(2); expect(audits[0].requestId).toBe("create-flow");
    const store = await publicList(new Request("http://localhost:3000/api/v1/store/products"));
    expect((await store.json()).products.some((row: { id: string }) => row.id === product.id)).toBe(false);
    const hidden = await publicDetail(new Request(`http://localhost:3000/api/v1/store/products/${product.id}`), ctx(product.id));
    expect(hidden.status).toBe(404); expect(JSON.stringify(await hidden.json())).not.toContain("ROUTE-ONE");
    const second = await POST(fixture.request("POST", { ...input(fixture.categoryId), name: "Public product", variants: [{ sku: "PUBLIC-ONE", priceMinor: "9007199254740993", attributes: {} }] }));
    const published = (await second.json()).product; fixture.productIds.push(published.id);
    await db.update(products).set({ status: "published" }).where(eq(products.id, published.id));
    const publicCollection = (await (await publicList(new Request("http://localhost:3000/api/v1/store/products"))).json()).products;
    expect(publicCollection.some((row: { id: string }) => row.id === product.id)).toBe(false);
    expect(publicCollection.find((row: { id: string }) => row.id === published.id)).toMatchObject({ name: "Public product", variants: [{ sku: "PUBLIC-ONE", priceMinor: "9007199254740993" }] });
    expect((await deleteCategory(fixture.request("DELETE", undefined, fixture.categoryId), ctx(fixture.categoryId))).status).toBe(409);
  });
  it("rejects malformed amounts, unknown categories and forbidden fields with 422 without mutation", async () => {
    fixture = await catalogFixture();
    for (const amount of ["x", "1.5", "-1", "9223372036854775808"]) {
      const value = input(fixture.categoryId); value.variants[0].priceMinor = amount;
      const response = await POST(fixture.request("POST", value));
      expect(response.status).toBe(422); expect((await response.json()).error.details.some((error: { field: string }) => error.field === "variants.0.priceMinor")).toBe(true);
    }
    for (const value of [{ ...input(fixture.categoryId), status: "published" }, input("missing"), { ...input(fixture.categoryId), variants: [{ sku: "X", priceMinor: "0", currency: "USD", attributes: {} }] }]) expect((await POST(fixture.request("POST", value))).status).toBe(422);
    expect(await db.select().from(products)).toHaveLength(0);
  });
  it("rejects normalized SKU conflict and equivalent combinations with field errors and preserves state", async () => {
    fixture = await catalogFixture();
    const first = await POST(fixture.request("POST", input(fixture.categoryId)));
    const { product } = await first.json(); fixture.productIds.push(product.id);
    const duplicate = input(fixture.categoryId); duplicate.variants[0].sku = " route-one ";
    expect((await POST(fixture.request("POST", duplicate))).status).toBe(409);
    const equivalent = { ...input(fixture.categoryId), variants: [
      { sku: "A", priceMinor: "0", attributes: { Color: "Red", Size: "M" } },
      { sku: "B", priceMinor: "0", attributes: { size: "m", color: " red " } },
    ] };
    expect((await PUT(fixture.request("PUT", equivalent, product.id), ctx(product.id))).status).toBe(422);
    expect((await (await detail(fixture.request("GET", undefined, product.id), ctx(product.id))).json()).product).toEqual(product);
    expect(await db.select().from(auditEvents).where(eq(auditEvents.resource, `product:${product.id}`))).toHaveLength(1);
  });
  it("enforces role, Origin, CSRF and missing, expired, revoked or disabled sessions before mutations", async () => {
    fixture = await catalogFixture("support");
    expect((await GET(fixture.request())).status).toBe(403);
    expect((await POST(fixture.request("POST", input(fixture.categoryId)))).status).toBe(403);
    await fixture.cleanup(); fixture = await catalogFixture();
    const overrides: Record<string, string>[] = [{ Cookie: "" }, { Origin: "https://evil.example" }, { "X-CSRF-Token": "" }];
    for (const override of overrides) {
      expect((await POST(fixture.request("POST", input(fixture.categoryId), undefined, override))).status).toBe(override.Cookie === "" ? 401 : 403);
      expect((await PUT(fixture.request("PUT", input(fixture.categoryId), "missing", override), ctx("missing"))).status).toBe(override.Cookie === "" ? 401 : 403);
    }
    await db.update(sessions).set({ idleExpiresAt: new Date(0) }).where(eq(sessions.id, fixture.sessionId));
    expect((await POST(fixture.request("POST", input(fixture.categoryId)))).status).toBe(401);
    await db.update(sessions).set({ idleExpiresAt: new Date(Date.now() + 60000), revokedAt: new Date() }).where(eq(sessions.id, fixture.sessionId));
    expect((await GET(fixture.request())).status).toBe(401);
    await db.update(sessions).set({ revokedAt: null }).where(eq(sessions.id, fixture.sessionId));
    await db.update(staffAccounts).set({ enabled: false }).where(eq(staffAccounts.userId, fixture.userId));
    const rejected = await POST(fixture.request("POST", input(fixture.categoryId)));
    expect(rejected.status).toBe(401); expect(rejected.headers.get("cache-control")).toBe("private, no-store");
    expect(await db.select().from(products)).toHaveLength(0);
  });
  it("accepts maximal four-dimension Unicode matrices and rejects bodies over 256KiB", async () => {
    fixture = await catalogFixture();
    const names = Array.from({ length: 4 }, (_, index) => "色".repeat(59) + index);
    const value = { ...input(fixture.categoryId), name: "品".repeat(200), description: "文".repeat(5000), variants: Array.from({ length: 100 }, (_, index) => ({ sku: `MATRIX-${index}`, priceMinor: "9223372036854775807", comparePriceMinor: "9223372036854775807", attributes: Object.fromEntries(names.map((name, dimension) => [name, "值".repeat(57) + String(dimension === 0 ? index : dimension).padStart(3, "0")])) })) };
    expect(Buffer.byteLength(JSON.stringify(value), "utf8")).toBeGreaterThan(131072);
    expect(Buffer.byteLength(JSON.stringify(value), "utf8")).toBeLessThanOrEqual(262144);
    const saved = await POST(fixture.request("POST", value)); expect(saved.status).toBe(201);
    const body = await saved.json(); fixture.productIds.push(body.product.id); expect(body.product.variants).toHaveLength(100);
    const edited = await PUT(fixture.request("PUT", value, body.product.id), ctx(body.product.id)); expect(edited.status).toBe(200);
    const oversized = await POST(fixture.request("POST", { ...value, description: "x".repeat(262145) }));
    expect(oversized.status).toBe(413);
    expect((await PUT(fixture.request("PUT", { ...value, description: "x".repeat(262145) }, body.product.id), ctx(body.product.id))).status).toBe(413);
    const wrongType = await POST(new Request(fixture.endpoint, { method: "POST", headers: { Cookie: `__Host-staff-session=${fixture.token}`, "X-CSRF-Token": fixture.csrf, "Content-Type": "text/plain" }, body: "{}" }));
    expect(wrongType.status).toBe(415);
  });
  it("returns field errors for unsafe Unicode, delimiters and normalized __proto__ attributes", async () => {
    fixture = await catalogFixture();
    const headersToCheck: Record<string, string>[] = [{}, { "Idempotency-Key": "unsafe-validation" }];
    for (const headers of headersToCheck) {
      for (const attributes of [{ "bad:name": "x" }, { color: "red,blue" }, { "\ud800": "red" }, { color: "\udfff" }, JSON.parse('{"__proto__":"x"}'), { " __PROTO__ ": "x" }]) {
        const response = await POST(fixture.request("POST", { ...input(fixture.categoryId), variants: [{ sku: "INVALID-ATTR", priceMinor: "0", attributes }] }, undefined, headers));
        expect(response.status).toBe(422);
        expect((await response.json()).error.details.some((detail: { field: string }) => detail.field.startsWith("variants.0.attributes"))).toBe(true);
      }
      for (const change of [{ name: "bad\ud800" }, { description: "bad\udfff" }, { categoryIds: ["bad\ud800"] }]) expect((await POST(fixture.request("POST", { ...input(fixture.categoryId), ...change }, undefined, headers))).status).toBe(422);
    }
    expect(await db.select().from(products)).toHaveLength(0);
  });
  it("requires pricing revision and rejects stale settings on create and edit", async () => {
    fixture = await catalogFixture();
    expect((await POST(fixture.request("POST", input(fixture.categoryId), undefined, { "X-Pricing-Revision": "" }))).status).toBe(409);
    const saved = await POST(fixture.request("POST", input(fixture.categoryId)));
    const { product } = await saved.json(); fixture.productIds.push(product.id);
    await db.update(storeSettings).set({ currency: "KWD", currencyExponent: 3 }).where(eq(storeSettings.id, "default"));
    try {
      expect((await POST(fixture.request("POST", { ...input(fixture.categoryId), variants: [{ sku: "NEW-STALE", priceMinor: "10", attributes: {} }] }))).status).toBe(409);
      expect((await PUT(fixture.request("PUT", { ...input(fixture.categoryId), name: "Stale edit" }, product.id), ctx(product.id))).status).toBe(409);
      expect((await (await detail(fixture.request("GET", undefined, product.id), ctx(product.id))).json()).product).toEqual(product);
      expect(await db.select().from(auditEvents).where(eq(auditEvents.resource, `product:${product.id}`))).toHaveLength(1);
    } finally { await db.update(storeSettings).set({ currency: "EGP", currencyExponent: 2 }).where(eq(storeSettings.id, "default")); }
  });
  it("replays the same committed create result without a second audit and rejects changed payloads", async () => {
    fixture = await catalogFixture();
    const headers = { "Idempotency-Key": "lost-response-retry" };
    const original = await POST(fixture.request("POST", input(fixture.categoryId), undefined, headers));
    const body = await original.json(); fixture.productIds.push(body.product.id);
    const retry = await POST(fixture.request("POST", input(fixture.categoryId), undefined, headers));
    expect(retry.status).toBe(201); expect(await retry.json()).toEqual(body);
    expect(await db.select().from(auditEvents).where(eq(auditEvents.resource, `product:${body.product.id}`))).toHaveLength(1);
    expect((await POST(fixture.request("POST", { ...input(fixture.categoryId), name: "Changed" }, undefined, headers))).status).toBe(409);
  });
});
