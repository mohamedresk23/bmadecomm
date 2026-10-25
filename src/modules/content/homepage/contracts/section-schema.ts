import { z } from "zod";

export const HOMEPAGE_SECTION_TYPES = [
  "hero",
  "featured_categories",
  "featured_products",
  "best_sellers",
  "new_arrivals",
  "promotions",
] as const;

export type HomepageSectionType = (typeof HOMEPAGE_SECTION_TYPES)[number];

const baseSectionSchema = z.object({
  id: z.string().min(1, "Section ID is required"),
  enabled: z.boolean(),
  position: z.number().int().min(0, "Position must be a non-negative integer"),
});

export const heroSectionSchema = baseSectionSchema.extend({
  type: z.literal("hero"),
  productIds: z.array(z.string().min(1)).max(4, "Hero section allows at most 4 products"),
  categoryIds: z.array(z.string().min(1)).max(4, "Hero section allows at most 4 categories"),
}).superRefine((data, ctx) => {
  const seenP = new Set<string>();
  data.productIds.forEach((pid, idx) => {
    if (seenP.has(pid)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate product ID '${pid}' in hero section`,
        path: ["productIds", idx],
      });
    }
    seenP.add(pid);
  });

  const seenC = new Set<string>();
  data.categoryIds.forEach((cid, idx) => {
    if (seenC.has(cid)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate category ID '${cid}' in hero section`,
        path: ["categoryIds", idx],
      });
    }
    seenC.add(cid);
  });
});

export const featuredCategoriesSectionSchema = baseSectionSchema.extend({
  type: z.literal("featured_categories"),
  categoryIds: z.array(z.string().min(1)).max(12, "Featured categories allows at most 12 categories"),
}).superRefine((data, ctx) => {
  if (data.enabled && data.categoryIds.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Enabled featured categories section must contain at least 1 category",
      path: ["categoryIds"],
    });
  }
  const seen = new Set<string>();
  data.categoryIds.forEach((cid, idx) => {
    if (seen.has(cid)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate category ID '${cid}' in featured categories section`,
        path: ["categoryIds", idx],
      });
    }
    seen.add(cid);
  });
});

export const featuredProductsSectionSchema = baseSectionSchema.extend({
  type: z.literal("featured_products"),
  productIds: z.array(z.string().min(1)).max(24, "Featured products allows at most 24 products"),
}).superRefine((data, ctx) => {
  if (data.enabled && data.productIds.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Enabled featured products section must contain at least 1 product",
      path: ["productIds"],
    });
  }
  const seen = new Set<string>();
  data.productIds.forEach((pid, idx) => {
    if (seen.has(pid)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate product ID '${pid}' in featured products section`,
        path: ["productIds", idx],
      });
    }
    seen.add(pid);
  });
});

export const bestSellersSectionSchema = baseSectionSchema.extend({
  type: z.literal("best_sellers"),
  limit: z.number().int().min(1, "Limit must be at least 1").max(24, "Limit cannot exceed 24").default(8),
});

export const newArrivalsSectionSchema = baseSectionSchema.extend({
  type: z.literal("new_arrivals"),
  limit: z.number().int().min(1, "Limit must be at least 1").max(24, "Limit cannot exceed 24").default(8),
});

export const promotionsSectionSchema = baseSectionSchema.extend({
  type: z.literal("promotions"),
  productIds: z.array(z.string().min(1)).max(24, "Promotions section allows at most 24 products"),
}).superRefine((data, ctx) => {
  if (data.enabled && data.productIds.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Enabled promotions section must contain at least 1 product",
      path: ["productIds"],
    });
  }
  const seen = new Set<string>();
  data.productIds.forEach((pid, idx) => {
    if (seen.has(pid)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate product ID '${pid}' in promotions section`,
        path: ["productIds", idx],
      });
    }
    seen.add(pid);
  });
});

export const homepageSectionConfigSchema = z.discriminatedUnion("type", [
  heroSectionSchema,
  featuredCategoriesSectionSchema,
  featuredProductsSectionSchema,
  bestSellersSectionSchema,
  newArrivalsSectionSchema,
  promotionsSectionSchema,
]);

export type HeroSectionConfig = z.infer<typeof heroSectionSchema>;
export type FeaturedCategoriesSectionConfig = z.infer<typeof featuredCategoriesSectionSchema>;
export type FeaturedProductsSectionConfig = z.infer<typeof featuredProductsSectionSchema>;
export type BestSellersSectionConfig = z.infer<typeof bestSellersSectionSchema>;
export type NewArrivalsSectionConfig = z.infer<typeof newArrivalsSectionSchema>;
export type PromotionsSectionConfig = z.infer<typeof promotionsSectionSchema>;

export type HomepageSectionConfig = z.infer<typeof homepageSectionConfigSchema>;

export const updateHomepageDraftSchema = z.object({
  expectedRevision: z.number().int().min(1, "expectedRevision must be an integer >= 1"),
  sections: z.array(homepageSectionConfigSchema).max(12, "Draft cannot have more than 12 sections"),
}).superRefine((data, ctx) => {
  const seenIds = new Set<string>();
  data.sections.forEach((sec, idx) => {
    if (seenIds.has(sec.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate section ID '${sec.id}'`,
        path: ["sections", idx, "id"],
      });
    }
    seenIds.add(sec.id);

    if (sec.position !== idx) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Section position must match array index (${idx}), but got ${sec.position}`,
        path: ["sections", idx, "position"],
      });
    }
  });
});

export type UpdateHomepageDraftInput = z.infer<typeof updateHomepageDraftSchema>;

export function formatIssuePath(path: (string | number | symbol)[]): string {
  let result = "";
  for (let i = 0; i < path.length; i++) {
    const part = path[i];
    if (typeof part === "number" || (typeof part === "string" && /^\d+$/.test(part))) {
      result += `[${part}]`;
    } else {
      const partStr = String(part);
      result = result ? `${result}.${partStr}` : partStr;
    }
  }
  return result;
}

export function validateUpdateHomepageDraft(input: unknown): {
  success: true;
  data: UpdateHomepageDraftInput;
} | {
  success: false;
  issues: { field: string; message: string }[];
} {
  const parsed = updateHomepageDraftSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      issues: parsed.error.issues.map((issue) => ({
        field: formatIssuePath(issue.path),
        message: issue.message,
      })),
    };
  }
  return { success: true, data: parsed.data };
}
