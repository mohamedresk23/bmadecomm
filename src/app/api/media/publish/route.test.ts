import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../../../db";
import { roles, sessions, staffAccounts, userRoles, users } from "../../../../db/schema";
import { setupTestDb } from "../../../../test-utils/db";
import { issueStaffSession } from "../../../../modules/identity/infrastructure/staff-sessions";
import { STAFF_SESSION_POLICY, staffConfig } from "../../../../modules/identity/infrastructure/staff-config";
import { encryptStaffSecret, newStaffSeed, sessionCsrf } from "../../../../modules/identity/infrastructure/staff-crypto";
import { publishMedia } from "../../../../lib/media/upload";
import { POST } from "./route";

vi.mock("../../../../lib/media/upload", () => ({ publishMedia: vi.fn() }));
beforeAll(setupTestDb);
const createdUsers: string[] = [];
beforeEach(() => {
  vi.stubEnv("APP_URL", "http://localhost:3000");
  vi.stubEnv("STAFF_MFA_KEY", randomBytes(32).toString("base64"));
  vi.mocked(publishMedia).mockReset().mockResolvedValue({ id: "abc123", url: "/uploads/abc123.png" });
});
afterEach(async () => {
  for (const id of createdUsers) {
    await db.delete(sessions).where(eq(sessions.userId, id));
    await db.delete(userRoles).where(eq(userRoles.userId, id));
    await db.delete(staffAccounts).where(eq(staffAccounts.userId, id));
    await db.delete(users).where(eq(users.id, id));
  }
  createdUsers.length = 0;
  vi.unstubAllEnvs();
});
async function owner(role = "owner") {
  const userId = randomUUID();
  createdUsers.push(userId);
  await db.insert(users).values({ id: userId, email: `${userId}@example.test`, role: "staff", name: "Upload fixture", phone: "01000000000", passwordHash: "fixture" });
  await db.insert(staffAccounts).values({ userId, mfaEnrolledAt: new Date(), mfaSeed: encryptStaffSecret(newStaffSeed(), staffConfig().key, userId, "mfa") });
  await db.insert(roles).values({ key: role }).onConflictDoNothing();
  await db.insert(userRoles).values({ userId, roleKey: role });
  const issued = await issueStaffSession(db, userId, STAFF_SESSION_POLICY);
  if (!issued) throw new Error("Fixture session issuance failed");
  return { ...issued, userId };
}
function request(token?: string, overrides: Record<string, string | null> = {}) {
  const headers = new Headers({ Origin: staffConfig().origin });
  if (token) {
    headers.set("Cookie", `__Host-staff-session=${token}`);
    headers.set("X-CSRF-Token", sessionCsrf(token, staffConfig().key));
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) headers.delete(key); else headers.set(key, value);
  }
  const body = new FormData();
  body.append("file", new File(["fixture"], "logo.png", { type: "image/png" }));
  headers.set("Content-Type", "application/json"); return new Request(`${staffConfig().origin}/api/media/publish`, { method: "POST", headers, body: JSON.stringify({ id: "abc123" }) });
}
async function denied(req: Request, status: number) {
  const parse = vi.spyOn(req, "formData");
  const response = await POST(req);
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(parse).not.toHaveBeenCalled();
  expect(publishMedia).not.toHaveBeenCalled();
}
describe("Owner explicit publish security boundary", () => {
  it("accepts an issued Owner session with exact Origin and session CSRF", async () => {
    const { token } = await owner();
    const response = await POST(request(token));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ id: "abc123", url: "/uploads/abc123.png" });
    expect(publishMedia).toHaveBeenCalledExactlyOnceWith("abc123");
  });
  it.each<Record<string, string | null>>([{ "X-CSRF-Token": null }, { "X-CSRF-Token": "forged" }, { Origin: null }, { Origin: "http://foreign.test" }])("rejects invalid CSRF or Origin %j before parsing files", async (headers) => {
    const { token } = await owner();
    await denied(request(token, headers), 403);
  });
  it("rejects guests", async () => { await denied(request(), 401); });
  it("rejects a valid CSRF token issued to a different session", async () => {
    const first = await owner();
    const second = await owner();
    await denied(request(first.token, { "X-CSRF-Token": sessionCsrf(second.token, staffConfig().key) }), 403);
  });
  it("rejects forged mock authority", async () => {
    await denied(request(undefined, { "x-mock-user": JSON.stringify({ id: "forged", roles: ["owner"], permissions: ["media:upload"] }) }), 401);
  });
  it("rejects a nonowner issued session even with forged authority", async () => {
    const { token } = await owner("store_manager");
    await denied(request(token, { "x-mock-user": JSON.stringify({ roles: ["owner"], permissions: ["media:upload"] }) }), 403);
  });
  it.each(["expired", "idle-expired", "revoked", "disabled", "customer"])("rejects %s identities before parsing files", async (state) => {
    const fixture = await owner();
    const past = new Date(Date.now() - 60_000);
    if (state === "expired") await db.update(sessions).set({ expiresAt: past }).where(eq(sessions.id, fixture.sessionId));
    if (state === "idle-expired") await db.update(sessions).set({ idleExpiresAt: past }).where(eq(sessions.id, fixture.sessionId));
    if (state === "revoked") await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, fixture.sessionId));
    if (state === "disabled") await db.update(staffAccounts).set({ enabled: false }).where(eq(staffAccounts.userId, fixture.userId));
    if (state === "customer") {
      await db.update(users).set({ role: "customer" }).where(eq(users.id, fixture.userId));
      await db.update(sessions).set({ context: "customer" }).where(eq(sessions.id, fixture.sessionId));
    }
    await denied(request(fixture.token), 401);
  });
});
