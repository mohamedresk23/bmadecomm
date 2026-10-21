import { eq, sql } from "drizzle-orm";
import type { DbContext } from "../../../../db/tx";
import { products } from "../../../../db/schema";
import { ApiError } from "../../../../shared/api/errors";
import type { PublicationReadinessCode, PublicationReadinessDto, PublicationReadinessIssue } from "../contracts/publication-readiness";
import { isValidSlug } from "./slug-service";

export interface PublicationReadinessSnapshot {
  name: string;
  description: string | null;
  slug: string;
  slugConflict: boolean;
  variants: { id: string; sku: string; priceMinor: string | bigint }[];
  /** Active attachments only; historical attachments are excluded by the reader. */
  images: { id: string; altText: string }[];
  hasCategory: boolean;
}

/** Pure evaluation with stable gate order, then lexical attachment/variant ID order. */
export function evaluatePublicationReadiness(snapshot: PublicationReadinessSnapshot): PublicationReadinessDto {
  const issues: PublicationReadinessIssue[] = [];
  const add = (field: string, code: PublicationReadinessCode, message: string) => issues.push({ field, code, message });
  if (!snapshot.name.trim()) add("name", "MISSING_NAME", "Enter a product name.");
  if (!snapshot.description?.trim()) add("description", "MISSING_DESCRIPTION", "Enter a product description.");
  if (!isValidSlug(snapshot.slug)) add("slug", "INVALID_SLUG", "Enter a valid product slug.");
  if (snapshot.slugConflict) add("slug", "SLUG_CONFLICT", "Slug is reserved by another product.");
  if (!snapshot.variants.length) add("variants", "MISSING_VARIANTS", "Add at least one variant.");
  const byId = <T extends { id: string }>(a: T, b: T) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  for (const variant of [...snapshot.variants].sort(byId)) {
    if (!variant.sku.trim()) add(`variants.${variant.id}.sku`, "MISSING_SKU", "Enter a variant SKU.");
    if (BigInt(variant.priceMinor) <= BigInt(0)) add(`variants.${variant.id}.priceMinor`, "INVALID_PRICE", "Variant price must be greater than zero.");
  }
  if (!snapshot.images.length) add("gallery", "MISSING_IMAGES", "Add at least one product image.");
  for (const image of [...snapshot.images].sort(byId)) {
    if (!image.altText.trim()) add(`gallery.${image.id}.altText`, "MISSING_ALT_TEXT", "Enter alternative text for this image.");
  }
  if (!snapshot.hasCategory) add("categoryIds", "MISSING_CATEGORIES", "Associate at least one category.");
  return { isReady: issues.length === 0, issues };
}

/** One SELECT uses one database snapshot and the caller's root or transaction context. */
export async function getPublicationReadiness(db: DbContext, id: string): Promise<PublicationReadinessDto> {
  const [snapshot] = await db.select({
    name: products.name, description: products.description, slug: products.slug,
    slugConflict: sql<boolean>`exists(select 1 from products p where p.slug = "products"."slug" and p.id <> "products"."id") or exists(select 1 from slug_redirects r where r.source_slug = "products"."slug" and r.product_id <> "products"."id")`,
    variants: sql<PublicationReadinessSnapshot["variants"]>`coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'sku', v.sku, 'priceMinor', v.price_minor::text) order by v.id) from variants v where v.product_id = "products"."id"), '[]'::jsonb)`,
    images: sql<PublicationReadinessSnapshot["images"]>`coalesce((select jsonb_agg(jsonb_build_object('id', pm.id, 'altText', pm.alt_text) order by pm.id) from product_media pm where pm.product_id = "products"."id" and pm.removed_at is null), '[]'::jsonb)`,
    hasCategory: sql<boolean>`exists(select 1 from product_categories pc join categories c on c.id = pc.category_id where pc.product_id = "products"."id")`,
  }).from(products).where(eq(products.id, id));
  if (!snapshot) throw ApiError.notFound("Product not found");
  return evaluatePublicationReadiness(snapshot);
}
