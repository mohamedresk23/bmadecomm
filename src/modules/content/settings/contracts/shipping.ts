import { z } from "zod";

export type EgyptGovernorate = {
  code: string;
  name_ar: string;
  name_en: string;
};

export const EGYPT_GOVERNORATES: readonly EgyptGovernorate[] = [
  { code: "cairo", name_ar: "القاهرة", name_en: "Cairo" },
  { code: "giza", name_ar: "الجيزة", name_en: "Giza" },
  { code: "alexandria", name_ar: "الإسكندرية", name_en: "Alexandria" },
  { code: "dakahlia", name_ar: "الدقهلية", name_en: "Dakahlia" },
  { code: "red_sea", name_ar: "البحر الأحمر", name_en: "Red Sea" },
  { code: "beheira", name_ar: "البحيرة", name_en: "Beheira" },
  { code: "faiyum", name_ar: "الفيوم", name_en: "Faiyum" },
  { code: "gharbia", name_ar: "الغربية", name_en: "Gharbia" },
  { code: "ismailia", name_ar: "الإسماعيلية", name_en: "Ismailia" },
  { code: "monufia", name_ar: "المنوفية", name_en: "Monufia" },
  { code: "minya", name_ar: "المنيا", name_en: "Minya" },
  { code: "qalyubia", name_ar: "القليوبية", name_en: "Qalyubia" },
  { code: "new_valley", name_ar: "الوادي الجديد", name_en: "New Valley" },
  { code: "suez", name_ar: "السويس", name_en: "Suez" },
  { code: "aswan", name_ar: "أسوان", name_en: "Aswan" },
  { code: "asyut", name_ar: "أسيوط", name_en: "Asyut" },
  { code: "beni_suef", name_ar: "بني سويف", name_en: "Beni Suef" },
  { code: "port_said", name_ar: "بورسعيد", name_en: "Port Said" },
  { code: "damietta", name_ar: "دمياط", name_en: "Damietta" },
  { code: "sharqia", name_ar: "الشرقية", name_en: "Sharqia" },
  { code: "south_sinai", name_ar: "جنوب سيناء", name_en: "South Sinai" },
  { code: "kafr_el_sheikh", name_ar: "كفر الشيخ", name_en: "Kafr El Sheikh" },
  { code: "matrouh", name_ar: "مطروح", name_en: "Matrouh" },
  { code: "luxor", name_ar: "الأقصر", name_en: "Luxor" },
  { code: "qena", name_ar: "قنا", name_en: "Qena" },
  { code: "north_sinai", name_ar: "شمال سيناء", name_en: "North Sinai" },
  { code: "sohag", name_ar: "سوهاج", name_en: "Sohag" },
] as const;

export const EGYPT_GOVERNORATE_CODES = EGYPT_GOVERNORATES.map((g) => g.code);

const GOVERNORATE_ALIASES: Record<string, string> = {
  sharkia: "sharqia",
  menofia: "monufia",
  assiut: "asyut",
  fayoum: "faiyum",
  qaliubiya: "qalyubia",
};

export function normalizeGovernorateCode(input: string): string | null {
  if (!input) return null;
  const cleaned = input.trim().toLowerCase().replace(/[\s-]+/g, "_");

  // Check direct code match
  if (EGYPT_GOVERNORATE_CODES.includes(cleaned)) {
    return cleaned;
  }

  // Check alias match
  if (GOVERNORATE_ALIASES[cleaned]) {
    return GOVERNORATE_ALIASES[cleaned];
  }

  // Check Arabic or English name match
  const found = EGYPT_GOVERNORATES.find(
    (g) =>
      g.name_ar === input.trim() ||
      g.name_en.toLowerCase() === input.trim().toLowerCase()
  );
  return found ? found.code : null;
}

export const createShippingZoneSchema = z.object({
  name_ar: z.string().trim().min(2, "Zone Arabic name must be at least 2 characters").max(100),
  name_en: z.string().trim().min(2, "Zone English name must be at least 2 characters").max(100),
  country_code: z.string().trim().length(2).default("EG"),
  governorates: z
    .array(z.string().trim().toLowerCase())
    .min(1, "Zone must contain at least one governorate")
    .refine(
      (govs) => govs.every((g) => EGYPT_GOVERNORATE_CODES.includes(g)),
      "One or more governorates are not valid Egypt governorate codes"
    )
    .refine(
      (govs) => new Set(govs).size === govs.length,
      "Duplicate governorates in the same zone are not allowed"
    ),
  is_active: z.boolean().default(true),
});

