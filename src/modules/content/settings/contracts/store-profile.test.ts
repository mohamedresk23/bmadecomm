import { describe, expect, it } from "vitest";
import { storeProfileUpdateInputSchema } from "./store-profile";

describe("storeProfileUpdateInputSchema", () => {
  const validBase = {
    store_name: "متجر بيميد",
    legal_name: "شركة التجارة الإلكترونية المصرية ش.ذ.م.م",
    support_email: "support@bmadecomm.eg",
    support_phone: "+201012345678",
    address: "15 شارع مصدق، الدقي، الجيزة، مصر",
    logo_media_id: "media_12345",
    default_language: "ar-EG" as const,
    currency: "EGP" as const,
    timezone: "Africa/Cairo",
    date_format: "YYYY-MM-DD" as const,
    order_prefix: "ORD-",
  };

  it("validates a complete valid input", () => {
    const result = storeProfileUpdateInputSchema.safeParse(validBase);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.store_name).toBe("متجر بيميد");
      expect(result.data.currency).toBe("EGP");
      expect(result.data.order_prefix).toBe("ORD-");
    }
  });

  it("applies defaults for optional omitted fields", () => {
    const minimal = {
      store_name: "My Store",
      support_email: "support@store.com",
      support_phone: "01099887766",
    };
    const result = storeProfileUpdateInputSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.default_language).toBe("ar-EG");
      expect(result.data.currency).toBe("EGP");
      expect(result.data.timezone).toBe("Africa/Cairo");
      expect(result.data.date_format).toBe("YYYY-MM-DD");
      expect(result.data.order_prefix).toBe("ORD-");
      expect(result.data.legal_name).toBeUndefined();
      expect(result.data.address).toBeUndefined();
      expect(result.data.logo_media_id).toBeUndefined();
    }
  });

  describe("Egyptian phone number validation", () => {
    const validPhones = [
      "+201012345678", // Vodafone with +20
      "+201198765432", // Etisalat with +20
      "+201200000000", // Orange with +20
      "+201511223344", // WE with +20
      "01012345678",   // Vodafone local
      "01198765432",   // Etisalat local
      "01234567890",   // Orange local
      "01555555555",   // WE local
    ];

    for (const phone of validPhones) {
      it(`accepts valid Egyptian phone: ${phone}`, () => {
        const result = storeProfileUpdateInputSchema.safeParse({
          ...validBase,
          support_phone: phone,
        });
        expect(result.success).toBe(true);
      });
    }

    const invalidPhones = [
      "1012345678",  // Missing leading 0 or +20
      "01312345678", // Invalid mobile prefix (013 is landline Qalyubia)
      "01412345678", // 014 doesn't exist
      "1234567890",  // Random 10 digits
      "+12025550199",// US number
      "0101234567",  // Too short (9 digits)
      "0101234567890",// Too long
      "phone_number",// Non-numeric
    ];

    for (const phone of invalidPhones) {
      it(`rejects invalid phone: ${phone}`, () => {
        const result = storeProfileUpdateInputSchema.safeParse({
          ...validBase,
          support_phone: phone,
        });
        expect(result.success).toBe(false);
      });
    }
  });

  describe("Email validation", () => {
    it("accepts valid email", () => {
      const result = storeProfileUpdateInputSchema.safeParse({
        ...validBase,
        support_email: "care@domain.com.eg",
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid email formats", () => {
      for (const email of ["invalid", "test@", "@domain.com", "test@.com"]) {
        const result = storeProfileUpdateInputSchema.safeParse({
          ...validBase,
          support_email: email,
        });
        expect(result.success).toBe(false);
      }
    });
  });

  describe("Order prefix validation", () => {
    const validPrefixes = ["ORD-", "BM-", "INV_", "X", "ORD2026-", "SHOP_01"];
    for (const prefix of validPrefixes) {
      it(`accepts valid prefix: ${prefix}`, () => {
        const result = storeProfileUpdateInputSchema.safeParse({
          ...validBase,
          order_prefix: prefix,
        });
        expect(result.success).toBe(true);
      });
    }

    const invalidPrefixes = [
      "ord-",               // Lowercase not allowed
      "TOOLONGPREFIX123",  // Longer than 10 characters
      "ORD#",               // Disallowed symbol '#'
      "ORD 1",              // Space not allowed
      "",                   // Empty string
    ];
    for (const prefix of invalidPrefixes) {
      it(`rejects invalid prefix: ${prefix}`, () => {
        const result = storeProfileUpdateInputSchema.safeParse({
          ...validBase,
          order_prefix: prefix,
        });
        expect(result.success).toBe(false);
      });
    }
  });

  describe("String boundary lengths", () => {
    it("rejects store_name with fewer than 2 characters", () => {
      const result = storeProfileUpdateInputSchema.safeParse({
        ...validBase,
        store_name: "A",
      });
      expect(result.success).toBe(false);
    });

    it("rejects store_name longer than 100 characters", () => {
      const result = storeProfileUpdateInputSchema.safeParse({
        ...validBase,
        store_name: "A".repeat(101),
      });
      expect(result.success).toBe(false);
    });

    it("accepts store_name exactly 2 or 100 characters", () => {
      expect(
        storeProfileUpdateInputSchema.safeParse({
          ...validBase,
          store_name: "AB",
        }).success
      ).toBe(true);
      expect(
        storeProfileUpdateInputSchema.safeParse({
          ...validBase,
          store_name: "A".repeat(100),
        }).success
      ).toBe(true);
    });

    it("rejects legal_name longer than 150 characters", () => {
      const result = storeProfileUpdateInputSchema.safeParse({
        ...validBase,
        legal_name: "L".repeat(151),
      });
      expect(result.success).toBe(false);
    });

    it("rejects address longer than 300 characters", () => {
      const result = storeProfileUpdateInputSchema.safeParse({
        ...validBase,
        address: "A".repeat(301),
      });
      expect(result.success).toBe(false);
    });
  });

  describe("Currency validation", () => {
    it("accepts supported currencies", () => {
      for (const curr of ["EGP", "USD", "EUR", "SAR", "AED", "GBP"] as const) {
        const result = storeProfileUpdateInputSchema.safeParse({
          ...validBase,
          currency: curr,
        });
        expect(result.success).toBe(true);
      }
    });

    it("rejects unsupported currency", () => {
      const result = storeProfileUpdateInputSchema.safeParse({
        ...validBase,
        currency: "JPY",
      });
      expect(result.success).toBe(false);
    });
  });
});
