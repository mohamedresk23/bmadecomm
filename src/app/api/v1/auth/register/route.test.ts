import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { POST } from "./route";
import { db } from "../../../../../db";
import { users, proofTokens, outbox } from "../../../../../db/schema";
import { setupTestDb } from "../../../../../test-utils/db";

beforeAll(setupTestDb);
afterEach(() => vi.unstubAllEnvs());
function configure() {
  vi.stubEnv("EMAIL_ADAPTER", "sandbox"); vi.stubEnv("APP_URL", "http://localhost:3000");
  vi.stubEnv("IDENTITY_TOKEN_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("IDENTITY_TRUSTED_IP_HEADER", "x-test-source");
}
function input(email = `${randomUUID()}@example.test`) { return { name: "Customer", email, phone: "1234", password: "approved passphrase" }; }
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://attacker-host.test/api/v1/auth/register", { method: "POST",
    headers: { "Content-Type": "application/json", "x-test-source": `127.0.0.${Math.ceil(Math.random() * 200)}`, ...headers }, body: JSON.stringify(body) });
}
describe("registration HTTP composition", () => {
  it("responds identically for a new and normalized duplicate account, with safe no-store headers", async () => {
    configure(); const dto = input();
    const first = await POST(request(dto));
    const duplicate = await POST(request({ ...dto, email: ` ${dto.email.toUpperCase()} `, name: "Changed" }));
    expect(first.status).toBe(200); expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toEqual(await first.json());
    expect(first.headers.get("cache-control")).toBe("no-store");
    const records = await db.select().from(users).where(eq(users.email, dto.email));
    expect(records).toHaveLength(1); expect(records[0].name).toBe("Customer");
    expect(await db.select().from(proofTokens).where(eq(proofTokens.userId, records[0].id))).toHaveLength(1);
    expect(await db.select().from(outbox).where(eq(outbox.dedupeKey, `register-verification-${records[0].id}`))).toHaveLength(1);
  });
  it("rejects validation, unknown fields, malformed JSON, content type and bad origin without identity writes", async () => {
    configure();
    const dto = input();
    const cases = [
      [request({ ...dto, role: "admin" }), 400], [request({ ...dto, password: "short" }), 400],
      [request({ email: dto.email }), 400], [request(dto, { "Content-Type": "text/plain" }), 415],
      [request(dto, { Origin: "https://evil.test" }), 403],
      [new Request("http://localhost", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }), 400],
    ] as const;
    for (const [req, expected] of cases) {
      const response = await POST(req); expect(response.status).toBe(expected);
      expect((await response.json()).error.request_id).toMatch(/^[a-f0-9-]{36}$/);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(await db.select().from(users).where(eq(users.email, dto.email))).toHaveLength(0);
  });
  it("limits actual streamed bytes even with a lying Content-Length", async () => {
    configure();
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode('{"name":"'));
      controller.enqueue(new TextEncoder().encode("界".repeat(3000)));
      controller.close();
    } });
    const req = new Request("http://localhost", { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": "10" },
      body: stream, duplex: "half" } as RequestInit);
    expect((await POST(req)).status).toBe(413);
  });
  it("times out a hung body after ten seconds and cancels/releases the reader", async () => {
    configure(); vi.useFakeTimers();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const req = new Request("http://localhost", { method: "POST", headers: { "Content-Type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
    try {
      const pending = POST(req);
      await vi.advanceTimersByTimeAsync(10000);
      const response = await pending; expect(response.status).toBe(408);
      expect((await response.json()).error.code).toBe("REQUEST_TIMEOUT");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(cancel).toHaveBeenCalledTimes(1); expect(stream.locked).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it("cancels and releases a pending body read when the request aborts", async () => {
    configure();
    const cancel = vi.fn(); const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const req = new Request("http://localhost", { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
    const pending = POST(req); controller.abort();
    expect((await pending).status).toBe(400); expect(cancel).toHaveBeenCalledTimes(1); expect(stream.locked).toBe(false);
  });
  it("applies the same email throttle with Retry-After to new and existing email", async () => {
    configure();
    for (const existing of [false, true]) {
      const dto = input();
      if (existing) {
        const { composeRegistration } = await import("../../../../../modules/identity/infrastructure/registration");
        await composeRegistration(db, Buffer.from(process.env.IDENTITY_TOKEN_KEY!, "base64"))(dto);
      }
      for (let i = 0; i < 3; i++) expect((await POST(request(dto, { "x-test-source": `192.0.2.${i + (existing ? 10 : 1)}` }))).status).toBe(200);
      const limited = await POST(request(dto, { "x-test-source": "192.0.2.100" }));
      expect(limited.status).toBe(429); expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
      expect((await limited.json()).error.message).toBe("Please try again later");
    }
  });
  it("exhausts one source at the request boundary and writes no eleventh identity", async () => {
    configure();
    const source = "198.51.100.230";
    for (let index = 0; index < 10; index++) expect((await POST(request(input(), { "x-test-source": source }))).status).toBe(200);
    const proofsBefore = (await db.select().from(proofTokens)).length, eventsBefore = (await db.select().from(outbox)).length;
    const rejected = input(); const response = await POST(request(rejected, { "x-test-source": source }));
    expect(response.status).toBe(429); expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await db.select().from(users).where(eq(users.email, rejected.email))).toHaveLength(0);
    expect(await db.select().from(proofTokens)).toHaveLength(proofsBefore); expect(await db.select().from(outbox)).toHaveLength(eventsBefore);
  });
  it("uses a shared source without trusted proxy configuration despite forged forwarded headers", async () => {
    configure(); vi.stubEnv("IDENTITY_TRUSTED_IP_HEADER", "");
    for (let index = 0; index < 10; index++) {
      expect((await POST(request(input(), { "x-forwarded-for": `203.0.113.${index}`, forwarded: `for=203.0.113.${index}`, "x-real-ip": `203.0.113.${index}` }))).status).toBe(200);
    }
    const rejected = input();
    const response = await POST(request(rejected, { "x-forwarded-for": "192.0.2.254", forwarded: "for=192.0.2.254", "x-real-ip": "192.0.2.254" }));
    expect(response.status).toBe(429); expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await db.select().from(users).where(eq(users.email, rejected.email))).toHaveLength(0);
  });
  it("sanitizes unknown errors and never logs exception details", async () => {
    configure();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const read = vi.fn().mockRejectedValue(new Error("private-password-and-token"));
    const req = { headers: new Headers({ "Content-Type": "application/json" }), body: { getReader: () => ({ read, releaseLock() {} }) } } as unknown as Request;
    const response = await POST(req); expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("private-password");
    expect(spy).not.toHaveBeenCalled(); spy.mockRestore();
  });
  it("fails closed in production and when sandbox secret configuration is absent", async () => {
    configure(); vi.stubEnv("NODE_ENV", "production");
    expect((await POST(request(input()))).status).toBe(503);
    vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("IDENTITY_TOKEN_KEY", "");
    expect((await POST(request(input()))).status).toBe(503);
  });
});
