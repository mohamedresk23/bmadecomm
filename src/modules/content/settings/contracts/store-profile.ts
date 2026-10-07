import { z } from "zod";

export const SUPPORTED_CURRENCIES = ["EGP", "USD", "EUR", "SAR", "AED", "GBP"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const CURRENCY_METADATA: Record<SupportedCurrency, { symbol: string; exponent: number }> = {
  EGP: { symbol: "ج.م", exponent: 2 },
  USD: { symbol: "$", exponent: 2 },
  EUR: { symbol: "€", exponent: 2 },
  SAR: { symbol: "ر.س", exponent: 2 },
  AED: { symbol: "د.إ", exponent: 2 },
  GBP: { symbol: "£", exponent: 2 },
};

export const EGYPT_PHONE_REGEX = /^(\+20|0)1[0125]\d{8}$/;
export const ORDER_PREFIX_REGEX = /^[A-Z0-9_-]{1,10}$/;

export const storeProfileUpdateInputSchema = z.object({
  store_name: z
    .string()
    .trim()
    .min(2, "Store name must be at least 2 characters")
    .max(100, "Store name cannot exceed 100 characters"),
  legal_name: z
    .string()
    .trim()
    .max(150, "Legal name cannot exceed 150 characters")
    .nullable()
    .optional(),
  support_email: z
    .string()
    .trim()
    .email("Invalid email address")
    .max(255, "Support email cannot exceed 255 characters"),
  support_phone: z
    .string()
    .trim()
    .regex(EGYPT_PHONE_REGEX, "Invalid Egyptian phone number"),
  address: z
    .string()
    .trim()
    .max(300, "Address cannot exceed 300 characters")
    .nullable()
    .optional(),
  logo_media_id: z.string().trim().nullable().optional(),
  default_language: z.enum(["ar-EG", "en-US", "ar", "en"]).default("ar-EG"),
  currency: z.enum(SUPPORTED_CURRENCIES).default("EGP"),
  timezone: z.string().trim().min(1, "Timezone is required").default("Africa/Cairo"),
  date_format: z.enum(["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"]).default("YYYY-MM-DD"),
  order_prefix: z
    .string()
    .trim()
    .regex(
      ORDER_PREFIX_REGEX,
      "Order prefix must be 1-10 uppercase alphanumeric characters, dashes, or underscores"
    )
    .default("ORD-"),
});

export type StoreProfileUpdateInput = z.infer<typeof storeProfileUpdateInputSchema>;

export type StoreProfileDto = {
  store_name: string;
  legal_name: string | null;
  support_email: string;
  support_phone: string;
  address: string | null;
  logo_media_id: string | null;
  logo_url: string | null;
  default_language: string;
  currency: string;
  currency_symbol: string;
  currency_exponent: number;
  timezone: string;
  date_format: string;
  order_prefix: string;
  updated_at: string;
  updated_by: string | null;
};

export type AdminStoreProfileResponse = {
  profile: StoreProfileDto;
  currency_locked: boolean;
  currency_locked_reason: string | null;
  csrf?: string;
};

export type PublicStoreSettingsDto = {
  store_name: string;
  logo_url: string | null;
  support_email: string;
  support_phone: string;
  address: string | null;
  default_language: string;
  currency: string;
  currency_symbol: string;
  timezone: string;
  enabled_payment_methods: {
    id: string;
    title: string;
    instructions?: string;
  }[];
};
