import { z } from "zod";

export const MAX_MONEY_MINOR = BigInt("9223372036854775807");
export const normalizeSku = (value: string) => value.normalize("NFKC").trim().toUpperCase();
export const normalizeAttribute = (value: string) => value.normalize("NFKC").trim().toLowerCase();
export const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const normalizeSlug = (value: string) => value.trim().toLowerCase();

export function combinationKey(attributes: Record<string, string>): string {
  return JSON.stringify(Object.entries(attributes).map(([name, value]) => [normalizeAttribute(name), normalizeAttribute(value)]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

const money = z.string().max(19).regex(/^(0|[1-9][0-9]*)$/, "Amount must be a nonnegative integer string")
  .refine(value => value.length <= 19 && /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) <= MAX_MONEY_MINOR, "Amount is too large");
const wellFormedUnicode = (value: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const noControls = (value: string) => wellFormedUnicode(value) && !/[\u0000-\u001f\u007f]/.test(value);
const identifier = z.string().min(1).max(80).refine(noControls, "Invalid identifier");
const attribute = z.string().transform(normalizeAttribute).pipe(z.string().min(1).max(60).refine(noControls, "Invalid attribute"));
const attributeName = attribute.refine(value => !value.includes(":") && value !== "__proto__", "Attribute names cannot contain a colon or be __proto__");
const attributeValue = attribute.refine(value => !value.includes(","), "Attribute values cannot contain a comma");
// Inspect raw keys before Zod's record parser can discard __proto__.
const attributes = z.unknown().superRefine((value, ctx) => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const name of Object.keys(value)) if (normalizeAttribute(name) === "__proto__")
      ctx.addIssue({ code: "custom", path: [name], message: "Attribute names cannot contain a colon or be __proto__" });
  }
}).pipe(z.record(z.string(), z.string())).superRefine((value, ctx) => {
  const entries = Object.entries(value);
  if (entries.length > 4) ctx.addIssue({ code: "custom", message: "At most four dimensions are allowed" });
  const names = new Set<string>();
  for (const [name, val] of entries) {
    const normalized = normalizeAttribute(name);
    const parsedName = attributeName.safeParse(name), parsedValue = attributeValue.safeParse(val);
    if (!parsedName.success) for (const issue of parsedName.error.issues) ctx.addIssue({ code: "custom", path: [name], message: issue.message });
    if (!parsedValue.success) for (const issue of parsedValue.error.issues) ctx.addIssue({ code: "custom", path: [name], message: issue.message });
    if (names.has(normalized)) ctx.addIssue({ code: "custom", path: [name], message: "Attribute names and values must be unique, nonempty and at most 60 characters" });
    names.add(normalized);
  }
}).transform(value => Object.fromEntries(Object.entries(value).map(([name, val]) => [normalizeAttribute(name), normalizeAttribute(val)])));

const variantFields = {
  sku: z.string().max(128).transform(normalizeSku).pipe(z.string().regex(/^[A-Z0-9][A-Z0-9._-]{0,63}$/, "SKU must contain 1–64 letters, digits, dots, underscores or hyphens")),
  priceMinor: money,
  comparePriceMinor: money.nullable().optional(),
  attributes: attributes.default({}),
};
const variantSchema = z.object(variantFields).strict();
const editVariantSchema = z.object({ ...variantFields, id: identifier.optional() }).strict();

export const slugSchema = z.string()
  .transform(normalizeSlug)
  .pipe(
    z.string()
      .min(1, "Slug is required")
      .max(255, "Slug cannot exceed 255 characters")
      .regex(SLUG_REGEX, "Slug must contain only lowercase alphanumeric characters and single hyphens")
  );

const metaTitleSchema = z.string()
  .trim()
  .max(70, "Meta title cannot exceed 70 characters")
  .refine(noControls, "Invalid meta title")
  .nullable()
  .optional();

const metaDescriptionSchema = z.string()
  .trim()
  .max(160, "Meta description cannot exceed 160 characters")
  .refine(value => wellFormedUnicode(value) && !value.includes("\u0000"), "Invalid meta description")
  .nullable()
  .optional();

