import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { setupTestDb } from "../../../../../../test-utils/db";
import { db } from "../../../../../../db";
import {
  roles,
  staffAccounts,
  userRoles,
  users,
  sessions,
  storeSettings,
} from "../../../../../../db/schema";
import { issueStaffSession } from "../../../../../../modules/identity/infrastructure/staff-sessions";
import {
  staffConfig,
  STAFF_SESSION_POLICY,
} from "../../../../../../modules/identity/infrastructure/staff-config";
import {
  encryptStaffSecret,
  newStaffSeed,
  sessionCsrf,
} from "../../../../../../modules/identity/infrastructure/staff-crypto";
import { GET, PUT } from "./route";

beforeAll(setupTestDb);

const createdUserIds: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const id of createdUserIds) {
    await db.delete(sessions).where(eq(sessions.userId, id));
    await db.delete(userRoles).where(eq(userRoles.userId, id));
    await db.delete(staffAccounts).where(eq(staffAccounts.userId, id));
    await db.delete(users).where(eq(users.id, id));
  }
  createdUserIds.length = 0;

  // Restore default store settings
  await db
    .update(storeSettings)
    .set({
      storeName: "متجر بيميد",
      currency: "EGP",
      currencySymbol: "ج.م",
      currencyExponent: 2,
      orderPrefix: "ORD-",
    })
    .where(eq(storeSettings.id, "default"));

  await db.execute(sql`DROP TABLE IF EXISTS orders;`);
});

function configureEnv() {
  const staffKey = randomBytes(32).toString("base64");
  vi.stubEnv("APP_URL", "http://localhost:3000");
  vi.stubEnv("STAFF_MFA_KEY", staffKey);
  vi.stubEnv("EMAIL_ADAPTER", "sandbox");
  return staffConfig();
}

async function createStaffUser(
  role: string = "owner"
): Promise<{ userId: string; token: string }> {
  const config = staffConfig();
  const userId = randomUUID();
  createdUserIds.push(userId);
  const email = `${userId}@example.test`;
  const seed = newStaffSeed();

  await db.insert(users).values({
    id: userId,
    email,
    role: "staff",
    name: "Test Staff",
    phone: "01000000000",
    passwordHash: "dummy_hash",
  });

  await db.insert(staffAccounts).values({
    userId,
    mfaEnrolledAt: new Date(),
    mfaSeed: encryptStaffSecret(seed, config.key, userId, "mfa"),
  });

  await db.insert(roles).values({ key: role }).onConflictDoNothing();
  await db.insert(userRoles).values({ userId, roleKey: role });

  const session = await issueStaffSession(db, userId, STAFF_SESSION_POLICY);
  if (!session) throw new Error("Failed to issue session");

  return { userId, token: session.token };
}

describe("Admin Store Profile API Route", () => {
  it("rejects unauthenticated requests with 401 Unauthorized", async () => {
    configureEnv();
    const req = new Request("http://localhost:3000/api/v1/admin/settings/profile", {
      method: "GET",
    });

    const res = await GET(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects non-owner roles (e.g. store_manager) with 403 Forbidden (AC-E03-01-05)", async () => {
    configureEnv();
    const { token } = await createStaffUser("store_manager");

    const req = new Request("http://localhost:3000/api/v1/admin/settings/profile", {
      method: "GET",
      headers: {
        Cookie: `__Host-staff-session=${token}`,
      },
    });

    const res = await GET(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("allows owner to GET store profile with CSRF token", async () => {
    configureEnv();
    const { token } = await createStaffUser("owner");

    const req = new Request("http://localhost:3000/api/v1/admin/settings/profile", {
      method: "GET",
      headers: {
        Cookie: `__Host-staff-session=${token}`,
      },
    });

    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");

    const body = await res.json();
    expect(body.profile.store_name).toBe("متجر بيميد");
    expect(body.currency_locked).toBe(false);
    expect(body.csrf).toBeDefined();
    expect(body.csrf.length).toBeGreaterThan(20);
  });

  it("rejects PUT without valid CSRF token with 403 Forbidden", async () => {
    configureEnv();
    const { token } = await createStaffUser("owner");

    const req = new Request("http://localhost:3000/api/v1/admin/settings/profile", {
      method: "PUT",
      headers: {
        Cookie: `__Host-staff-session=${token}`,
        "Content-Type": "application/json",
        "X-CSRF-Token": "invalid_forged_csrf_token",
      },
      body: JSON.stringify({
        store_name: "New Name",
        support_email: "test@example.com",
        support_phone: "01012345678",
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("updates store profile successfully for owner with valid CSRF", async () => {
    const config = configureEnv();
    const { token } = await createStaffUser("owner");
    const validCsrf = sessionCsrf(token, config.key);

    const req = new Request("http://localhost:3000/api/v1/admin/settings/profile", {
      method: "PUT",
      headers: {
        Cookie: `__Host-staff-session=${token}`,
        "Content-Type": "application/json",
        "X-CSRF-Token": validCsrf,
        Origin: config.origin,
      },
      body: JSON.stringify({
        store_name: "متجر تم التحديث",
        support_email: "owner@bmadecomm.eg",
        support_phone: "+201012345678",
        default_language: "ar-EG",
        currency: "EGP",
        timezone: "Africa/Cairo",
        date_format: "YYYY-MM-DD",
        order_prefix: "BMD-",
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.profile.store_name).toBe("متجر تم التحديث");
    expect(body.profile.order_prefix).toBe("BMD-");
  });

  it("enforces currency lock invariant on PUT when orders exist (AC-E03-01-02)", async () => {
    const config = configureEnv();
    const { token } = await createStaffUser("owner");
    const validCsrf = sessionCsrf(token, config.key);

    // Seed 1 order in orders table
    await db.execute(sql`CREATE TABLE IF NOT EXISTS orders (id text primary key, total integer);`);
    await db.execute(sql`INSERT INTO orders (id, total) VALUES ('ord-999', 100);`);

    const req = new Request("http://localhost:3000/api/v1/admin/settings/profile", {
      method: "PUT",
      headers: {
        Cookie: `__Host-staff-session=${token}`,
        "Content-Type": "application/json",
        "X-CSRF-Token": validCsrf,
        Origin: config.origin,
      },
      body: JSON.stringify({
        store_name: "متجر تم التحديث",
        support_email: "owner@bmadecomm.eg",
        support_phone: "+201012345678",
        default_language: "ar-EG",
        currency: "USD", // Attempting to change currency
        timezone: "Africa/Cairo",
        date_format: "YYYY-MM-DD",
        order_prefix: "BMD-",
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.error.code).toBe("CURRENCY_LOCKED_ORDERS_EXIST");
    expect(body.error.details[0].field).toBe("currency");
  });
});
