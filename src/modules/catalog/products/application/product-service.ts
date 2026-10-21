import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { DbContext, withTransaction } from "../../../../db/tx";
import { categories, products, variants, variantAttributes, productCategories, storeSettings, productMedia, variantMedia } from "../../../../db/schema";
import { ApiError } from "../../../../shared/api/errors";
import { writeAudit } from "../../../../shared/authz/audit";
import { combinationKey, createProductSchema, updateProductSchema, CreateProductInput, UpdateProductInput, ProductDto, VariantDto } from "../contracts/product";
import { assertSlugAvailable, generateUniqueSlug, handleSlugRedirects } from "./slug-service";

// One statement supplies the whole aggregate from one PostgreSQL snapshot.
async function selectAggregates(db: DbContext, publishedOnly: boolean, id?: string): Promise<ProductDto[]> {
  const rows = await db.select({ product: products,
    categoryIds: sql<string[]>`coalesce((select jsonb_agg(pc.category_id order by pc.category_id) from product_categories pc where pc.product_id = "products"."id"), '[]'::jsonb)`,
    variantRows: sql<VariantDto[]>`coalesce((select jsonb_agg(jsonb_build_object(
      'id', v.id, 'sku', v.sku, 'priceMinor', v.price_minor::text, 'comparePriceMinor', v.compare_price_minor::text,
      'currency', v.currency, 'currencyScale', v.currency_scale,
      'attributes', coalesce((select jsonb_object_agg(a.name, a.value) from variant_attributes a where a.variant_id = v.id), '{}'::jsonb)
      ) order by v.sort_order) from variants v where v.product_id = "products"."id"), '[]'::jsonb)` })
    .from(products)
    .where(and(id ? eq(products.id, id) : undefined, publishedOnly ? eq(products.status, "published") : id ? undefined : inArray(products.status, ["draft", "published"])))
    .orderBy(asc(products.createdAt), asc(products.id));
  return rows.map(({ product, categoryIds, variantRows }) => {
    const { mediaRevision: _mediaRevision, ...rest } = product;
    void _mediaRevision;
    return {
      ...rest,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
      publishedAt: product.publishedAt ? product.publishedAt.toISOString() : null,
      categoryIds,
      variants: variantRows,
    };
  });
}
export async function getProductById(db: DbContext, id: string, publishedOnly = false): Promise<ProductDto> {
  const [product] = await selectAggregates(db, publishedOnly, id);
  if (!product) throw ApiError.notFound("Product not found");
  return product;
}
export function listProducts(db: DbContext, publishedOnly = false): Promise<ProductDto[]> {
  return selectAggregates(db, publishedOnly);
}
export const pricingRevision = (currency: string, scale: number) => `${currency}:${scale}`;
export async function getProductFormMetadata(db: DbContext) {
  const [settings] = await db.select().from(storeSettings).where(eq(storeSettings.id, "default"));
  if (!settings) throw ApiError.notFound("Store settings not found");
  const categoryRows = await db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.name));
  const categoryById = new Map(categoryRows.map(category => [category.id, category]));
  function categoryPath(id: string, seen = new Set<string>()): string {
    const category = categoryById.get(id);
    if (!category || seen.has(id)) return "";
    seen.add(id);
    return category.parentId ? `${categoryPath(category.parentId, seen)} / ${category.name}` : category.name;
  }
  return {
    currency: settings.currency, currencyScale: settings.currencyExponent,
    pricingRevision: pricingRevision(settings.currency, settings.currencyExponent),
    categories: categoryRows.map(category => ({ id: category.id, name: categoryPath(category.id) })),
  };
}

