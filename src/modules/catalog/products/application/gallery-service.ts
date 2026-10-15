import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { DbContext, withTransaction } from "../../../../db/tx";
import { products, productMedia, media, operationKeys } from "../../../../db/schema";
import { ApiError } from "../../../../shared/api/errors";
import { storage } from "../../../../lib/media/storage";
import { writeAudit } from "../../../../shared/authz/audit";
import { canonicalJson } from "../../../../shared/idempotency/execute";
import { processImage } from "../../../../lib/media/image-process";
import { hasAnimation } from "../../../../lib/media/image-policy";
import { checkMagicBytes, ALLOWED_MIME_TYPES } from "../../../../lib/media/upload";
import { throttleStaffUpload } from "../infrastructure/upload-rate-limit";
import {
  GalleryDto,
  GalleryImageDto,
  UploadImageResponse,
  MAX_ACTIVE_IMAGES,
  MAX_FILE_SIZE,
  IDEMPOTENCY_WINDOW_MS,
} from "../contracts/gallery";

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

export type UploadGalleryImageInput = {
  productId: string;
  staffUserId: string;
  requestId: string;
  idempotencyKey: string;
  file: {
    name: string;
    type: string;
    buffer: Buffer;
  };
  signal?: AbortSignal;
};

export async function uploadGalleryImage(
  db: DbContext,
  input: UploadGalleryImageInput
): Promise<UploadImageResponse> {
  const { productId, staffUserId, requestId, idempotencyKey, file, signal } = input;

  if (file.buffer.byteLength > MAX_FILE_SIZE) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "File exceeds 5 MiB limit");
  }

  // Format validation & magic bytes inspection
  const detectedMime = await checkMagicBytes(file.buffer);
  const extensions: Record<string, RegExp> = {
    "image/jpeg": /\.jpe?g$/i,
    "image/png": /\.png$/i,
    "image/webp": /\.webp$/i,
  };

  if (
    !detectedMime ||
    !ALLOWED_MIME_TYPES.includes(detectedMime) ||
    file.type !== detectedMime ||
    !extensions[detectedMime]?.test(file.name)
  ) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Unsupported Media Type");
  }

  if (hasAnimation(file.buffer, detectedMime)) {
    throw ApiError.unprocessableEntity("Static images required");
  }

  // Compute canonical request footprint based on raw incoming file bytes
  const fileBytesHash = createHash("sha256").update(file.buffer).digest("hex");
  const payload = {
    fileBytesHash,
    filename: file.name,
    mimeType: file.type,
    size: file.buffer.byteLength,
  };
  const payloadHash = createHash("sha256").update(canonicalJson(payload)).digest("hex");

  const actor = `staff:${staffUserId}`;
  const operation = `catalog.product.image.upload:${productId}`;
  const leaseToken = randomUUID();

  // Phase 1: Fast Reservation & Completed Replay Check
  let ownsReservation = false;

  const [existing] = await db
    .select()
    .from(operationKeys)
    .where(
      and(
        eq(operationKeys.actor, actor),
        eq(operationKeys.operation, operation),
        eq(operationKeys.key, idempotencyKey)
      )
    );

  if (existing) {
    if (existing.completedAt) {
      // Key completed: check 24-hour expiry and payload hash match
      if (Date.now() - existing.createdAt.getTime() > IDEMPOTENCY_WINDOW_MS) {
        throw ApiError.conflict("Idempotency key has expired. Use a fresh key.");
      }
      if (existing.payloadHash !== payloadHash) {
        throw ApiError.conflict("Idempotency payload mismatch");
      }
      return existing.result as unknown as UploadImageResponse;
    }

    // Key in progress (completedAt is null)
    const ageMs = Date.now() - existing.createdAt.getTime();
    if (ageMs < 15_000) {
      // Active lease by another worker: wait / poll for completion
      const startPoll = Date.now();
      let completedResult: UploadImageResponse | null = null;
      while (Date.now() - startPoll < 15_000) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const [polled] = await db
          .select()
          .from(operationKeys)
          .where(
            and(
              eq(operationKeys.actor, actor),
              eq(operationKeys.operation, operation),
              eq(operationKeys.key, idempotencyKey)
            )
          );
        if (polled?.completedAt) {
          if (polled.payloadHash !== payloadHash) {
            throw ApiError.conflict("Idempotency payload mismatch");
          }
          completedResult = polled.result as unknown as UploadImageResponse;
          break;
        }
      }
      if (completedResult) {
        return completedResult;
      }
      throw ApiError.conflict("An upload with this idempotency key is already in progress");
    }

    // Stalled lease (>= 15s): reclaim reservation
    const reclaimed = await db
      .update(operationKeys)
      .set({
        id: leaseToken,
        createdAt: sql`clock_timestamp()`,
        payloadHash,
      })
      .where(
        and(
          eq(operationKeys.actor, actor),
          eq(operationKeys.operation, operation),
          eq(operationKeys.key, idempotencyKey),
          isNull(operationKeys.completedAt)
        )
      )
      .returning();

    if (reclaimed.length > 0) {
      ownsReservation = true;
    }
  } else {
    // Insert new reservation
    const inserted = await db
      .insert(operationKeys)
      .values({
        id: leaseToken,
        actor,
        operation,
        key: idempotencyKey,
        payloadHash,
        completedAt: null,
      })
      .onConflictDoNothing()
      .returning();

    if (inserted.length > 0) {
      ownsReservation = true;
    } else {
      // Conflict on concurrent insert: another process just reserved this key!
      // Wait / poll every 250ms (up to 15s) for completion
      const startPoll = Date.now();
      let completedResult: UploadImageResponse | null = null;
      while (Date.now() - startPoll < 15_000) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const [polled] = await db
          .select()
          .from(operationKeys)
          .where(
            and(
              eq(operationKeys.actor, actor),
              eq(operationKeys.operation, operation),
              eq(operationKeys.key, idempotencyKey)
            )
          );
        if (polled?.completedAt) {
          if (polled.payloadHash !== payloadHash) {
            throw ApiError.conflict("Idempotency payload mismatch");
          }
          completedResult = polled.result as unknown as UploadImageResponse;
          break;
        }
      }
      if (completedResult) {
        return completedResult;
      }
      throw ApiError.conflict("An upload with this idempotency key is already in progress");
    }
  }

  if (!ownsReservation) {
    throw ApiError.conflict("Unable to acquire idempotency reservation");
  }

  // Consume rate limit quota for newly owned attempt
  const retryAfter = await throttleStaffUpload(db, staffUserId);
  if (retryAfter > 0) {
    // Release uncompleted reservation so user can retry once rate limit clears
    await db.delete(operationKeys).where(eq(operationKeys.id, leaseToken)).catch(() => {});
    throw new ApiError(429, "RATE_LIMITED", "Too many upload attempts. Please try again later.", [
      { field: "upload", message: `Retry after ${retryAfter} seconds` },
    ]);
  }

  // Phase 2: Off-DB Image Processing (No DB connections held)
  let processedBuffer: Buffer;
  try {
    processedBuffer = await processImage(file.buffer, detectedMime, signal);
  } catch (procErr: unknown) {
    // Delete uncompleted reservation on processing failure
    await db.delete(operationKeys).where(eq(operationKeys.id, leaseToken)).catch(() => {});
    throw procErr;
  }

  // Phase 3: Atomic Persistence Transaction
  const mediaId = createId();
  const extension = detectedMime === "image/jpeg" ? "jpg" : detectedMime.split("/")[1];
  const filename = `${mediaId}.${extension}`;
  let staged = false;

  try {
    return await withTransaction(db, async (tx) => {
      // Step 1: Lock product row FOR UPDATE (Canonical lock order 1)
      const [product] = await tx
        .select({
          id: products.id,
          status: products.status,
          mediaRevision: products.mediaRevision,
        })
        .from(products)
        .where(eq(products.id, productId))
        .for("update");

      if (!product) {
        throw ApiError.notFound("Product not found");
      }
      if (product.status !== "draft") {
        throw ApiError.conflict("Product images can only be uploaded to draft products");
      }

      // Check capacity limit
      const [countRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(productMedia)
        .where(and(eq(productMedia.productId, productId), isNull(productMedia.removedAt)));

      if ((countRow?.count ?? 0) >= MAX_ACTIVE_IMAGES) {
        throw ApiError.unprocessableEntity("Product gallery cannot exceed 10 active images");
      }

      // Step 2: Lock operation_keys row FOR UPDATE (Canonical lock order 2)
      const [lockedKey] = await tx
        .select()
        .from(operationKeys)
        .where(eq(operationKeys.id, leaseToken))
        .for("update");

      if (!lockedKey || lockedKey.completedAt !== null || lockedKey.payloadHash !== payloadHash) {
        throw ApiError.conflict("Idempotency lease lost or payload mismatch");
      }

      // Determine next sort_order
      const [maxSortRow] = await tx
        .select({ maxOrder: sql<number>`coalesce(max(sort_order), -1)::int` })
        .from(productMedia)
        .where(eq(productMedia.productId, productId));
      const nextSortOrder = (maxSortRow?.maxOrder ?? -1) + 1;

      // Save private file to disk
      await storage.savePrivate(filename, processedBuffer);
      staged = true;

      if (signal?.aborted) {
        throw new ApiError(400, "REQUEST_ABORTED", "Request aborted");
      }

      // Insert media record
      await tx.insert(media).values({
        id: mediaId,
        filename,
        mimeType: detectedMime,
        size: processedBuffer.length,
        status: "pending",
      });

      // Insert product_media record
      const productMediaId = createId();
      await tx.insert(productMedia).values({
        id: productMediaId,
        productId,
        mediaId,
        sortOrder: nextSortOrder,
        altText: "",
      });

      // Increment media_revision
      const newRevision = product.mediaRevision + BigInt(1);
      await tx.update(products).set({
        mediaRevision: newRevision,
        updatedAt: sql`clock_timestamp()`,
      }).where(eq(products.id, productId));

      // Write audit event
      await writeAudit(tx, {
        actor: `staff:${staffUserId}`,
        action: "catalog.product.image.attach",
        resource: `product:${productId}`,
        diff: {
          productMediaId,
          mediaId,
          sortOrder: nextSortOrder,
          mediaRevision: newRevision.toString(),
        },
        requestId,
      });

      // Query updated gallery state
      const gallery = await getGalleryByProductId(tx, productId);
      const image: GalleryImageDto = {
        id: productMediaId,
        mediaId,
        position: nextSortOrder,
        altText: "",
        mimeType: detectedMime,
        size: processedBuffer.length,
        previewUrl: `/api/v1/admin/catalog/products/${encodeURIComponent(productId)}/images/${encodeURIComponent(productMediaId)}/content`,
      };

      const responsePayload: UploadImageResponse = {
        success: true,
        image,
        gallery,
      };

      // Mark operation key completed
      await tx
        .update(operationKeys)
        .set({
          result: responsePayload,
          completedAt: sql`clock_timestamp()`,
        })
        .where(eq(operationKeys.id, leaseToken));

      return responsePayload;
    });
  } catch (err: unknown) {
    if (staged) {
      // Immediate compensation cleanup
      try {
        await storage.removePrivate(filename);
      } catch {
        try {
          await storage.recordOrphan(filename);
        } catch {
          console.error("Media recovery required", { key: filename, requestId });
        }
      }
    }
    // Delete uncompleted lease row on failure so staff can retry
    await db
      .delete(operationKeys)
      .where(and(eq(operationKeys.id, leaseToken), isNull(operationKeys.completedAt)))
      .catch(() => {});
    throw err;
  }
}
