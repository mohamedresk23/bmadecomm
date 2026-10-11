import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../../../../../../test-utils/db";
import { db } from "../../../../../../db";
import {
  roles,
  staffAccounts,
  userRoles,
  users,
  sessions,
  paymentMethodConfigs,
  auditEvents,
} from "../../../../../../db/schema";
import * as auditModule from "../../../../../../shared/authz/audit";
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
import { GET } from "./route";
import { PUT } from "./[id]/route";

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

  // Restore baseline payment method configurations
  await db
    .update(paymentMethodConfigs)
    .set({
      titleAr: "الدفع عند الاستلام",
      titleEn: "Cash on Delivery",
      instructionsAr: "الدفع عند استلام الطلب",
      instructionsEn: "Pay when your order is delivered.",
      isEnabled: true,
      minOrderSubtotalMinor: null,
      maxOrderSubtotalMinor: null,
      version: 1,
      updatedBy: null,
    })
    .where(eq(paymentMethodConfigs.id, "cod"));

  await db
    .update(paymentMethodConfigs)
    .set({
      titleAr: "بطاقة بنكية",
      titleEn: "Credit / Debit Card",
      instructionsAr: "الدفع بالبطاقة الائتمانية أو بطاقة الخصم المباشر",
      instructionsEn: "Pay securely with credit or debit card.",
      isEnabled: true,
      minOrderSubtotalMinor: null,
      maxOrderSubtotalMinor: null,
      version: 1,
      updatedBy: null,
    })
    .where(eq(paymentMethodConfigs.id, "online_card"));
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

