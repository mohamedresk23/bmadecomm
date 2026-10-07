import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb, withIsolatedTx } from "../../../../test-utils/db";
import { auditEvents, shippingMethods, shippingZones } from "../../../../db/schema";
import { ApiError } from "../../../../shared/api/errors";
import {
  listShippingZones,
  createShippingZone,
  updateShippingZone,
  deleteShippingZone,
  createShippingMethod,
  updateShippingMethod,
  deleteShippingMethod,
  checkShippingEligibility,
} from "./shipping";

beforeAll(setupTestDb);

describe("Shipping Service & Eligibility Engine", () => {
  it("lists baseline seeded shipping zones with methods", async () => {
    await withIsolatedTx(async (tx) => {
      const zones = await listShippingZones(tx);

      expect(zones.length).toBeGreaterThanOrEqual(3);
      const cairoZone = zones.find((z) => z.id === "zone_cairo_giza");
      expect(cairoZone).toBeDefined();
      expect(cairoZone?.governorates).toContain("cairo");
      expect(cairoZone?.governorates).toContain("giza");
      expect(cairoZone?.methods.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("creates a new shipping zone and writes an audit event (AC-E03-02-01)", async () => {
    await withIsolatedTx(async (tx) => {
      // First, create an inactive zone with some governorate to avoid exclusivity conflict
      const created = await createShippingZone(
        tx,
        {
          name_ar: "منطقة تجريبية",
          name_en: "Test Zone",
          country_code: "EG",
          governorates: ["matrouh"],
          is_active: false,
        },
        "user_owner",
        "req_123"
      );

      expect(created.id).toBeDefined();
      expect(created.name_ar).toBe("منطقة تجريبية");

      // Verify audit event
      const audits = await tx
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, "shipping_zone.created"));
      expect(audits.length).toBeGreaterThan(0);
      const lastAudit = audits[audits.length - 1];
      expect(lastAudit.resource).toBe(`shipping_zone:${created.id}`);
      expect(lastAudit.actor).toBe("user_owner");
    });
  });

  it("updates an existing shipping zone and writes audit log", async () => {
    await withIsolatedTx(async (tx) => {
      const updated = await updateShippingZone(
        tx,
        "zone_cairo_giza",
        {
          name_ar: "القاهرة والجيزة المحدثة",
        },
        "user_owner"
      );

      expect(updated.name_ar).toBe("القاهرة والجيزة المحدثة");

      const audits = await tx
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, "shipping_zone.updated"));
      expect(audits.length).toBeGreaterThan(0);
    });
  });

  it("rejects creating or updating a zone with a governorate already assigned to an active zone (AC-E03-02-02)", async () => {
    await withIsolatedTx(async (tx) => {
      // 'cairo' is already assigned to 'zone_cairo_giza' which is active
      let error: ApiError | null = null;
      try {
        await createShippingZone(
          tx,
          {
            name_ar: "منطقة مكررة",
            name_en: "Duplicate Cairo Zone",
            country_code: "EG",
            governorates: ["cairo"],
            is_active: true,
          },
          "user_owner"
        );
      } catch (err) {
        error = err as ApiError;
      }

      expect(error).not.toBeNull();
      expect(error?.statusCode).toBe(422);
      expect(error?.code).toBe("GOVERNORATE_ALREADY_ASSIGNED");
      expect(error?.details?.[0]?.field).toBe("governorates");
      expect(error?.details?.[0]?.message).toContain("cairo");
    });
  });

  it("evaluates shipping eligibility for serviced addresses (AC-E03-02-03)", async () => {
    await withIsolatedTx(async (tx) => {
      // Greater Cairo should be eligible
      const result = await checkShippingEligibility(tx, {
        country_code: "EG",
        governorate: "cairo",
        city: "مدينة نصر",
      });

      expect(result.is_eligible).toBe(true);
      if (result.is_eligible) {
        expect(result.zone_name).toBe("القاهرة الكبرى");
        expect(result.available_methods.length).toBeGreaterThan(0);
        const standard = result.available_methods.find(
          (m) => m.method_id === "sm_cairo_standard"
        );
        expect(standard).toBeDefined();
        expect(standard?.cost_minor).toBe(5000);
        expect(standard?.cost_formatted).toBe("50.00 ج.م");
      }
    });
  });

  it("evaluates eligibility by matching Arabic governorate names (AC-E03-02-03)", async () => {
    await withIsolatedTx(async (tx) => {
      const result = await checkShippingEligibility(tx, {
        country_code: "EG",
        governorate: "الإسكندرية",
      });

      expect(result.is_eligible).toBe(true);
      if (result.is_eligible) {
        expect(result.zone_name).toBe("الإسكندرية والدلتا");
        expect(result.available_methods.length).toBeGreaterThan(0);
      }
    });
  });

  it("rejects unserviced or disabled locations with localized explanation (AC-E03-02-04)", async () => {
    await withIsolatedTx(async (tx) => {
      // Deactivate zone_canal_upper
      await tx
        .update(shippingZones)
        .set({ isActive: false })
        .where(eq(shippingZones.id, "zone_canal_upper"));

      const result = await checkShippingEligibility(tx, {
        country_code: "EG",
        governorate: "aswan",
      });

      expect(result.is_eligible).toBe(false);
      if (!result.is_eligible) {
        expect(result.reason).toContain("غير متاح حاليًا");
        expect(result.available_methods).toEqual([]);
      }
    });
  });

  it("manages shipping methods with audit logs and cascade deletion (AC-E03-02-01)", async () => {
    await withIsolatedTx(async (tx) => {
      // 1. Create method
      const createdMethod = await createShippingMethod(
        tx,
        {
          zone_id: "zone_cairo_giza",
          name_ar: "شحن فوري VIP",
          name_en: "Instant VIP Shipping",
          cost_minor: 15000,
          estimated_days_min: 0,
          estimated_days_max: 1,
          is_active: true,
        },
        "user_owner"
      );

      expect(createdMethod.id).toBeDefined();
      expect(createdMethod.cost_minor).toBe(15000);

      // 2. Update method
      const updatedMethod = await updateShippingMethod(
        tx,
        createdMethod.id,
        {
          cost_minor: 12000,
          is_active: false,
        },
        "user_owner"
      );
      expect(updatedMethod.cost_minor).toBe(12000);
      expect(updatedMethod.is_active).toBe(false);

      // 3. Delete method
      await deleteShippingMethod(tx, createdMethod.id, "user_owner");
      const [deleted] = await tx
        .select()
        .from(shippingMethods)
        .where(eq(shippingMethods.id, createdMethod.id));
      expect(deleted).toBeUndefined();

      // 4. Cascade delete: deleting zone deletes methods
      await deleteShippingZone(tx, "zone_cairo_giza", "user_owner");
      const methodsRemaining = await tx
        .select()
        .from(shippingMethods)
        .where(eq(shippingMethods.zoneId, "zone_cairo_giza"));
      expect(methodsRemaining).toHaveLength(0);
    });
  });
});