function parseInput(input: CreateProductInput | UpdateProductInput, editing: boolean): UpdateProductInput {
  const parsed = (editing ? updateProductSchema : createProductSchema).safeParse(input);
  if (!parsed.success) throw ApiError.unprocessableEntity("Validation failed", parsed.error.issues.map(issue => ({ field: issue.path.join("."), message: issue.message })));
  const seen = new Set<string>();
  parsed.data.variants.forEach((variant, index) => {
    if (seen.has(variant.sku)) throw ApiError.conflict("SKU already in use", [{ field: `variants.${index}.sku`, message: "SKU already in use" }]);
    seen.add(variant.sku);
  });
  return parsed.data;
}
function databaseError(error: unknown): { code?: string; constraint?: string; cause?: unknown } {
  if (!error || typeof error !== "object") return {};
  return error as { code?: string; constraint?: string; cause?: unknown };
}
async function saveProduct(db: DbContext, input: CreateProductInput | UpdateProductInput, actorId: string, requestId?: string, id?: string, expectedPricingRevision?: string): Promise<ProductDto> {
  const parsed = parseInput(input, !!id);
  try {
    return await withTransaction(db, async tx => {
      let before: ProductDto | undefined;
      let previousMediaRevision = BigInt(0);
      let existingStatus = "draft";
      let existingSlug = "";
      let existingMetaTitle: string | null = null;
      let existingMetaDescription: string | null = null;

      if (id) {
        const [existing] = await tx.select().from(products).where(eq(products.id, id)).for("update");
        if (!existing) throw ApiError.notFound("Product not found");
        if (existing.status === "archived") throw ApiError.conflict("Archived products cannot be edited");
        existingStatus = existing.status;
        existingSlug = existing.slug;
        existingMetaTitle = existing.metaTitle;
        existingMetaDescription = existing.metaDescription;
        previousMediaRevision = existing.mediaRevision;
        before = await getProductById(tx, id);
      }
      const [settings] = await tx.select().from(storeSettings).where(eq(storeSettings.id, "default")).for("share");
      if (!settings) throw ApiError.notFound("Store settings not found");
      if (expectedPricingRevision !== undefined && expectedPricingRevision !== pricingRevision(settings.currency, settings.currencyExponent))
        throw ApiError.conflict("Pricing context changed. Refresh settings and review prices before saving.", [{ field: "pricingRevision", message: "Review prices using the current store currency and scale" }]);
      // Locks prevent category removal between validation and association insertion.
      const found = await tx.select({ id: categories.id }).from(categories).where(inArray(categories.id, parsed.categoryIds)).for("key share");
      if (found.length !== parsed.categoryIds.length) throw ApiError.unprocessableEntity("Unknown category", [{ field: "categoryIds", message: "Select existing categories" }]);
      const retainedIds = new Set(before?.variants.map(variant => variant.id) ?? []);
      parsed.variants.forEach((variant, index) => {
        if (variant.id && !retainedIds.has(variant.id)) throw ApiError.unprocessableEntity("Invalid variant ID", [{ field: `variants.${index}.id`, message: "Variant does not belong to this draft" }]);
      });
      const conflicts = await tx.select({ sku: variants.sku, productId: variants.productId }).from(variants).where(inArray(variants.sku, parsed.variants.map(variant => variant.sku)));
      parsed.variants.forEach((variant, index) => {
        if (conflicts.some(conflict => conflict.sku === variant.sku && conflict.productId !== id)) throw ApiError.conflict("SKU already in use", [{ field: `variants.${index}.sku`, message: "SKU already in use" }]);
      });

      const productId = id ?? `prd_${createId()}`;
      let finalSlug = existingSlug;
      let slugChanged = false;

      if (id) {
        if (parsed.slug && parsed.slug !== existingSlug) {
          await assertSlugAvailable(tx, parsed.slug, id);
          finalSlug = parsed.slug;
          slugChanged = true;
        }
      } else {
        if (parsed.slug) {
          await assertSlugAvailable(tx, parsed.slug, productId);
          finalSlug = parsed.slug;
        } else {
          finalSlug = await generateUniqueSlug(tx, parsed.name, productId);
        }
      }

      if (id && slugChanged) {
        await handleSlugRedirects(tx, id, existingSlug, finalSlug, existingStatus);
      }

      const mappings = id ? await tx.select().from(variantMedia).where(eq(variantMedia.productId, id)) : [];
      const activeAttachments = id ? await tx.select({ id: productMedia.id }).from(productMedia).where(and(eq(productMedia.productId, id), isNull(productMedia.removedAt))).orderBy(asc(productMedia.id)).for("update") : [];
      const keptMappings = mappings.filter(mapping => parsed.variants.some(variant => variant.id === mapping.variantId) && activeAttachments.some(image => image.id === mapping.productMediaId));
      if (id) {
        await tx.delete(variantMedia).where(eq(variantMedia.productId, id));
        await tx.update(products).set({
          name: parsed.name,
          description: parsed.description || null,
          slug: finalSlug,
          metaTitle: parsed.metaTitle !== undefined ? (parsed.metaTitle || null) : existingMetaTitle,
          metaDescription: parsed.metaDescription !== undefined ? (parsed.metaDescription || null) : existingMetaDescription,
          updatedAt: new Date(),
        }).where(eq(products.id, id));
        // Replacement allows simultaneous SKU/combination swaps while retaining IDs.
        await tx.delete(variants).where(eq(variants.productId, id));
        await tx.delete(productCategories).where(eq(productCategories.productId, id));
      } else {
        await tx.insert(products).values({
          id: productId,
          name: parsed.name,
          description: parsed.description || null,
          slug: finalSlug,
          metaTitle: parsed.metaTitle || null,
          metaDescription: parsed.metaDescription || null,
        });
      }
      await tx.insert(productCategories).values(parsed.categoryIds.map(categoryId => ({ productId, categoryId })));
      for (const [index, variant] of parsed.variants.entries()) {
        const variantId = variant.id ?? `var_${createId()}`;
        await tx.insert(variants).values({
          id: variantId, productId, sku: variant.sku, combinationKey: combinationKey(variant.attributes),
          priceMinor: BigInt(variant.priceMinor), comparePriceMinor: variant.comparePriceMinor == null ? null : BigInt(variant.comparePriceMinor),
          currency: settings.currency, currencyScale: settings.currencyExponent, sortOrder: index,
        });
        const attrs = Object.entries(variant.attributes).map(([name, value]) => ({ variantId, name, value }));
        if (attrs.length) await tx.insert(variantAttributes).values(attrs);
      }
      if (keptMappings.length) await tx.insert(variantMedia).values(keptMappings);
      const clearedMappings = mappings.filter(mapping => !keptMappings.includes(mapping));
      if (clearedMappings.length) await tx.update(products).set({ mediaRevision: sql`${products.mediaRevision} + 1` }).where(eq(products.id, productId));
      const after = await getProductById(tx, productId);

      if (id && slugChanged) {
        await writeAudit(tx, {
          actor: actorId.startsWith("staff:") ? actorId : `staff:${actorId}`,
          action: "catalog.product.slug_update",
          resource: `product:${productId}`,
          diff: {
            oldSlug: existingSlug,
            newSlug: finalSlug,
            status: existingStatus,
          },
          requestId,
        });
      }

      await writeAudit(tx, {
        actor: actorId.startsWith("staff:") ? actorId : `staff:${actorId}`,
        action: id ? "product.updated" : "product.created", resource: `product:${productId}`,
        diff: { ...(before ? { before } : {}), after, ...(clearedMappings.length ? { previousMediaRevision: previousMediaRevision.toString(), mediaRevision: (previousMediaRevision + BigInt(1)).toString(), clearedVariantImages: clearedMappings.map(mapping => ({ variantId: mapping.variantId, imageId: mapping.productMediaId })) } : {}) }, requestId,
      });
      return after;
    });
  } catch (error) {
    // Translate constraint errors only after the transaction/savepoint rolled back.
    let detail = databaseError(error);
    if (!detail.code && detail.cause) detail = databaseError(detail.cause);
    if (detail.code === "23505") {
      if (detail.constraint?.includes("combination")) throw ApiError.unprocessableEntity("Duplicate attribute combination", [{ field: "variants", message: "Duplicate attribute combination" }]);
      if (detail.constraint?.includes("slug")) throw ApiError.conflict("Slug already in use", [{ field: "slug", message: "Slug already in use" }]);
      throw ApiError.conflict("SKU already in use", parsed.variants.map((_, index) => ({ field: `variants.${index}.sku`, message: "SKU already in use" })));
    }
    if (detail.code === "23514") {
      if (detail.constraint?.includes("slug")) throw ApiError.unprocessableEntity("Invalid slug format", [{ field: "slug", message: "Invalid slug format" }]);
      if (detail.constraint?.includes("meta_title")) throw ApiError.unprocessableEntity("Invalid meta title", [{ field: "metaTitle", message: "Meta title cannot exceed 70 characters" }]);
      if (detail.constraint?.includes("meta_description")) throw ApiError.unprocessableEntity("Invalid meta description", [{ field: "metaDescription", message: "Meta description cannot exceed 160 characters" }]);
    }
    throw error;
  }
}
export function createProduct(db: DbContext, input: CreateProductInput, actorId: string, requestId?: string, expectedPricingRevision?: string) {
  return saveProduct(db, input, actorId, requestId, undefined, expectedPricingRevision);
}
export function updateProduct(db: DbContext, id: string, input: UpdateProductInput, actorId: string, requestId?: string, expectedPricingRevision?: string) {
  return saveProduct(db, input, actorId, requestId, id, expectedPricingRevision);
}
