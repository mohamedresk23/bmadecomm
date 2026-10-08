import { describe, expect, it } from "vitest";
import packageJson from "../../../../package.json";
import { GET } from "./route";

describe("Health API Route (F00-01)", () => {
  it("returns 200 OK with status, build version, and no-store headers", async () => {
    const res = await GET();
    expect(res.status).toBe(200);

    const cacheHeader = res.headers.get("Cache-Control");
    expect(cacheHeader).toContain("no-store");

    const data = await res.json();
    expect(data).toEqual({
      status: "ok",
      version: packageJson.version,
    });
  });
});
