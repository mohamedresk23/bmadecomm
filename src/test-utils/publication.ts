import type { DbContext } from "../db/tx";
import { categories, media, productCategories, productMedia, products, variants } from "../db/schema";

export async function seedPublication(db: DbContext, id = "publication-p", categoryId?: string) {
  const category = categoryId ?? `${id}-c`;
  await db.insert(products).values({ id, name: "Publishable", description: "Details", slug: id });
  if (!categoryId) await db.insert(categories).values({ id: category, name: "Category", slug: category });
  await db.insert(productCategories).values({ productId: id, categoryId: category });
  await db.insert(variants).values({ id: `${id}-v`, productId: id, sku: `${id}-sku`.toUpperCase(), priceMinor: BigInt(100), currency: "EGP", currencyScale: 2, combinationKey: "", sortOrder: 0 });
  await db.insert(media).values({ id: `${id}-m`, filename: "private.png", mimeType: "image/png", size: 10, status: "pending" });
  await db.insert(productMedia).values({ id: `${id}-i`, productId: id, mediaId: `${id}-m`, altText: "Product image", sortOrder: 0 });
  return id;
}
