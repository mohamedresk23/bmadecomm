import { sql } from "drizzle-orm";
import type { DbContext } from "../../../../db/tx";
import { products } from "../../../../db/schema";
import type { PublicImageDto, PublicProductResolution, PublicVariantDto } from "../contracts/public-product";
import { isValidSlug } from "./slug-service";

export async function resolvePublicProductBySlug(db: DbContext, slug: unknown): Promise<PublicProductResolution> {
  if (!isValidSlug(slug)) return { kind: "not-found" };
  // Direct matches take precedence even when unavailable. The redirect owner,
  // visibility and complete public aggregate share this one statement snapshot.
  const [row] = await db.select({
    id: products.id, name: products.name, description: products.description,
    slug: products.slug, status: products.status,
    metaTitle: products.metaTitle, metaDescription: products.metaDescription,
    variants: sql<PublicVariantDto[]>`coalesce((select jsonb_agg(jsonb_build_object(
      'id', v.id, 'sku', v.sku, 'priceMinor', v.price_minor::text,
      'comparePriceMinor', v.compare_price_minor::text, 'currency', v.currency,
      'currencyScale', v.currency_scale, 'attributes', coalesce((select jsonb_object_agg(a.name, a.value)
        from variant_attributes a where a.variant_id = v.id), '{}'::jsonb)
    ) order by v.sort_order, v.id) from variants v where v.product_id = products.id), '[]'::jsonb)`,
    images: sql<PublicImageDto[]>`coalesce((select jsonb_agg(jsonb_build_object(
      'id', pm.id, 'position', pm.sort_order, 'altText', pm.alt_text
    ) order by pm.sort_order, pm.id) from product_media pm
      where pm.product_id = products.id and pm.removed_at is null), '[]'::jsonb)`,
  }).from(products).where(sql`${products.slug} = ${slug} or ${products.id} = (
    select sr.product_id from slug_redirects sr where sr.source_slug = ${slug}
  )`).orderBy(sql`case when ${products.slug} = ${slug} then 0 else 1 end`).limit(1);
  if (!row || row.status !== "published" || !isValidSlug(row.slug)) return { kind: "not-found" };
  if (row.slug !== slug) return { kind: "redirect", location: `/products/${row.slug}` };
  return { kind: "product", product: {
    id: row.id, name: row.name, description: row.description, slug: row.slug,
    variants: row.variants, images: row.images,
    metaTitle: row.metaTitle?.trim() ? row.metaTitle : row.name,
    metaDescription: row.metaDescription?.trim() ? row.metaDescription : Array.from(row.description ?? "").slice(0, 160).join(""),
  } };
}
