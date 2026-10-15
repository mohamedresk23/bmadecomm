import { and, asc, eq, isNull } from "drizzle-orm";
import { DbContext } from "../../../../db/tx";
import { products, productMedia, media } from "../../../../db/schema";
import { ApiError } from "../../../../shared/api/errors";
import { storage } from "../../../../lib/media/storage";
import { GalleryDto } from "../contracts/gallery";

export async function getGalleryByProductId(db: DbContext, productId: string): Promise<GalleryDto> {
  const [product] = await db.select({
    id: products.id,
    mediaRevision: products.mediaRevision,
  }).from(products).where(eq(products.id, productId));

  if (!product) {
    throw ApiError.notFound("Product not found");
  }

  // Active attachments ordered by sort_order
  const rows = await db.select({
    id: productMedia.id,
    mediaId: productMedia.mediaId,
    sortOrder: productMedia.sortOrder,
    altText: productMedia.altText,
    mimeType: media.mimeType,
    size: media.size,
  })
    .from(productMedia)
    .innerJoin(media, eq(productMedia.mediaId, media.id))
    .where(and(eq(productMedia.productId, productId), isNull(productMedia.removedAt)))
    .orderBy(asc(productMedia.sortOrder), asc(productMedia.createdAt));

  const images = rows.map((row) => ({
    id: row.id,
    mediaId: row.mediaId,
    position: row.sortOrder,
    altText: row.altText,
    mimeType: row.mimeType,
    size: row.size,
    previewUrl: `/api/v1/admin/catalog/products/${encodeURIComponent(productId)}/images/${encodeURIComponent(row.id)}/content`,
  }));

  const primaryImageId = images.length > 0 ? images[0].id : null;

  // Compute blank alt text issues for active attachments
  const publicationIssues = images
    .filter((img) => img.altText.trim() === "")
    .map((img) => ({
      field: `images.${img.id}.altText`,
      message: "Alt text is required before publication",
    }));

  return {
    productId: product.id,
    revision: product.mediaRevision.toString(),
    primaryImageId,
    images,
    variantImages: [], // Handled in E04-03-06
    publicationIssues,
  };
}

export async function getGalleryImageContent(
  db: DbContext,
  productId: string,
  productMediaId: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  const [row] = await db.select({
    id: productMedia.id,
    filename: media.filename,
    mimeType: media.mimeType,
  })
    .from(productMedia)
    .innerJoin(media, eq(productMedia.mediaId, media.id))
    .where(and(
      eq(productMedia.id, productMediaId),
      eq(productMedia.productId, productId),
      isNull(productMedia.removedAt)
    ));

  if (!row) {
    throw ApiError.notFound("Image not found");
  }

  try {
    const buffer = await storage.readPrivate(row.filename);
    return { buffer, mimeType: row.mimeType };
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "ENOENT") {
      throw new ApiError(503, "MEDIA_UNAVAILABLE", "Media storage unavailable");
    }
    throw err;
  }
}

