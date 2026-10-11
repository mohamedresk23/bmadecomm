import { z } from "zod";

export const SUPPORTED_PAYMENT_METHODS = ["cod", "online_card"] as const;
export type PaymentMethodId = (typeof SUPPORTED_PAYMENT_METHODS)[number];

export const paymentMethodIdSchema = z.enum(SUPPORTED_PAYMENT_METHODS);

export const PAYMENT_METHOD_READINESS_STATUSES = [
  "READY",
  "NOT_CONFIGURED",
  "NOT_APPROVED",
] as const;
export type PaymentMethodReadinessStatus =
  (typeof PAYMENT_METHOD_READINESS_STATUSES)[number];

export type PaymentMethodReadiness = {
  is_ready: boolean;
  readiness_reason: PaymentMethodReadinessStatus;
};

export interface PaymentReadinessProvider {
  getReadiness(
    methodId: PaymentMethodId
  ): Promise<PaymentMethodReadiness> | PaymentMethodReadiness;
}

export const defaultReadinessProvider = {
  getReadiness(methodId: PaymentMethodId): PaymentMethodReadiness {
    if (methodId === "cod") {
      return { is_ready: true, readiness_reason: "READY" };
    }
    return { is_ready: false, readiness_reason: "NOT_CONFIGURED" };
  },
} satisfies PaymentReadinessProvider;

export const canonicalIntegerStringSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)$/, "Must be a non-negative integer string with no leading zeros")
  .refine((val) => {
    const num = Number(val);
    return num >= 0 && num <= 2147483647 && Number.isSafeInteger(num);
  }, "Amount must be between 0 and 2147483647 minor units");

export const paymentMethodConfigUpdateInputSchema = z
  .object({
    title_ar: z
      .string()
      .trim()
      .min(2, "Arabic title must be at least 2 characters")
      .max(100, "Arabic title cannot exceed 100 characters")
      .optional(),
    title_en: z
      .string()
      .trim()
      .min(2, "English title must be at least 2 characters")
      .max(100, "English title cannot exceed 100 characters")
      .optional(),
    instructions_ar: z
      .string()
      .trim()
      .max(2000, "Arabic instructions cannot exceed 2000 characters")
      .optional(),
    instructions_en: z
      .string()
      .trim()
      .max(2000, "English instructions cannot exceed 2000 characters")
      .optional(),
    is_enabled: z.boolean().optional(),
    min_order_subtotal_minor: canonicalIntegerStringSchema.nullable().optional(),
    max_order_subtotal_minor: canonicalIntegerStringSchema.nullable().optional(),
    expected_version: z
      .number()
      .int("Expected version must be an integer")
      .positive("Expected version must be a positive integer"),
  })
  .strict()
  .refine(
    (data) => {
      const configKeys = [
        "title_ar",
        "title_en",
        "instructions_ar",
        "instructions_en",
        "is_enabled",
        "min_order_subtotal_minor",
        "max_order_subtotal_minor",
      ] as const;
      return configKeys.some((k) => data[k] !== undefined);
    },
    {
      message: "At least one configuration field must be provided for update",
      path: ["payload"],
    }
  )
  .refine(
    (data) => {
      if (
        data.min_order_subtotal_minor !== undefined &&
        data.min_order_subtotal_minor !== null &&
        data.max_order_subtotal_minor !== undefined &&
        data.max_order_subtotal_minor !== null
      ) {
        const minVal = parseInt(data.min_order_subtotal_minor, 10);
        const maxVal = parseInt(data.max_order_subtotal_minor, 10);
        return minVal <= maxVal;
      }
      return true;
    },
    {
      message: "Minimum subtotal bound cannot exceed maximum subtotal bound",
      path: ["min_order_subtotal_minor"],
    }
  );

export type PaymentMethodConfigUpdateInput = z.infer<
  typeof paymentMethodConfigUpdateInputSchema
>;

export const paymentMethodConfigDtoSchema = z.object({
  id: paymentMethodIdSchema,
  title_ar: z.string().min(2).max(100),
  title_en: z.string().min(2).max(100),
  instructions_ar: z.string().max(2000),
  instructions_en: z.string().max(2000),
  is_enabled: z.boolean(),
  min_order_subtotal_minor: canonicalIntegerStringSchema.nullable(),
  max_order_subtotal_minor: canonicalIntegerStringSchema.nullable(),
  version: z.number().int().positive(),
  updated_at: z.string(),
  updated_by: z.string().nullable(),
  currency: z.literal("EGP"),
  currency_exponent: z.literal(2),
  is_ready: z.boolean(),
  readiness_reason: z.enum(PAYMENT_METHOD_READINESS_STATUSES),
});

export type PaymentMethodConfigDto = z.infer<typeof paymentMethodConfigDtoSchema>;
export type PaymentMethodConfig = PaymentMethodConfigDto;

export type AdminPaymentMethodsResponse = {
  success: true;
  methods: PaymentMethodConfigDto[];
  csrf: string;
};

export type AdminPaymentMethodUpdateResponse = {
  success: true;
  method: PaymentMethodConfigDto;
};

