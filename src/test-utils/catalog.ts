import { randomBytes, randomUUID } from "node:crypto";
import { vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { categories, products, roles, users, staffAccounts, userRoles, sessions } from "../db/schema";
import { issueStaffSession } from "../modules/identity/infrastructure/staff-sessions";
import { staffConfig, STAFF_SESSION_POLICY } from "../modules/identity/infrastructure/staff-config";
import { encryptStaffSecret, newStaffSeed, sessionCsrf } from "../modules/identity/infrastructure/staff-crypto";

export async function catalogFixture(role = "owner") {
  vi.stubEnv("APP_URL", "http://localhost:3000");
  vi.stubEnv("STAFF_MFA_KEY", randomBytes(32).toString("base64"));
  const config = staffConfig();
  const userId = randomUUID(), categoryId = randomUUID();
  await db.insert(users).values({ id: userId, name: "Staff", email: `${userId}@example.test`, phone: "01000000000", passwordHash: "fixture", role: "staff" });
  await db.insert(staffAccounts).values({ userId, mfaSeed: encryptStaffSecret(newStaffSeed(), config.key, userId, "mfa"), mfaEnrolledAt: new Date() });
  await db.insert(roles).values({ key: role }).onConflictDoNothing();
  await db.insert(userRoles).values({ userId, roleKey: role });
  const session = await issueStaffSession(db, userId, STAFF_SESSION_POLICY);
  if (!session) throw new Error("Fixture session failed");
  await db.insert(categories).values({ id: categoryId, name: "ملابس", slug: `fixture-${categoryId}` });
  const productIds: string[] = [];
  const endpoint = "http://localhost:3000/api/v1/admin/catalog/products";
  const csrf = sessionCsrf(session.token, config.key);
  function request(method = "GET", body?: unknown, id?: string, override?: Record<string, string>) {
    return new Request(id ? `${endpoint}/${id}` : endpoint, {
      method,
      headers: { Cookie: `__Host-staff-session=${session!.token}`, "Content-Type": "application/json", Origin: config.origin, "X-CSRF-Token": csrf, "X-Pricing-Revision": "EGP:2", ...override },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function cleanup() {
    if (productIds.length) await db.delete(products).where(inArray(products.id, productIds));
    await db.delete(categories).where(eq(categories.id, categoryId));
    await db.delete(sessions).where(eq(sessions.userId, userId));
    await db.delete(userRoles).where(eq(userRoles.userId, userId));
    await db.delete(staffAccounts).where(eq(staffAccounts.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
    vi.unstubAllEnvs();
  }
  return { userId, categoryId, token: session.token, sessionId: session.sessionId, csrf, productIds, endpoint, request, cleanup };
}