describe("Admin Payment Settings API Routes", () => {
  describe("RBAC & Authentication (AC-E03-03-04)", () => {
    it("rejects unauthenticated GET requests with 401 Unauthorized", async () => {
      configureEnv();
      const req = new Request("http://localhost:3000/api/v1/admin/settings/payments", {
        method: "GET",
      });

      const res = await GET(req);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
    });

    it("rejects unauthenticated PUT requests with 401 Unauthorized", async () => {
      configureEnv();
      const req = new Request(
        "http://localhost:3000/api/v1/admin/settings/payments/cod",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_enabled: false, expected_version: 1 }),
        }
      );

      const res = await PUT(req, { params: Promise.resolve({ id: "cod" }) });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
    });

    it("rejects non-owner staff on GET with 403 Forbidden", async () => {
      configureEnv();
      const { token } = await createStaffUser("store_manager");

      const req = new Request("http://localhost:3000/api/v1/admin/settings/payments", {
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

    it("rejects non-owner staff on PUT with 403 Forbidden", async () => {
      const config = configureEnv();
      const { token } = await createStaffUser("store_manager");
      const validCsrf = sessionCsrf(token, config.key);

      const req = new Request(
        "http://localhost:3000/api/v1/admin/settings/payments/cod",
        {
          method: "PUT",
          headers: {
            Cookie: `__Host-staff-session=${token}`,
            "Content-Type": "application/json",
            "X-CSRF-Token": validCsrf,
            Origin: config.origin,
          },
          body: JSON.stringify({ is_enabled: false, expected_version: 1 }),
        }
      );

      const res = await PUT(req, { params: Promise.resolve({ id: "cod" }) });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("FORBIDDEN");
    });
  });

  describe("CSRF and Origin Protection (AC-E03-03-04)", () => {
    it("rejects PUT without CSRF token with 403 Forbidden", async () => {
      const config = configureEnv();
      const { token } = await createStaffUser("owner");

      const req = new Request(
        "http://localhost:3000/api/v1/admin/settings/payments/cod",
        {
          method: "PUT",
          headers: {
            Cookie: `__Host-staff-session=${token}`,
            "Content-Type": "application/json",
            Origin: config.origin,
          },
          body: JSON.stringify({ is_enabled: false, expected_version: 1 }),
        }
      );

      const res = await PUT(req, { params: Promise.resolve({ id: "cod" }) });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("FORBIDDEN");
      expect(body.error.message).toMatch(/CSRF/i);
    });

    it("rejects PUT with forged CSRF token with 403 Forbidden", async () => {
      const config = configureEnv();
      const { token } = await createStaffUser("owner");

      const req = new Request(
        "http://localhost:3000/api/v1/admin/settings/payments/cod",
        {
          method: "PUT",
          headers: {
            Cookie: `__Host-staff-session=${token}`,
            "Content-Type": "application/json",
            "X-CSRF-Token": "forged_invalid_csrf",
            Origin: config.origin,
          },
          body: JSON.stringify({ is_enabled: false, expected_version: 1 }),
        }
      );

      const res = await PUT(req, { params: Promise.resolve({ id: "cod" }) });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("FORBIDDEN");
    });

    it("rejects PUT with mismatched Origin with 403 Forbidden", async () => {
      const config = configureEnv();
      const { token } = await createStaffUser("owner");
      const validCsrf = sessionCsrf(token, config.key);

      const req = new Request(
        "http://localhost:3000/api/v1/admin/settings/payments/cod",
        {
          method: "PUT",
          headers: {
            Cookie: `__Host-staff-session=${token}`,
            "Content-Type": "application/json",
            "X-CSRF-Token": validCsrf,
            Origin: "http://attacker-site.com",
          },
          body: JSON.stringify({ is_enabled: false, expected_version: 1 }),
        }
      );

      const res = await PUT(req, { params: Promise.resolve({ id: "cod" }) });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("FORBIDDEN");
    });
  });

  describe("GET /api/v1/admin/settings/payments", () => {
    it("returns exactly 2 baseline methods in canonical order with CSRF and no-store headers", async () => {
      configureEnv();
      const { token } = await createStaffUser("owner");

      const req = new Request("http://localhost:3000/api/v1/admin/settings/payments", {
        method: "GET",
        headers: {
          Cookie: `__Host-staff-session=${token}`,
        },
      });

      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toContain("no-store");
      expect(res.headers.get("cache-control")).toContain("private");

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.csrf).toBeDefined();
      expect(typeof body.csrf).toBe("string");
      expect(body.methods).toHaveLength(2);

      const [first, second] = body.methods;
      expect(first.id).toBe("cod");
      expect(first.title_ar).toBe("الدفع عند الاستلام");
      expect(first.title_en).toBe("Cash on Delivery");
      expect(first.is_enabled).toBe(true);
      expect(first.version).toBe(1);
      expect(first.currency).toBe("EGP");
      expect(first.currency_exponent).toBe(2);
      expect(first.is_ready).toBe(true);
      expect(first.readiness_reason).toBe("READY");

      expect(second.id).toBe("online_card");
      expect(second.title_ar).toBe("بطاقة بنكية");
      expect(second.is_enabled).toBe(true);
      expect(second.version).toBe(1);
      expect(second.currency).toBe("EGP");
      expect(second.currency_exponent).toBe(2);
      expect(second.is_ready).toBe(false);
      expect(second.readiness_reason).toBe("NOT_CONFIGURED");

      // Verify zero provider secrets in the entire response body
      const rawJson = JSON.stringify(body);
      expect(rawJson).not.toMatch(/secret/i);
      expect(rawJson).not.toMatch(/apikey/i);
      expect(rawJson).not.toMatch(/token/i);
    });
  });

  describe("PUT /api/v1/admin/settings/payments/[id]", () => {
    it("returns 404 for unknown payment method ID", async () => {
      const config = configureEnv();
      const { token } = await createStaffUser("owner");
      const validCsrf = sessionCsrf(token, config.key);

      const req = new Request(
        "http://localhost:3000/api/v1/admin/settings/payments/unknown_method",
        {
          method: "PUT",
          headers: {
            Cookie: `__Host-staff-session=${token}`,
            "Content-Type": "application/json",
            "X-CSRF-Token": validCsrf,
            Origin: config.origin,
          },
          body: JSON.stringify({ is_enabled: false, expected_version: 1 }),
        }
      );

      const res = await PUT(req, {
        params: Promise.resolve({ id: "unknown_method" }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("NOT_FOUND");
    });

    it("returns 422 when expected_version is missing", async () => {
      const config = configureEnv();
      const { token } = await createStaffUser("owner");
      const validCsrf = sessionCsrf(token, config.key);

      const req = new Request(
        "http://localhost:3000/api/v1/admin/settings/payments/cod",
        {
          method: "PUT",
          headers: {
            Cookie: `__Host-staff-session=${token}`,
            "Content-Type": "application/json",
            "X-CSRF-Token": validCsrf,
            Origin: config.origin,
          },
          body: JSON.stringify({ is_enabled: false }),
        }
      );

      const res = await PUT(req, { params: Promise.resolve({ id: "cod" }) });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error.code).toBe("UNPROCESSABLE_ENTITY");
    });

    it("returns 422 for empty edit (only expected_version provided)", async () => {
      const config = configureEnv();
      const { token } = await createStaffUser("owner");
      const validCsrf = sessionCsrf(token, config.key);

      const req = new Request(
        "http://localhost:3000/api/v1/admin/settings/payments/cod",
        {
          method: "PUT",
          headers: {
            Cookie: `__Host-staff-session=${token}`,
            "Content-Type": "application/json",
            "X-CSRF-Token": validCsrf,
            Origin: config.origin,
          },
          body: JSON.stringify({ expected_version: 1 }),
        }
      );

      const res = await PUT(req, { params: Promise.resolve({ id: "cod" }) });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error.code).toBe("UNPROCESSABLE_ENTITY");
    });

    it("rejects forbidden keys with 422 and does NOT log or echo secret values (AC-E03-03-03)", async () => {
      const config = configureEnv();
      const { token } = await createStaffUser("owner");
      const validCsrf = sessionCsrf(token, config.key);

      const sensitiveSecret = "sk_live_very_secret_key_123456789";
      const req = new Request(
        "http://localhost:3000/api/v1/admin/settings/payments/cod",
        {
          method: "PUT",
          headers: {
            Cookie: `__Host-staff-session=${token}`,
            "Content-Type": "application/json",
            "X-CSRF-Token": validCsrf,
            Origin: config.origin,
          },
          body: JSON.stringify({
            is_enabled: true,
            expected_version: 1,
            secret_key: sensitiveSecret,
          }),
        }
      );

      const res = await PUT(req, { params: Promise.resolve({ id: "cod" }) });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error.code).toBe("UNPROCESSABLE_ENTITY");

      // Verify the secret value is NEVER returned in the error response
      const rawRes = JSON.stringify(body);
      expect(rawRes).not.toContain(sensitiveSecret);
    });

    it("returns 422 when min > max subtotal bounds are sent in payload", async () => {
      const config = configureEnv();
      const { token } = await createStaffUser("owner");
      const validCsrf = sessionCsrf(token, config.key);

      const req = new Request(
        "http://localhost:3000/api/v1/admin/settings/payments/cod",
        {
          method: "PUT",
          headers: {
            Cookie: `__Host-staff-session=${token}`,
            "Content-Type": "application/json",
            "X-CSRF-Token": validCsrf,
            Origin: config.origin,
          },
          body: JSON.stringify({
            min_order_subtotal_minor: "5000",
            max_order_subtotal_minor: "1000",
            expected_version: 1,
          }),
        }
      );

      const res = await PUT(req, { params: Promise.resolve({ id: "cod" }) });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error.code).toBe("UNPROCESSABLE_ENTITY");
    });

    it("returns 422 when partial bound edit conflicts with persisted bound", async () => {
      const config = configureEnv();
      const { token } = await createStaffUser("owner");
      const validCsrf = sessionCsrf(token, config.key);

      // Seed row with max_order_subtotal_minor = 10000
      await db
        .update(paymentMethodConfigs)
        .set({ maxOrderSubtotalMinor: 10000 })
        .where(eq(paymentMethodConfigs.id, "cod"));

      // Send update with only min_order_subtotal_minor = 15000
      const req = new Request(
        "http://localhost:3000/api/v1/admin/settings/payments/cod",
        {
          method: "PUT",
          headers: {
            Cookie: `__Host-staff-session=${token}`,
            "Content-Type": "application/json",
            "X-CSRF-Token": validCsrf,
            Origin: config.origin,
          },
          body: JSON.stringify({
            min_order_subtotal_minor: "15000",
            expected_version: 1,
          }),
        }
      );

      const res = await PUT(req, { params: Promise.resolve({ id: "cod" }) });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error.code).toBe("UNPROCESSABLE_ENTITY");
    });

    it("successfully updates configuration, increments version to N+1, and records atomic audit", async () => {
      const config = configureEnv();
      const { userId, token } = await createStaffUser("owner");
      const validCsrf = sessionCsrf(token, config.key);
      const testCorrelationId = randomUUID();

      const req = new Request(
        "http://localhost:3000/api/v1/admin/settings/payments/cod",
        {
          method: "PUT",
          headers: {
            Cookie: `__Host-staff-session=${token}`,
            "Content-Type": "application/json",
            "X-CSRF-Token": validCsrf,
            Origin: config.origin,
            "X-Correlation-ID": testCorrelationId,
          },
          body: JSON.stringify({
            title_ar: "الدفع عند الاستلام المحدث",
            title_en: "Updated Cash on Delivery",
            instructions_ar: "يرجى تحضير المبلغ بالكامل",
            instructions_en: "Please prepare exact change",
            min_order_subtotal_minor: "1000",
            max_order_subtotal_minor: "50000",
            expected_version: 1,
          }),
        }
      );

      const res = await PUT(req, { params: Promise.resolve({ id: "cod" }) });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toContain("no-store");

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.method.id).toBe("cod");
      expect(body.method.title_ar).toBe("الدفع عند الاستلام المحدث");
      expect(body.method.title_en).toBe("Updated Cash on Delivery");
      expect(body.method.instructions_ar).toBe("يرجى تحضير المبلغ بالكامل");
      expect(body.method.min_order_subtotal_minor).toBe("1000");
      expect(body.method.max_order_subtotal_minor).toBe("50000");
      expect(body.method.version).toBe(2);
      expect(body.method.updated_by).toBe(userId);

      // Verify row persisted in database
      const [row] = await db
        .select()
        .from(paymentMethodConfigs)
        .where(eq(paymentMethodConfigs.id, "cod"));
      expect(row.version).toBe(2);
      expect(row.titleAr).toBe("الدفع عند الاستلام المحدث");
      expect(row.minOrderSubtotalMinor).toBe(1000);
      expect(row.maxOrderSubtotalMinor).toBe(50000);
      expect(row.updatedBy).toBe(userId);

      // Verify atomic audit event was recorded
      const audits = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.requestId, testCorrelationId));
      expect(audits).toHaveLength(1);
      const audit = audits[0];
      expect(audit.actor).toBe(userId);
      expect(audit.action).toBe("payment_method_config.updated");
      expect(audit.requestId).toBe(testCorrelationId);
      expect(audit.diff).toBeDefined();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const diff = audit.diff as any;
      expect(diff.before.version).toBe(1);
      expect(diff.after.version).toBe(2);
      expect(diff.after.title_ar).toBe("الدفع عند الاستلام المحدث");
      expect(diff.after.min_order_subtotal_minor).toBe("1000");
    });

    it("rejects stale write with 409 STALE_PAYMENT_METHOD_CONFIG and zero DB or audit changes (AC-E03-03-07)", async () => {
      const config = configureEnv();
      const { token } = await createStaffUser("owner");
      const validCsrf = sessionCsrf(token, config.key);
      const staleCorrelationId = randomUUID();

      // Advance row version to 2
      await db
        .update(paymentMethodConfigs)
        .set({ version: 2, titleEn: "Version 2 Title" })
        .where(eq(paymentMethodConfigs.id, "cod"));

      // Attempt update with stale expected_version: 1
      const req = new Request(
        "http://localhost:3000/api/v1/admin/settings/payments/cod",
        {
          method: "PUT",
          headers: {
            Cookie: `__Host-staff-session=${token}`,
            "Content-Type": "application/json",
            "X-CSRF-Token": validCsrf,
            Origin: config.origin,
            "X-Correlation-ID": staleCorrelationId,
          },
          body: JSON.stringify({
            title_en: "Attempted Stale Title",
            expected_version: 1,
          }),
        }
      );

      const res = await PUT(req, { params: Promise.resolve({ id: "cod" }) });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe("STALE_PAYMENT_METHOD_CONFIG");

      // Verify zero changes to DB row
      const [row] = await db
        .select()
        .from(paymentMethodConfigs)
        .where(eq(paymentMethodConfigs.id, "cod"));
      expect(row.version).toBe(2);
      expect(row.titleEn).toBe("Version 2 Title");

      // Verify zero audit record created for this attempt
      const auditsAfter = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.requestId, staleCorrelationId));
      expect(auditsAfter).toHaveLength(0);
    });

    it("allows disabling both payment methods (AC-E03-03-10)", async () => {
      const config = configureEnv();
      const { token } = await createStaffUser("owner");
      const validCsrf = sessionCsrf(token, config.key);

      // Disable cod
      const req1 = new Request(
        "http://localhost:3000/api/v1/admin/settings/payments/cod",
        {
          method: "PUT",
          headers: {
            Cookie: `__Host-staff-session=${token}`,
            "Content-Type": "application/json",
            "X-CSRF-Token": validCsrf,
            Origin: config.origin,
          },
          body: JSON.stringify({ is_enabled: false, expected_version: 1 }),
        }
      );
      const res1 = await PUT(req1, { params: Promise.resolve({ id: "cod" }) });
      expect(res1.status).toBe(200);

      // Disable online_card
      const req2 = new Request(
        "http://localhost:3000/api/v1/admin/settings/payments/online_card",
        {
          method: "PUT",
          headers: {
            Cookie: `__Host-staff-session=${token}`,
            "Content-Type": "application/json",
            "X-CSRF-Token": validCsrf,
            Origin: config.origin,
          },
          body: JSON.stringify({ is_enabled: false, expected_version: 1 }),
        }
      );
      const res2 = await PUT(req2, {
        params: Promise.resolve({ id: "online_card" }),
      });
      expect(res2.status).toBe(200);

      const rows = await db.select().from(paymentMethodConfigs);
      expect(rows.every((r) => r.isEnabled === false)).toBe(true);
    });

    it("rolls back database update when writeAudit fails during transaction (AC-E03-03-01)", async () => {
      const config = configureEnv();
      const { token } = await createStaffUser("owner");
      const validCsrf = sessionCsrf(token, config.key);

      const writeAuditSpy = vi
        .spyOn(auditModule, "writeAudit")
        .mockRejectedValueOnce(new Error("Simulated audit write failure"));

      const req = new Request(
        "http://localhost:3000/api/v1/admin/settings/payments/cod",
        {
          method: "PUT",
          headers: {
            Cookie: `__Host-staff-session=${token}`,
            "Content-Type": "application/json",
            "X-CSRF-Token": validCsrf,
            Origin: config.origin,
          },
          body: JSON.stringify({
            title_en: "Failed Audit Update Title",
            expected_version: 1,
          }),
        }
      );

      try {
        const res = await PUT(req, { params: Promise.resolve({ id: "cod" }) });
        expect(res.status).toBe(500);

        // Verify row and version remain unchanged in DB
        const [row] = await db
          .select()
          .from(paymentMethodConfigs)
          .where(eq(paymentMethodConfigs.id, "cod"));
        expect(row.version).toBe(1);
        expect(row.titleEn).toBe("Cash on Delivery");
      } finally {
        writeAuditSpy.mockRestore();
      }
    });

    it("clears subtotal bounds to null and updates to '0', persisting distinct formatting (AC-E03-03-02)", async () => {
      const config = configureEnv();
      const { token } = await createStaffUser("owner");
      const validCsrf = sessionCsrf(token, config.key);

      // Seed existing non-null bounds on cod
      await db
        .update(paymentMethodConfigs)
        .set({
          minOrderSubtotalMinor: 5000,
          maxOrderSubtotalMinor: 20000,
          version: 1,
        })
        .where(eq(paymentMethodConfigs.id, "cod"));

      // 1. Update existing bounds to null (unbounded)
      const reqNull = new Request(
        "http://localhost:3000/api/v1/admin/settings/payments/cod",
        {
          method: "PUT",
          headers: {
            Cookie: `__Host-staff-session=${token}`,
            "Content-Type": "application/json",
            "X-CSRF-Token": validCsrf,
            Origin: config.origin,
          },
          body: JSON.stringify({
            min_order_subtotal_minor: null,
            max_order_subtotal_minor: null,
            expected_version: 1,
          }),
        }
      );
      const resNull = await PUT(reqNull, {
        params: Promise.resolve({ id: "cod" }),
      });
      expect(resNull.status).toBe(200);
      const bodyNull = await resNull.json();
      expect(bodyNull.method.min_order_subtotal_minor).toBeNull();
      expect(bodyNull.method.max_order_subtotal_minor).toBeNull();
      expect(bodyNull.method.version).toBe(2);

      // Verify DB persistence of null
      const [rowNull] = await db
        .select()
        .from(paymentMethodConfigs)
        .where(eq(paymentMethodConfigs.id, "cod"));
      expect(rowNull.minOrderSubtotalMinor).toBeNull();
      expect(rowNull.maxOrderSubtotalMinor).toBeNull();
      expect(rowNull.version).toBe(2);

      // 2. Update min bound to "0" (distinct bound, not null)
      const reqZero = new Request(
        "http://localhost:3000/api/v1/admin/settings/payments/cod",
        {
          method: "PUT",
          headers: {
            Cookie: `__Host-staff-session=${token}`,
            "Content-Type": "application/json",
            "X-CSRF-Token": validCsrf,
            Origin: config.origin,
          },
          body: JSON.stringify({
            min_order_subtotal_minor: "0",
            expected_version: 2,
          }),
        }
      );
      const resZero = await PUT(reqZero, {
        params: Promise.resolve({ id: "cod" }),
      });
      expect(resZero.status).toBe(200);
      const bodyZero = await resZero.json();
      expect(bodyZero.method.min_order_subtotal_minor).toBe("0");
      expect(bodyZero.method.min_order_subtotal_minor).not.toBeNull();
      expect(bodyZero.method.version).toBe(3);

      // Verify DB persistence of 0
      const [rowZero] = await db
        .select()
        .from(paymentMethodConfigs)
        .where(eq(paymentMethodConfigs.id, "cod"));
      expect(rowZero.minOrderSubtotalMinor).toBe(0);
      expect(rowZero.version).toBe(3);
    });
  });
});