export type CreateShippingZoneInput = z.infer<typeof createShippingZoneSchema>;

export const updateShippingZoneSchema = z.object({
  name_ar: z.string().trim().min(2).max(100).optional(),
  name_en: z.string().trim().min(2).max(100).optional(),
  country_code: z.string().trim().length(2).optional(),
  governorates: z
    .array(z.string().trim().toLowerCase())
    .min(1)
    .refine(
      (govs) => govs.every((g) => EGYPT_GOVERNORATE_CODES.includes(g)),
      "One or more governorates are not valid Egypt governorate codes"
    )
    .refine(
      (govs) => new Set(govs).size === govs.length,
      "Duplicate governorates in the same zone are not allowed"
    )
    .optional(),
  is_active: z.boolean().optional(),
});

export type UpdateShippingZoneInput = z.infer<typeof updateShippingZoneSchema>;

export const createShippingMethodSchema = z
  .object({
    zone_id: z.string().trim().min(1, "Zone ID is required"),
    name_ar: z.string().trim().min(2, "Method Arabic name must be at least 2 characters").max(100),
    name_en: z.string().trim().min(2, "Method English name must be at least 2 characters").max(100),
    cost_minor: z.number().int().min(0, "Cost cannot be negative"),
    estimated_days_min: z.number().int().min(0, "Minimum transit days cannot be negative"),
    estimated_days_max: z.number().int().min(0, "Maximum transit days cannot be negative"),
    is_active: z.boolean().default(true),
  })
  .refine(
    (data) => data.estimated_days_min <= data.estimated_days_max,
    {
      message: "Minimum transit days cannot exceed maximum transit days",
      path: ["estimated_days_min"],
    }
  );

export type CreateShippingMethodInput = z.infer<typeof createShippingMethodSchema>;

export const updateShippingMethodSchema = z
  .object({
    name_ar: z.string().trim().min(2).max(100).optional(),
    name_en: z.string().trim().min(2).max(100).optional(),
    cost_minor: z.number().int().min(0).optional(),
    estimated_days_min: z.number().int().min(0).optional(),
    estimated_days_max: z.number().int().min(0).optional(),
    is_active: z.boolean().optional(),
  })
  .refine(
    (data) => {
      if (
        data.estimated_days_min !== undefined &&
        data.estimated_days_max !== undefined
      ) {
        return data.estimated_days_min <= data.estimated_days_max;
      }
      return true;
    },
    {
      message: "Minimum transit days cannot exceed maximum transit days",
      path: ["estimated_days_min"],
    }
  );

export type UpdateShippingMethodInput = z.infer<typeof updateShippingMethodSchema>;

export const checkShippingEligibilitySchema = z.object({
  country_code: z.string().trim().length(2).default("EG"),
  governorate: z.string().trim().min(1, "Governorate is required"),
  city: z.string().trim().optional(),
  postal_code: z.string().trim().optional(),
  method_id: z.string().trim().optional(),
});

export type CheckShippingEligibilityInput = z.infer<
  typeof checkShippingEligibilitySchema
>;

export type ShippingMethodDto = {
  id: string;
  zone_id: string;
  name_ar: string;
  name_en: string;
  cost_minor: number;
  cost_formatted: string;
  estimated_days_min: number;
  estimated_days_max: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ShippingZoneDto = {
  id: string;
  name_ar: string;
  name_en: string;
  country_code: string;
  governorates: string[];
  is_active: boolean;
  methods: ShippingMethodDto[];
  created_at: string;
  updated_at: string;
};

export type AvailableShippingMethodDto = {
  method_id: string;
  name: string;
  cost_minor: number;
  cost_formatted: string;
  estimated_days_min: number;
  estimated_days_max: number;
};

export type ShippingEligibilityResultDto =
  | {
      is_eligible: true;
      zone_name: string;
      available_methods: AvailableShippingMethodDto[];
    }
  | {
      is_eligible: false;
      reason: string;
      available_methods: [];
    };
