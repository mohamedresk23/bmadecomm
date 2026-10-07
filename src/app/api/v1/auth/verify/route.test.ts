import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { POST } from "./route";
import { db } from "../../../../../db";
import { eq } from "drizzle-orm";
import { users, proofTokens } from "../../../../../db/schema";
import { issueVerificationProof } from "../../../../../modules/identity/infrastructure/proofs";
import { setupTestDb } from "../../../../../test-utils/db";

beforeAll(setupTestDb);
afterEach(() => vi.unstubAllEnvs());
function configure() {
  vi.stubEnv("EMAIL_ADAPTER", "sandbox"); vi.stubEnv("APP_URL", "http://localhost:3000");
  vi.stubEnv("IDENTITY_TOKEN_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("IDENTITY_TRUSTED_IP_HEADER", "x-test-source");
}
function request(body: unknown, source = "192.0.2.1", headers = {}) {
  return new Request("http://localhost:3000/api/v1/auth/verify", { method: "POST", headers: { "Content-Type": "application/json", "x-test-source": source, ...headers }, body: JSON.stringify(body) });
}
it("generically rejects unused proofs on already verified and non-customer accounts", async () => {
  configure();
  for (const state of [{ verifiedAt: new Date(0) }, { role: "admin" }]) {
    const userId = randomUUID();
    await db.insert(users).values({ id: userId, email: `${userId}@example.test`, name: "Test", phone: "123", passwordHash: "unused", ...state });
    const { token, proofId } = await issueVerificationProof(db, userId);
    const [before] = await db.select().from(users).where(eq(users.id, userId));
    const response = await POST(request({ userId, token }, "192.0.2.99"));
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBe("Verification link is invalid or expired.");
    expect((await db.select().from(users).where(eq(users.id, userId)))[0]).toEqual(before);
    expect((await db.select().from(proofTokens).where(eq(proofTokens.id, proofId)))[0].consumedAt).toBeNull();
  }
});
it("activates valid proof and returns identical generic errors for reuse, malformed and forged proofs", async () => {
  configure(); const userId = randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@example.test`, name: "Test", phone: "123", passwordHash: "unused" });
  const { token } = await issueVerificationProof(db, userId);
  expect((await POST(request({ userId, token }))).status).toBe(200);
  for (const input of [{ userId, token }, { userId, token: "b".repeat(43) }, { userId, token: "bad" }, { userId: randomUUID(), token }]) {
    const response = await POST(request(input));
    expect(response.status).toBe(400); expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).error.message).toBe("Verification link is invalid or expired.");
  }
});
it("bounds body parsing, rejects origin, fails closed and limits source attempts", async () => {
  configure();
  expect((await POST(request({}, "192.0.2.10", { Origin: "https://evil.test" }))).status).toBe(403);
  expect((await POST(request({}, "192.0.2.10", { "Content-Type": "text/plain" }))).status).toBe(415);
  expect((await POST(request({ token: "a".repeat(9000) }, "192.0.2.10"))).status).toBe(413);
  for (let i = 0; i < 10; i++) expect((await POST(request({}, "192.0.2.11"))).status).toBe(400);
  const limited = await POST(request({}, "192.0.2.11"));
  expect(limited.status).toBe(429); expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  vi.stubEnv("NODE_ENV", "production");
  expect((await POST(request({}))).status).toBe(503);
});
