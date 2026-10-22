import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../../../../../db";
import { auditEvents, media, products, sessions } from "../../../../../../db/schema";
import { setupTestDb } from "../../../../../../test-utils/db";
import { catalogFixture } from "../../../../../../test-utils/catalog";
import { seedPublication } from "../../../../../../test-utils/publication";
import * as audit from "../../../../../../shared/authz/audit";
import * as publication from "../../../../../../modules/catalog/products/application/publication-service";
import { POST as publish } from "./route";
import { POST as unpublish } from "../unpublish/route";
import { setupIsolatedPublicationStorage } from "../../../../../../test-utils/publication-storage";

setupIsolatedPublicationStorage();

const context = (id: string) => ({ params: Promise.resolve({ id }) });
function privateResponse(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("x-correlation-id")).toBeTruthy();
}
describe("publication POST endpoints", () => {
  beforeAll(setupTestDb);
  it("publishes/unpublishes with live staff session, summary envelope and correlation", async () => {
    const fixture = await catalogFixture("catalog_manager");
    const id = `publication-${fixture.userId}`;
    fixture.productIds.push(id);
    try {
      await seedPublication(db, id, fixture.categoryId);
      const request = () => fixture.request("POST", {}, id, { "x-correlation-id": "publication-request" });
      const result = await publish(request(), context(id)); privateResponse(result, 200);
      expect(result.headers.get("x-correlation-id")).toBe("publication-request");
      const body = await result.json();
      expect(body).toMatchObject({ success: true, csrf: fixture.csrf, product: { id, status: "published" } });
      expect(body.product.publishedAt).toBeTruthy();
      const repeat = await publish(request(), context(id)); privateResponse(repeat, 200);
      expect(await repeat.json()).toEqual(body);
      const draft = await unpublish(request(), context(id)); privateResponse(draft, 200);
      expect(await draft.json()).toMatchObject({ success: true, product: { status: "draft", publishedAt: body.product.publishedAt } });
      await db.update(products).set({ description: null }).where(eq(products.id, id));
      const rejected = await publish(request(), context(id)); privateResponse(rejected, 422);
      expect(await rejected.json()).toEqual({ error: { code: "PUBLICATION_READINESS_FAILED", message: "Product does not meet the requirements for publication.", request_id: "publication-request", details: [{ field: "description", code: "MISSING_DESCRIPTION", message: "Enter a product description." }] } });
      const unexpected = new Error("private database failure");
      const spy = vi.spyOn(audit, "writeAudit").mockRejectedValueOnce(unexpected);
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      await db.update(products).set({ description: "Details" }).where(eq(products.id, id));
      try {
        const failed = await publish(request(), context(id)); privateResponse(failed, 500);
        expect(await failed.json()).toEqual({ error: { code: "INTERNAL_SERVER_ERROR", message: "Internal Server Error", request_id: "publication-request" } });
        expect(log).toHaveBeenCalledWith("[publication-request] Unhandled Error:", unexpected);
      } finally { spy.mockRestore(); log.mockRestore(); }
      const [row] = await db.select().from(products).where(eq(products.id, id)); expect(row.status).toBe("draft");
      expect(await db.select().from(auditEvents).where(eq(auditEvents.resource, `product:${id}`))).toHaveLength(2);
      for (const command of [publish, unpublish]) {
        privateResponse(await command(request(), context("missing")), 404);
        await db.update(products).set({ status: "archived" }).where(eq(products.id, id));
        privateResponse(await command(request(), context(id)), 409);
      }
    } finally { await fixture.cleanup(); await db.delete(media).where(eq(media.id, `${id}-m`)); }
  });
  it("rejects malformed, extra, oversized and non-JSON bodies after auth", async () => {
    const fixture = await catalogFixture();
    try {
      for (const command of [publish, unpublish]) {
        for (const [body, contentType, status] of [
          ["{", "application/json", 400], ["{\"extra\":true}", "application/json", 400], ["[]", "application/json", 400], ["null", "application/json", 400], [" ".repeat(8193), "application/json", 413], ["{}", "text/plain", 415], ["", "application/json", 400],
        ] as const) {
          const headers = new Headers(fixture.request().headers); headers.set("content-type", contentType);
          const response = await command(new Request(fixture.endpoint, { method: "POST", headers, body }), context("missing"));
          privateResponse(response, status);
          expect((await response.json()).error.request_id).toBe(response.headers.get("x-correlation-id"));
        }
      }
    } finally { await fixture.cleanup(); }
  });
  it("denies unauthorized requests for existing and missing products before service invocation", async () => {
    const service = vi.spyOn(publication, "transitionPublication");
    const existingId = "publication-auth-existing";
    await db.insert(products).values({ id: existingId, name: "Existing", slug: existingId });
    const ids = [existingId, "missing"];
    try {
    for (const command of [publish, unpublish]) {
      for (const cookie of ["", "__Host-customer-session=customer"]) {
        for (const id of ids) privateResponse(await command(new Request("http://localhost/", { method: "POST", headers: { Cookie: cookie, "x-user-role": "owner" }, body: "invalid" }), context(id)), 401);
      }
    }
    const forbidden = await catalogFixture("support");
    try { for (const command of [publish, unpublish]) for (const id of ids) privateResponse(await command(forbidden.request("POST", { extra: true }), context(id)), 403); }
    finally { await forbidden.cleanup(); }
    const fixture = await catalogFixture();
    try {
      for (const command of [publish, unpublish]) {
        for (const override of [{ "x-csrf-token": "invalid" }, { origin: "https://evil.test" }] as Record<string, string>[]) for (const id of ids) privateResponse(await command(fixture.request("POST", { extra: true }, undefined, override), context(id)), 403);
      }
      await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, fixture.sessionId));
      for (const command of [publish, unpublish]) for (const id of ids) privateResponse(await command(fixture.request("POST", {}), context(id)), 401);
    } finally { await fixture.cleanup(); }
    const expired = await catalogFixture();
    try {
      await db.update(sessions).set({ expiresAt: new Date(Date.now() - 60000), absoluteExpiresAt: new Date(Date.now() - 60000) }).where(eq(sessions.id, expired.sessionId));
      for (const command of [publish, unpublish]) for (const id of ids) privateResponse(await command(expired.request("POST", {}), context(id)), 401);
    } finally { await expired.cleanup(); }
    expect(service).not.toHaveBeenCalled();
    } finally { service.mockRestore(); await db.delete(products).where(eq(products.id, existingId)); }
  });
});
