import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../../../../../../test-utils/db";
import { catalogFixture } from "../../../../../../test-utils/catalog";
import { db } from "../../../../../../db";
import { auditEvents, homepageDrafts, products } from "../../../../../../db/schema";
import { GET, PUT } from "./route";

beforeAll(setupTestDb);

let fixture: Awaited<ReturnType<typeof catalogFixture>> | undefined;

afterEach(async () => {
  if (fixture) {
    await fixture.cleanup();
    fixture = undefined;
  }
});

function homepageRequest(
  method = "GET",
  body?: unknown,
  f?: Awaited<ReturnType<typeof catalogFixture>>,
  overrideHeaders?: Record<string, string>
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...overrideHeaders,
  };
  if (f) {
    headers["Cookie"] = `__Host-staff-session=${f.token}`;
    headers["Origin"] = "http://localhost:3000";
    headers["X-CSRF-Token"] = f.csrf;
  }
  if (overrideHeaders) {
    Object.assign(headers, overrideHeaders);
  }
  return new Request("http://localhost:3000/api/v1/admin/content/homepage", {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describe("Admin Homepage Content Route (/api/v1/admin/content/homepage)", () => {
  describe("Authentication & Authorization", () => {
    it("rejects unauthenticated GET requests with 401", async () => {
      const res = await GET(homepageRequest("GET"));
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error.code).toBe("UNAUTHORIZED");
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    });

    it("rejects unauthenticated PUT requests with 401", async () => {
      const res = await PUT(
        homepageRequest("PUT", { expectedRevision: 1, sections: [] })
      );
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error.code).toBe("UNAUTHORIZED");
    });

    it("rejects unpermitted staff roles (e.g. support) with 403 on GET", async () => {
      fixture = await catalogFixture("support");
      const res = await GET(homepageRequest("GET", undefined, fixture));
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error.code).toBe("FORBIDDEN");
    });

    it("rejects unpermitted staff roles with 403 on PUT", async () => {
      fixture = await catalogFixture("support");
      const res = await PUT(
        homepageRequest(
          "PUT",
          { expectedRevision: 1, sections: [] },
          fixture
        )
      );
      expect(res.status).toBe(403);
    });

    it("allows marketing role to GET draft", async () => {
      fixture = await catalogFixture("marketing");
      const res = await GET(homepageRequest("GET", undefined, fixture));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.draft).toBeDefined();
      expect(data.csrf).toBe(fixture.csrf);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      expect(res.headers.get("Pragma")).toBe("no-cache");
    });

    it("allows owner role to GET draft", async () => {
      fixture = await catalogFixture("owner");
      const res = await GET(homepageRequest("GET", undefined, fixture));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.draft.revision).toBeGreaterThanOrEqual(1);
    });
  });

  describe("CSRF and Origin Protection", () => {
    it("rejects PUT with missing CSRF token with 403 Forbidden", async () => {
      fixture = await catalogFixture("owner");
      const req = homepageRequest(
        "PUT",
        { expectedRevision: 1, sections: [] },
        fixture,
        { "X-CSRF-Token": "" }
      );
      const res = await PUT(req);
      expect(res.status).toBe(403);
    });

    it("rejects PUT with invalid CSRF token with 403 Forbidden", async () => {
      fixture = await catalogFixture("owner");
      const req = homepageRequest(
        "PUT",
        { expectedRevision: 1, sections: [] },
        fixture,
        { "X-CSRF-Token": "invalid_forged_csrf_token" }
      );
      const res = await PUT(req);
      expect(res.status).toBe(403);
    });

    it("rejects PUT with mismatched Origin with 403 Forbidden", async () => {
      fixture = await catalogFixture("owner");
      const req = homepageRequest(
        "PUT",
        { expectedRevision: 1, sections: [] },
        fixture,
        { Origin: "http://malicious-origin.com" }
      );
      const res = await PUT(req);
      expect(res.status).toBe(403);
    });
  });

  describe("Draft Save (PUT) Validations & Mutations", () => {
    it("rejects unapproved section type with 422 and issue field sections[0].type", async () => {
      fixture = await catalogFixture("owner");
      const getRes = await GET(homepageRequest("GET", undefined, fixture));
      const { draft } = await getRes.json();

      const req = homepageRequest(
        "PUT",
        {
          expectedRevision: draft.revision,
          sections: [
            {
              id: "sec-custom",
              type: "custom_banner",
              enabled: true,
              position: 0,
            },
          ],
        },
        fixture
      );

      const res = await PUT(req);
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.error.code).toBe("UNPROCESSABLE_ENTITY");
      expect(data.error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "sections[0].type" }),
        ])
      );
    });

    it("rejects non-existent product reference with 422", async () => {
      fixture = await catalogFixture("owner");
      const getRes = await GET(homepageRequest("GET", undefined, fixture));
      const { draft } = await getRes.json();

      const req = homepageRequest(
        "PUT",
        {
          expectedRevision: draft.revision,
          sections: [
            {
              id: "sec-fp",
              type: "featured_products",
              enabled: true,
              position: 0,
              productIds: ["fake-non-existent-prod"],
            },
          ],
        },
        fixture
      );

      const res = await PUT(req);
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.error.details).toEqual([
        {
          field: "sections[0].productIds[0]",
          message: "Referenced product 'fake-non-existent-prod' does not exist",
        },
      ]);
    });

    it("rejects non-existent category reference with 422", async () => {
      fixture = await catalogFixture("owner");
      const getRes = await GET(homepageRequest("GET", undefined, fixture));
      const { draft } = await getRes.json();

      const req = homepageRequest(
        "PUT",
        {
          expectedRevision: draft.revision,
          sections: [
            {
              id: "sec-fc",
              type: "featured_categories",
              enabled: true,
              position: 0,
              categoryIds: ["fake-non-existent-cat"],
            },
          ],
        },
        fixture
      );

      const res = await PUT(req);
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.error.details).toEqual([
        {
          field: "sections[0].categoryIds[0]",
          message: "Referenced category 'fake-non-existent-cat' does not exist",
        },
      ]);
    });

    it("rejects stale expectedRevision with 409 Conflict", async () => {
      fixture = await catalogFixture("owner");
      const getRes = await GET(homepageRequest("GET", undefined, fixture));
      const { draft } = await getRes.json();

      const req = homepageRequest(
        "PUT",
        {
          expectedRevision: draft.revision + 99,
          sections: [],
        },
        fixture
      );

      const res = await PUT(req);
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error.code).toBe("CONFLICT");
      expect(data.error.message).toBe("Draft has been modified by another user");
    });

    it("successfully saves valid draft, increments revision, writes audit log, and returns updated draft", async () => {
      fixture = await catalogFixture("owner");
      const prodId = "prd-test-route-1";
      await db
        .insert(products)
        .values({ id: prodId, name: "منتج للاختبار", slug: prodId })
        .onConflictDoNothing();
      fixture.productIds.push(prodId);

      const getRes = await GET(homepageRequest("GET", undefined, fixture));
      const { draft: initialDraft } = await getRes.json();

      const validSections = [
        {
          id: "hero-section-1",
          type: "hero" as const,
          enabled: true,
          position: 0,
          productIds: [prodId],
          categoryIds: [fixture.categoryId],
        },
        {
          id: "best-sellers-1",
          type: "best_sellers" as const,
          enabled: true,
          position: 1,
          limit: 6,
        },
      ];

      const correlationId = "corr-test-homepage-save";
      const putRes = await PUT(
        homepageRequest(
          "PUT",
          {
            expectedRevision: initialDraft.revision,
            sections: validSections,
          },
          fixture,
          { "x-correlation-id": correlationId }
        )
      );

      expect(putRes.status).toBe(200);
      expect(putRes.headers.get("Cache-Control")).toBe("private, no-store");
      expect(putRes.headers.get("Pragma")).toBe("no-cache");

      const putData = await putRes.json();
      expect(putData.success).toBe(true);
      expect(putData.draft.revision).toBe(initialDraft.revision + 1);
      expect(putData.draft.sections).toEqual(validSections);
      expect(putData.csrf).toBe(fixture.csrf);

      // Verify DB persistence
      const [dbDraft] = await db
        .select()
        .from(homepageDrafts)
        .where(eq(homepageDrafts.key, "default"));
      expect(dbDraft.revision).toBe(initialDraft.revision + 1);
      expect(dbDraft.sections).toEqual(validSections);

      // Verify audit log
      const audits = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, "content.homepage.draft.save"));
      const audit = audits.find((a) => a.requestId === correlationId);
      expect(audit).toBeDefined();
      expect(audit).toMatchObject({
        actor: `staff:${fixture.userId}`,
        resource: "homepage_draft:default",
        requestId: correlationId,
      });
    });
  });
});
