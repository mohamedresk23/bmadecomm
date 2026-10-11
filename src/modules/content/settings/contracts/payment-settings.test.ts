import { describe, it, expect } from "vitest";
import {
  canonicalIntegerStringSchema,
  paymentMethodConfigUpdateInputSchema,
  paymentMethodConfigDtoSchema,
  defaultReadinessProvider,
  type PaymentMethodConfigDto,
} from "./payment-settings";

describe("Payment Settings Contracts", () => {
  describe("canonicalIntegerStringSchema", () => {
    it("accepts valid canonical integer strings", () => {
      expect(canonicalIntegerStringSchema.parse("0")).toBe("0");
      expect(canonicalIntegerStringSchema.parse("1")).toBe("1");
      expect(canonicalIntegerStringSchema.parse("5000")).toBe("5000");
      expect(canonicalIntegerStringSchema.parse("2147483647")).toBe("2147483647");
    });

    it("rejects numbers (numeric JSON)", () => {
      expect(() => canonicalIntegerStringSchema.parse(0)).toThrow();
      expect(() => canonicalIntegerStringSchema.parse(5000)).toThrow();
    });

    it("rejects leading zeros", () => {
      expect(() => canonicalIntegerStringSchema.parse("01")).toThrow();
      expect(() => canonicalIntegerStringSchema.parse("00")).toThrow();
      expect(() => canonicalIntegerStringSchema.parse("0100")).toThrow();
    });

    it("rejects decimals and floats", () => {
      expect(() => canonicalIntegerStringSchema.parse("10.5")).toThrow();
      expect(() => canonicalIntegerStringSchema.parse("10.0")).toThrow();
      expect(() => canonicalIntegerStringSchema.parse("0.5")).toThrow();
    });

    it("rejects signs and scientific notation", () => {
      expect(() => canonicalIntegerStringSchema.parse("+100")).toThrow();
      expect(() => canonicalIntegerStringSchema.parse("-100")).toThrow();
      expect(() => canonicalIntegerStringSchema.parse("1e5")).toThrow();
      expect(() => canonicalIntegerStringSchema.parse("2e10")).toThrow();
    });

    it("rejects 32-bit signed integer overflow", () => {
      expect(() => canonicalIntegerStringSchema.parse("2147483648")).toThrow();
      expect(() => canonicalIntegerStringSchema.parse("99999999999999")).toThrow();
    });

    it("rejects empty or whitespace-only strings", () => {
      expect(() => canonicalIntegerStringSchema.parse("")).toThrow();
      expect(() => canonicalIntegerStringSchema.parse(" ")).toThrow();
      expect(() => canonicalIntegerStringSchema.parse(" 100 ")).toThrow();
    });
  });

  describe("paymentMethodConfigUpdateInputSchema", () => {
    it("validates a full valid update payload", () => {
      const payload = {
        title_ar: "الدفع عند الاستلام المحدث",
        title_en: "Cash on Delivery Updated",
        instructions_ar: "يرجى تجهيز المبلغ المطلوب بالضبط",
        instructions_en: "Please prepare the exact amount",
        is_enabled: true,
        min_order_subtotal_minor: "5000",
        max_order_subtotal_minor: "100000",
        expected_version: 1,
      };

      const parsed = paymentMethodConfigUpdateInputSchema.parse(payload);
      expect(parsed.title_ar).toBe("الدفع عند الاستلام المحدث");
      expect(parsed.expected_version).toBe(1);
      expect(parsed.min_order_subtotal_minor).toBe("5000");
    });

    it("validates partial updates with single field", () => {
      const payload = {
        is_enabled: false,
        expected_version: 3,
      };

      const parsed = paymentMethodConfigUpdateInputSchema.parse(payload);
      expect(parsed.is_enabled).toBe(false);
      expect(parsed.expected_version).toBe(3);
    });

    it("allows null for subtotal bounds to represent unbounded limits", () => {
      const payload = {
        min_order_subtotal_minor: null,
        max_order_subtotal_minor: null,
        expected_version: 2,
      };

      const parsed = paymentMethodConfigUpdateInputSchema.parse(payload);
      expect(parsed.min_order_subtotal_minor).toBeNull();
      expect(parsed.max_order_subtotal_minor).toBeNull();
    });

    it("allows bound of '0' and distinguishes it from null", () => {
      const payload = {
        min_order_subtotal_minor: "0",
        expected_version: 1,
      };

      const parsed = paymentMethodConfigUpdateInputSchema.parse(payload);
      expect(parsed.min_order_subtotal_minor).toBe("0");
      expect(parsed.min_order_subtotal_minor).not.toBeNull();
    });

    it("allows equal min and max subtotal bounds", () => {
      const payload = {
        min_order_subtotal_minor: "5000",
        max_order_subtotal_minor: "5000",
        expected_version: 1,
      };

      const parsed = paymentMethodConfigUpdateInputSchema.parse(payload);
      expect(parsed.min_order_subtotal_minor).toBe("5000");
      expect(parsed.max_order_subtotal_minor).toBe("5000");
    });

    it("rejects min > max subtotal bounds within the payload", () => {
      const payload = {
        min_order_subtotal_minor: "10000",
        max_order_subtotal_minor: "5000",
        expected_version: 1,
      };

      expect(() => paymentMethodConfigUpdateInputSchema.parse(payload)).toThrow(
        /Minimum subtotal bound cannot exceed maximum subtotal bound/
      );
    });

    it("allows clearing instructions with empty string", () => {
      const payload = {
        instructions_ar: "",
        instructions_en: "",
        expected_version: 1,
      };

      const parsed = paymentMethodConfigUpdateInputSchema.parse(payload);
      expect(parsed.instructions_ar).toBe("");
      expect(parsed.instructions_en).toBe("");
    });

    it("rejects instructions exceeding 2000 characters", () => {
      const payload = {
        instructions_en: "a".repeat(2001),
        expected_version: 1,
      };

      expect(() => paymentMethodConfigUpdateInputSchema.parse(payload)).toThrow();
    });

    it("rejects titles shorter than 2 characters or longer than 100 characters", () => {
      expect(() =>
        paymentMethodConfigUpdateInputSchema.parse({
          title_ar: "a",
          expected_version: 1,
        })
      ).toThrow();

      expect(() =>
        paymentMethodConfigUpdateInputSchema.parse({
          title_en: "a".repeat(101),
          expected_version: 1,
        })
      ).toThrow();
    });

    it("rejects missing expected_version", () => {
      const payload = {
        is_enabled: true,
      };

      expect(() => paymentMethodConfigUpdateInputSchema.parse(payload)).toThrow();
    });

    it("rejects invalid expected_version (0, negative, or float)", () => {
      expect(() =>
        paymentMethodConfigUpdateInputSchema.parse({
          is_enabled: true,
          expected_version: 0,
        })
      ).toThrow();

      expect(() =>
        paymentMethodConfigUpdateInputSchema.parse({
          is_enabled: true,
          expected_version: -1,
        })
      ).toThrow();

      expect(() =>
        paymentMethodConfigUpdateInputSchema.parse({
          is_enabled: true,
          expected_version: 1.5,
        })
      ).toThrow();
    });

    it("rejects empty edit where only expected_version is provided", () => {
      const payload = {
        expected_version: 1,
      };

      expect(() => paymentMethodConfigUpdateInputSchema.parse(payload)).toThrow(
        /At least one configuration field must be provided for update/
      );
    });

    it("strictly rejects forbidden secret keys and credential fields", () => {
      const secretPayloads = [
        { is_enabled: true, expected_version: 1, secret_key: "sk_live_123" },
        { is_enabled: true, expected_version: 1, apiKey: "api_key_secret" },
        { is_enabled: true, expected_version: 1, client_secret: "cs_123" },
        { is_enabled: true, expected_version: 1, token: "bearer_xyz" },
        { is_enabled: true, expected_version: 1, merchant_id: "m_123" },
      ];

      for (const payload of secretPayloads) {
        expect(() => paymentMethodConfigUpdateInputSchema.parse(payload)).toThrow();
      }
    });

    it("strictly rejects attempt to overwrite read-only or metadata fields", () => {
      const readOnlyPayloads = [
        { is_enabled: true, expected_version: 1, id: "cod" },
        { is_enabled: true, expected_version: 1, currency: "USD" },
        { is_enabled: true, expected_version: 1, currency_exponent: 3 },
        { is_enabled: true, expected_version: 1, is_ready: true },
        { is_enabled: true, expected_version: 1, readiness_reason: "READY" },
        { is_enabled: true, expected_version: 1, updated_at: new Date().toISOString() },
        { is_enabled: true, expected_version: 1, updated_by: "actor_1" },
        { is_enabled: true, expected_version: 1, version: 5 },
      ];

      for (const payload of readOnlyPayloads) {
        expect(() => paymentMethodConfigUpdateInputSchema.parse(payload)).toThrow();
      }
    });
  });

  describe("paymentMethodConfigDtoSchema", () => {
    it("validates a complete payment method config DTO", () => {
      const dto: PaymentMethodConfigDto = {
        id: "cod",
        title_ar: "الدفع عند الاستلام",
        title_en: "Cash on Delivery",
        instructions_ar: "الدفع عند استلام الطلب",
        instructions_en: "Pay when delivered",
        is_enabled: true,
        min_order_subtotal_minor: "5000",
        max_order_subtotal_minor: null,
        version: 1,
        updated_at: new Date().toISOString(),
        updated_by: "user_123",
        currency: "EGP",
        currency_exponent: 2,
        is_ready: true,
        readiness_reason: "READY",
      };

      const parsed = paymentMethodConfigDtoSchema.parse(dto);
      expect(parsed.id).toBe("cod");
      expect(parsed.currency).toBe("EGP");
      expect(parsed.currency_exponent).toBe(2);
    });
  });

  describe("defaultReadinessProvider", () => {
    it("returns READY for cod and NOT_CONFIGURED for online_card", () => {
      const codReadiness = defaultReadinessProvider.getReadiness("cod");
      expect(codReadiness.is_ready).toBe(true);
      expect(codReadiness.readiness_reason).toBe("READY");

      const onlineReadiness = defaultReadinessProvider.getReadiness("online_card");
      expect(onlineReadiness.is_ready).toBe(false);
      expect(onlineReadiness.readiness_reason).toBe("NOT_CONFIGURED");
    });
  });
});

