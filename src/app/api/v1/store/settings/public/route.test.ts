import { beforeAll, describe, expect, it } from "vitest";
import { setupTestDb } from "../../../../../../test-utils/db";
import { GET } from "./route";

beforeAll(setupTestDb);

describe("Public Store Settings API Route (AC-E03-01-06)", () => {
  it("returns safe store metadata without requiring authentication", async () => {
    const req = new Request("http://localhost:3000/api/v1/store/settings/public", {
      method: "GET",
    });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const cacheHeader = res.headers.get("cache-control");
    expect(cacheHeader).toContain("public");
    expect(cacheHeader).toContain("max-age=60");

    const data = await res.json();
    expect(data.store_name).toBeDefined();
    expect(data.currency).toBeDefined();
    expect(data.support_email).toBeDefined();
    expect(data.timezone).toBeDefined();
    expect(data.enabled_payment_methods).toEqual([]);

    // Internal fields must never be exposed publicly
    expect(data.order_prefix).toBeUndefined();
    expect(data.updated_by).toBeUndefined();
    expect(data.id).toBeUndefined();
  });
});

