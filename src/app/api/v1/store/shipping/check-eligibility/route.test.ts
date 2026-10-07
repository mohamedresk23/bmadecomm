import { beforeAll, describe, expect, it } from "vitest";
import { setupTestDb } from "../../../../../../test-utils/db";
import { POST } from "./route";

beforeAll(setupTestDb);

describe("Public Shipping Eligibility Check API Route", () => {
  it("rejects request with missing governorate with 422 Unprocessable Entity", async () => {
    const req = new Request("http://localhost:3000/api/v1/store/shipping/check-eligibility", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        country_code: "EG",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("UNPROCESSABLE_ENTITY");
  });

  it("returns eligible and available methods for Cairo (AC-E03-02-03)", async () => {
    const req = new Request("http://localhost:3000/api/v1/store/shipping/check-eligibility", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        country_code: "EG",
        governorate: "cairo",
        city: "مدينة نصر",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.is_eligible).toBe(true);
    expect(body.available_methods.length).toBeGreaterThan(0);

    const standard = body.available_methods.find(
      (m: { name: string; cost_minor: number; cost_formatted: string }) =>
        m.name.includes("عادي") || m.name.includes("القياسي")
    );
    expect(standard).toBeDefined();
    expect(standard.cost_minor).toBeGreaterThanOrEqual(0);
    expect(standard.cost_formatted).toContain("ج.م");
  });

  it("supports localized Arabic governorate name (e.g. القاهرة)", async () => {
    const req = new Request("http://localhost:3000/api/v1/store/shipping/check-eligibility", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        country_code: "EG",
        governorate: "القاهرة",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.is_eligible).toBe(true);
    expect(body.available_methods.length).toBeGreaterThan(0);
  });

  it("returns is_eligible: false and clear reason for unknown/unserviced location (AC-E03-02-04)", async () => {
    const req = new Request("http://localhost:3000/api/v1/store/shipping/check-eligibility", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        country_code: "EG",
        governorate: "unknown_location_xyz",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.is_eligible).toBe(false);
    expect(body.available_methods).toEqual([]);
    expect(body.reason).toContain("غير صالحة أو غير معروفة");
  });
});