const productFields = {
  name: z.string().trim().min(1, "Name is required").max(200).refine(noControls, "Invalid name"),
  description: z.string().trim().max(5000).refine(value => wellFormedUnicode(value) && !value.includes("\u0000"), "Invalid description").nullable().optional(),
  slug: slugSchema.optional(),
  metaTitle: metaTitleSchema,
  metaDescription: metaDescriptionSchema,
  categoryIds: z.array(identifier).min(1, "Select at least one category").max(50).refine(ids => new Set(ids).size === ids.length, "Category IDs must be unique"),
};

function validateVariants(value: { variants: z.infer<typeof editVariantSchema>[] }, ctx: z.RefinementCtx) {
  const combinations = new Set<string>();
  const dimensions = Object.keys(value.variants[0]?.attributes ?? {}).sort().join("\u0000");
  const ids = new Set<string>();
  value.variants.forEach((variant, index) => {
    const key = combinationKey(variant.attributes);
    if (combinations.has(key)) ctx.addIssue({ code: "custom", path: ["variants", index, "attributes"], message: "Duplicate attribute combination" });
    combinations.add(key);
    if (Object.keys(variant.attributes).sort().join("\u0000") !== dimensions) ctx.addIssue({ code: "custom", path: ["variants", index, "attributes"], message: "All variants must use the same dimensions" });
    if (variant.comparePriceMinor != null && variant.comparePriceMinor.length <= 19 && variant.priceMinor.length <= 19 && /^(0|[1-9][0-9]*)$/.test(variant.comparePriceMinor) && /^(0|[1-9][0-9]*)$/.test(variant.priceMinor) && BigInt(variant.comparePriceMinor) < BigInt(variant.priceMinor)) ctx.addIssue({ code: "custom", path: ["variants", index, "comparePriceMinor"], message: "Compare price must be at least regular price" });
    if (variant.id && ids.has(variant.id)) ctx.addIssue({ code: "custom", path: ["variants", index, "id"], message: "Variant IDs must be unique" });
    if (variant.id) ids.add(variant.id);
  });
}

export const createProductSchema = z.object({ ...productFields, variants: z.array(variantSchema).min(1).max(100) }).strict().superRefine(validateVariants);
export const updateProductSchema = z.object({ ...productFields, variants: z.array(editVariantSchema).min(1).max(100) }).strict().superRefine(validateVariants);
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export type VariantDto = {
  id: string;
  sku: string;
  priceMinor: string;
  comparePriceMinor: string | null;
  currency: string;
  currencyScale: number;
  attributes: Record<string, string>;
};

export type ProductDto = {
  id: string;
  name: string;
  description: string | null;
  slug: string;
  metaTitle: string | null;
  metaDescription: string | null;
  publishedAt: string | null;
  status: string;
  categoryIds: string[];
  variants: VariantDto[];
  createdAt: string;
  updatedAt: string;
};

/** Parse decimal text without ever routing money through a floating-point number. */
export function decimalToMinor(value: string, scale: number): string {
  if (!Number.isInteger(scale) || scale < 0 || scale > 4) throw new Error("Invalid currency scale");
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(value.trim());
  if (!match || match[1].length > 19 || (match[2]?.length ?? 0) > scale) throw new Error(`Enter a nonnegative price with at most ${scale} decimal places`);
  const amount = BigInt(match[1]) * BigInt(10) ** BigInt(scale) + BigInt((match[2] ?? "").padEnd(scale, "0") || "0");
  if (amount > MAX_MONEY_MINOR) throw new Error("Amount is too large");
  return amount.toString();
}

export function minorToDecimal(value: string, scale: number): string {
  const digits = value.padStart(scale + 1, "0");
  return scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

export function generateVariantMatrix(dimensions: { name: string; values: string[] }[]): Record<string, string>[] {
  if (dimensions.length > 4) throw new Error("At most four dimensions are allowed");
  const names = new Set<string>();
  let rows: Record<string, string>[] = [{}];
  for (const dimension of dimensions) {
    const name = attributeName.parse(dimension.name);
    const values = dimension.values.map(value => attributeValue.parse(value));
    if (names.has(name) || !values.length || new Set(values).size !== values.length) throw new Error("Use unique dimensions and values");
    names.add(name);
    if (rows.length * values.length > 100) throw new Error("At most 100 variants are allowed");
    rows = rows.flatMap(row => values.map(value => ({ ...row, [name]: value })));
  }
  return rows;
}
