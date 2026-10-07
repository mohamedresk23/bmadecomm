import { describe, expect, it } from "vitest";
import {
  EGYPT_GOVERNORATES,
  EGYPT_GOVERNORATE_CODES,
  normalizeGovernorateCode,
  createShippingZoneSchema,
  createShippingMethodSchema,
} from "./shipping";

describe("Shipping Contracts & Egypt Governorates", () => {
  it("contains all 27 standard Egypt governorates with valid codes and Arabic/English labels", () => {
    expect(EGYPT_GOVERNORATES).toHaveLength(27);
    expect(EGYPT_GOVERNORATE_CODES).toHaveLength(27);

    // Verify key governorates
    expect(EGYPT_GOVERNORATE_CODES).toContain("cairo");
    expect(EGYPT_GOVERNORATE_CODES).toContain("giza");
    expect(EGYPT_GOVERNORATE_CODES).toContain("alexandria");
    expect(EGYPT_GOVERNORATE_CODES).toContain("aswan");
    expect(EGYPT_GOVERNORATE_CODES).toContain("north_sinai");
    expect(EGYPT_GOVERNORATE_CODES).toContain("south_sinai");

    for (const g of EGYPT_GOVERNORATES) {
      expect(g.code).toBeTruthy();
      expect(g.name_ar).toBeTruthy();
      expect(g.name_en).toBeTruthy();
    }
  });

  describe("normalizeGovernorateCode", () => {
    it("normalizes case and spacing for canonical codes", () => {
      expect(normalizeGovernorateCode("cairo")).toBe("cairo");
      expect(normalizeGovernorateCode("CAIRO")).toBe("cairo");
      expect(normalizeGovernorateCode(" Cairo ")).toBe("cairo");
      expect(normalizeGovernorateCode("red-sea")).toBe("red_sea");
      expect(normalizeGovernorateCode("red sea")).toBe("red_sea");
    });

    it("normalizes common transliteration aliases", () => {
      expect(normalizeGovernorateCode("sharkia")).toBe("sharqia");
      expect(normalizeGovernorateCode("menofia")).toBe("monufia");
      expect(normalizeGovernorateCode("assiut")).toBe("asyut");
      expect(normalizeGovernorateCode("fayoum")).toBe("faiyum");
    });

    it("normalizes from localized Arabic names", () => {
      expect(normalizeGovernorateCode("القاهرة")).toBe("cairo");
      expect(normalizeGovernorateCode("الإسكندرية")).toBe("alexandria");
      expect(normalizeGovernorateCode("الجيزة")).toBe("giza");
    });

    it("returns null for unknown locations", () => {
      expect(normalizeGovernorateCode("dubai")).toBeNull();
      expect(normalizeGovernorateCode("london")).toBeNull();
      expect(normalizeGovernorateCode("")).toBeNull();
    });
  });

  describe("createShippingZoneSchema", () => {
    it("accepts valid shipping zone payload", () => {
      const valid = {
        name_ar: "القاهرة الكبرى",
        name_en: "Greater Cairo",
        country_code: "EG",
        governorates: ["cairo", "giza"],
        is_active: true,
      };

      const result = createShippingZoneSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("rejects unknown governorate codes", () => {
      const invalid = {
        name_ar: "منطقة غير صالحة",
        name_en: "Invalid Zone",
        country_code: "EG",
        governorates: ["cairo", "unknown_gov"],
      };

      const result = createShippingZoneSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("rejects duplicate governorates in the same zone input", () => {
      const duplicate = {
        name_ar: "منطقة مكررة",
        name_en: "Duplicate Gov Zone",
        governorates: ["cairo", "cairo"],
      };

      const result = createShippingZoneSchema.safeParse(duplicate);
      expect(result.success).toBe(false);
    });

    it("rejects empty governorates array", () => {
      const empty = {
        name_ar: "منطقة فارغة",
        name_en: "Empty Zone",
        governorates: [],
      };

      const result = createShippingZoneSchema.safeParse(empty);
      expect(result.success).toBe(false);
    });
  });

  describe("createShippingMethodSchema", () => {
    it("accepts valid shipping method payload", () => {
      const valid = {
        zone_id: "zone_123",
        name_ar: "شحن عادي",
        name_en: "Standard Shipping",
        cost_minor: 5000,
        estimated_days_min: 1,
        estimated_days_max: 3,
        is_active: true,
      };

      const result = createShippingMethodSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("rejects negative cost", () => {
      const invalid = {
        zone_id: "zone_123",
        name_ar: "شحن مجاني خاطئ",
        name_en: "Negative Shipping",
        cost_minor: -100,
        estimated_days_min: 1,
        estimated_days_max: 3,
      };

      const result = createShippingMethodSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("rejects when estimated_days_min > estimated_days_max", () => {
      const invalid = {
        zone_id: "zone_123",
        name_ar: "شحن غير متناسق",
        name_en: "Inconsistent Days",
        cost_minor: 5000,
        estimated_days_min: 5,
        estimated_days_max: 2,
      };

      const result = createShippingMethodSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });
});

