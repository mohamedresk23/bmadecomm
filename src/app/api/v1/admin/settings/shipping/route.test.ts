import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { setupTestDb } from "../../../../../../test-utils/db";
import { db } from "../../../../../../db";
import {
  roles,
  staffAccounts,
  userRoles,
  users,
  sessions,
  shippingZones,
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
import { GET as getZones, POST as postZone } from "./zones/route";
import { PUT as putZone, DELETE as deleteZone } from "./zones/[id]/route";
import { POST as postMethod } from "./methods/route";
import { PUT as putMethod, DELETE as deleteMethod } from "./methods/[id]/route";

beforeAll(setupTestDb);

const createdUserIds: string[] = [];
const createdZoneIds: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const id of createdUserIds) {
    await db.delete(sessions).where(eq(sessions.userId, id));
    await db.delete(userRoles).where(eq(userRoles.userId, id));
    await db.delete(staffAccounts).where(eq(staffAccounts.userId, id));
    await db.delete(users).where(eq(users.id, id));
  }
  createdUserIds.length = 0;

  if (createdZoneIds.length > 0) {
    await db
      .delete(shippingZones)
      .where(inArray(shippingZones.id, createdZoneIds));
    createdZoneIds.length = 0;
  }
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

describe("Admin Shipping API Routes", () => {
  it("rejects unauthenticated requests to zones GET with 401 Unauthorized", async () => {
    configureEnv();
    const req = new Request("http://localhost:3000/api/v1/admin/settings/shipping/zones", {
      method: "GET",
    });

    const res = await getZones(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects non-owner staff with 403 Forbidden", async () => {
    configureEnv();
    const { token } = await createStaffUser("store_manager");

    const req = new Request("http://localhost:3000/api/v1/admin/settings/shipping/zones", {
      method: "GET",
      headers: {
        Cookie: `__Host-staff-session=${token}`,
      },
    });

    const res = await getZones(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("allows owner to list zones and includes CSRF token", async () => {
    configureEnv();
    const { token } = await createStaffUser("owner");

    const req = new Request("http://localhost:3000/api/v1/admin/settings/shipping/zones", {
      method: "GET",
      headers: {
        Cookie: `__Host-staff-session=${token}`,
      },
    });

    const res = await getZones(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.zones)).toBe(true);
    expect(body.csrf).toBeDefined();
    expect(body.csrf.length).toBeGreaterThan(20);
  });

  it("rejects creating a zone with an already-assigned governorate with 422 (AC-E03-02-02)", async () => {
    const config = configureEnv();
    const { token } = await createStaffUser("owner");
    const validCsrf = sessionCsrf(token, config.key);

    // Cairo is already assigned in baseline seed 'zone-greater-cairo'
    const req = new Request("http://localhost:3000/api/v1/admin/settings/shipping/zones", {
      method: "POST",
      headers: {
        Cookie: `__Host-staff-session=${token}`,
        "Content-Type": "application/json",
        "X-CSRF-Token": validCsrf,
        Origin: config.origin,
      },
      body: JSON.stringify({
        name_ar: "منطقة متداخلة",
        name_en: "Overlapping Zone",
        country_code: "EG",
        governorates: ["cairo"],
        is_active: true,
      }),
    });

    const res = await postZone(req);
    expect(res.status).toBe(422);

    const body = await res.json();
    expect(body.error.code).toBe("GOVERNORATE_ALREADY_ASSIGNED");
    expect(body.error.details[0].field).toBe("governorates");
  });

  it("creates, updates, and deletes a shipping zone and its methods", async () => {
    const config = configureEnv();
    const { token } = await createStaffUser("owner");
    const validCsrf = sessionCsrf(token, config.key);

    // 1. Temporarily deactivate baseline zone covering aswan (zone-canal-upper-egypt) or create a fresh zone
    // First, let's create a custom zone with an unassigned gov or deactivate the existing one
    // Let's create an inactive zone first, which doesn't violate active exclusivity
    const createReq = new Request("http://localhost:3000/api/v1/admin/settings/shipping/zones", {
      method: "POST",
      headers: {
        Cookie: `__Host-staff-session=${token}`,
        "Content-Type": "application/json",
        "X-CSRF-Token": validCsrf,
        Origin: config.origin,
      },
      body: JSON.stringify({
        name_ar: "منطقة تجريبية معطلة",
        name_en: "Disabled Test Zone",
        country_code: "EG",
        governorates: ["aswan"],
        is_active: false,
      }),
    });

    const createRes = await postZone(createReq);
    expect(createRes.status).toBe(201);
    const createBody = await createRes.json();
    expect(createBody.success).toBe(true);
    const zoneId = createBody.zone.id;
    createdZoneIds.push(zoneId);

    // 2. Update zone
    const updateReq = new Request(`http://localhost:3000/api/v1/admin/settings/shipping/zones/${zoneId}`, {
      method: "PUT",
      headers: {
        Cookie: `__Host-staff-session=${token}`,
        "Content-Type": "application/json",
        "X-CSRF-Token": validCsrf,
        Origin: config.origin,
      },
      body: JSON.stringify({
        name_ar: "اسم جديد للمنطقة",
      }),
    });

    const updateRes = await putZone(updateReq, { params: Promise.resolve({ id: zoneId }) });
    expect(updateRes.status).toBe(200);
    const updateBody = await updateRes.json();
    expect(updateBody.zone.name_ar).toBe("اسم جديد للمنطقة");

    // 3. Add method to this zone
    const methodReq = new Request("http://localhost:3000/api/v1/admin/settings/shipping/methods", {
      method: "POST",
      headers: {
        Cookie: `__Host-staff-session=${token}`,
        "Content-Type": "application/json",
        "X-CSRF-Token": validCsrf,
        Origin: config.origin,
      },
      body: JSON.stringify({
        zone_id: zoneId,
        name_ar: "شحن سريع مخصص",
        name_en: "Custom Express",
        cost_minor: 9500,
        estimated_days_min: 1,
        estimated_days_max: 2,
        is_active: true,
      }),
    });

    const methodRes = await postMethod(methodReq);
    expect(methodRes.status).toBe(201);
    const methodBody = await methodRes.json();
    const methodId = methodBody.method.id;
    expect(methodBody.method.cost_minor).toBe(9500);

    // 4. Update method
    const updateMethodReq = new Request(`http://localhost:3000/api/v1/admin/settings/shipping/methods/${methodId}`, {
      method: "PUT",
      headers: {
        Cookie: `__Host-staff-session=${token}`,
        "Content-Type": "application/json",
        "X-CSRF-Token": validCsrf,
        Origin: config.origin,
      },
      body: JSON.stringify({
        cost_minor: 12000,
      }),
    });

    const updateMethodRes = await putMethod(updateMethodReq, { params: Promise.resolve({ id: methodId }) });
    expect(updateMethodRes.status).toBe(200);
    const updatedMethodBody = await updateMethodRes.json();
    expect(updatedMethodBody.method.cost_minor).toBe(12000);

    // 5. Delete method
    const deleteMethodReq = new Request(`http://localhost:3000/api/v1/admin/settings/shipping/methods/${methodId}`, {
      method: "DELETE",
      headers: {
        Cookie: `__Host-staff-session=${token}`,
        "X-CSRF-Token": validCsrf,
        Origin: config.origin,
      },
    });

    const deleteMethodRes = await deleteMethod(deleteMethodReq, { params: Promise.resolve({ id: methodId }) });
    expect(deleteMethodRes.status).toBe(200);

    // 6. Delete zone
    const deleteZoneReq = new Request(`http://localhost:3000/api/v1/admin/settings/shipping/zones/${zoneId}`, {
      method: "DELETE",
      headers: {
        Cookie: `__Host-staff-session=${token}`,
        "X-CSRF-Token": validCsrf,
        Origin: config.origin,
      },
    });

    const deleteZoneRes = await deleteZone(deleteZoneReq, { params: Promise.resolve({ id: zoneId }) });
    expect(deleteZoneRes.status).toBe(200);
  });
});
