import { and, eq, sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { DbContext } from "../../../../db/tx";
import { products, slugRedirects } from "../../../../db/schema";
import { ApiError } from "../../../../shared/api/errors";

export const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const MAX_SLUG_LENGTH = 255;
export const MAX_BASE_SLUG_LENGTH = 240;

/** Normalizes a slug by trimming whitespace and converting to lowercase. */
export function normalizeSlug(value: string): string {
  return value.trim().toLowerCase();
}

/** Validates whether a slug matches strict format and length requirements. */
export function isValidSlug(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= MAX_SLUG_LENGTH &&
    SLUG_REGEX.test(value)
  );
}

/**
 * Normalizes input text into a URL-safe kebab-case slug base.
 * Decomposes Unicode diacritics (e.g. é -> e), slices to maxLength,
 * and trims trailing hyphens.
 */
export function slugify(text: string, maxLength = MAX_BASE_SLUG_LENGTH): string {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.slice(0, maxLength).replace(/-+$/, "");
}

/**
 * Derives a base slug from the product name, falling back to product ID or 'product'.
 */
export function deriveBaseSlug(name: string, productId?: string): string {
  const fromName = slugify(name, MAX_BASE_SLUG_LENGTH);
  if (fromName) return fromName;
  if (productId) {
    const fromId = slugify(productId, MAX_BASE_SLUG_LENGTH);
    if (fromId) return fromId;
  }
  return "product";
}

/**
 * Asserts that a slug has valid format and is globally available.
 * A slug cannot collide with any existing product (except self),
 * nor with an active slug_redirects.source_slug belonging to another product.
 */
export async function assertSlugAvailable(
  db: DbContext,
  slug: string,
  productId?: string
): Promise<void> {
  const normalized = normalizeSlug(slug);
  if (!isValidSlug(normalized)) {
    throw ApiError.unprocessableEntity("Validation failed", [
      { field: "slug", message: "Slug must contain only lowercase alphanumeric characters and single hyphens, at most 255 characters" },
    ]);
  }

  // Check collision with products
  const productConflict = await db
    .select({ id: products.id })
    .from(products)
    .where(
      productId
        ? and(eq(products.slug, normalized), sql`${products.id} <> ${productId}`)
        : eq(products.slug, normalized)
    )
    .limit(1);

  if (productConflict.length > 0) {
    throw ApiError.conflict("Slug already in use", [
      { field: "slug", message: "Slug already in use" },
    ]);
  }

  // Check collision with active redirects belonging to other products
  const redirectConflict = await db
    .select({ productId: slugRedirects.productId })
    .from(slugRedirects)
    .where(
      productId
        ? and(eq(slugRedirects.sourceSlug, normalized), sql`${slugRedirects.productId} <> ${productId}`)
        : eq(slugRedirects.sourceSlug, normalized)
    )
    .limit(1);

  if (redirectConflict.length > 0) {
    throw ApiError.conflict("Slug already in use", [
      { field: "slug", message: "Slug already in use" },
    ]);
  }
}

/**
 * Generates a unique slug derived from the product name (or fallback).
 * If a collision occurs against existing products or active redirects,
 * suffixes -1, -2, etc. are appended until an available candidate is found.
 */
export async function generateUniqueSlug(
  db: DbContext,
  name: string,
  productId?: string
): Promise<string> {
  const baseSlug = deriveBaseSlug(name, productId);
  let candidate = baseSlug;
  let suffix = 1;

  while (true) {
    const productConflict = await db
      .select({ id: products.id })
      .from(products)
      .where(
        productId
          ? and(eq(products.slug, candidate), sql`${products.id} <> ${productId}`)
          : eq(products.slug, candidate)
      )
      .limit(1);

    if (productConflict.length === 0) {
      const redirectConflict = await db
        .select({ productId: slugRedirects.productId })
        .from(slugRedirects)
        .where(
          productId
            ? and(eq(slugRedirects.sourceSlug, candidate), sql`${slugRedirects.productId} <> ${productId}`)
            : eq(slugRedirects.sourceSlug, candidate)
        )
        .limit(1);

      if (redirectConflict.length === 0) {
        return candidate;
      }
    }

    candidate = `${baseSlug}-${suffix}`;
    suffix++;
  }
}

/**
 * Manages redirect records when a product's slug changes:
 * 1. Cycle prevention: deletes any redirect where source_slug = newSlug for this product.
 * 2. Chain collapsing: updates existing redirects belonging to this product where target_slug = oldSlug to point to newSlug.
 * 3. New redirect insertion: inserts oldSlug -> newSlug only when productStatus is 'published'.
 * Does nothing if slug has not changed.
 */
export async function handleSlugRedirects(
  tx: DbContext,
  productId: string,
  oldSlug: string,
  newSlug: string,
  productStatus: string
): Promise<void> {
  // If slug has not changed, nothing to manage
  // Never create redirect rows with source_slug == target_slug
  if (oldSlug === newSlug) {
    return;
  }

  // 1. Prevent cycles:
  // If newSlug previously existed as a redirect for this product (e.g. A -> B, now returning B -> A),
  // delete that row so we don't have A -> B and B -> A or self-redirect A -> A.
  await tx
    .delete(slugRedirects)
    .where(
      and(
        eq(slugRedirects.sourceSlug, newSlug),
        eq(slugRedirects.productId, productId)
      )
    );

  // 2. Collapse redirect chains (scoped strictly to this product):
  // If this product had existing redirects pointing to oldSlug (e.g. A -> oldSlug),
  // update them to point directly to newSlug (one-hop direct resolution).
  await tx
    .update(slugRedirects)
    .set({ targetSlug: newSlug })
    .where(
      and(
        eq(slugRedirects.targetSlug, oldSlug),
        eq(slugRedirects.productId, productId)
      )
    );

  // 3. Insert new redirect record only if currently published:
  // When currently published, oldSlug was publicly addressable, so record 301 redirect.
  // When draft, oldSlug was never publicly published, so no new redirect row is added.
  if (productStatus === "published") {
    await tx.insert(slugRedirects).values({
      id: `slr_${createId()}`,
      sourceSlug: oldSlug,
      targetSlug: newSlug,
      productId,
    });
  }
}
