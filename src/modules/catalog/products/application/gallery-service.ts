import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { DbContext, TransactionContext, withTransaction } from "../../../../db/tx";
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
  UpdateGalleryDto,
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

  if (!productId.trim() || /[\x00-\x1f\x7f]/.test(productId) || !idempotencyKey.trim() || /[\x00-\x1f\x7f]/.test(idempotencyKey) || Buffer.byteLength(idempotencyKey) > 128) throw ApiError.badRequest("Valid product and idempotency key required");

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
  let leaseToken = "";

  const scope = and(eq(operationKeys.actor, actor), eq(operationKeys.operation, operation), eq(operationKeys.key, idempotencyKey));
  const releaseReservation = () => db.delete(operationKeys).where(and(scope, eq(operationKeys.id, leaseToken), isNull(operationKeys.completedAt))).catch(() => {});
  const boundedLeaseTransaction = <T>(work: (tx: TransactionContext) => Promise<T>) => withTransaction(db, async tx => {
    await tx.execute(sql`SET LOCAL lock_timeout = '1000ms'`);
    await tx.execute(sql`SET LOCAL statement_timeout = '2000ms'`);
    return work(tx);
  });
  const freshLease = () => `${randomUUID()}:${Date.now()}`;
  const deadline = Date.now() + 15_000;
  while (true) {
    if (signal?.aborted) throw new ApiError(400, "REQUEST_ABORTED", "Request aborted");
    const [existing] = await db.select().from(operationKeys).where(scope);
    if (existing) {
      if (Date.now() - existing.createdAt.getTime() > IDEMPOTENCY_WINDOW_MS) throw ApiError.conflict("Idempotency key has expired. Use a fresh key.");
      if (existing.payloadHash !== payloadHash) throw ApiError.conflict("Idempotency payload mismatch");
      if (existing.completedAt) {
        const [product] = await db.select({ status: products.status }).from(products).where(eq(products.id, productId));
        if (!product) throw ApiError.notFound("Product not found");
        if (product.status !== "draft") throw ApiError.conflict("Product images can only be uploaded to draft products");
        return existing.result as unknown as UploadImageResponse;
      }
      if (Date.now() - (Number(existing.id.split(":")[1]) || existing.createdAt.getTime()) >= 15_000) {
        const claimed = await boundedLeaseTransaction(async tx => {
          const [locked] = await tx.select().from(operationKeys).where(scope).for("update");
          if (!locked || locked.id !== existing.id || locked.completedAt) return null;
          if (Date.now() - locked.createdAt.getTime() > IDEMPOTENCY_WINDOW_MS) throw ApiError.conflict("Idempotency key has expired. Use a fresh key.");
          if (locked.payloadHash !== payloadHash) throw ApiError.conflict("Idempotency payload mismatch");
          const token = freshLease();
          await tx.update(operationKeys).set({ id: token }).where(and(scope, eq(operationKeys.id, existing.id), isNull(operationKeys.completedAt)));
          return token;
        }).catch(error => { if (error instanceof ApiError) throw error; throw new ApiError(503, "SERVER_BUSY", "Upload reservation is busy; retry with the same key"); });
        if (claimed) { leaseToken = claimed; break; }
      }
    } else {
      const inserted = await boundedLeaseTransaction(async tx => {
        const candidate = freshLease();
        const rows = await tx.insert(operationKeys).values({ id: candidate, actor, operation, key: idempotencyKey, payloadHash, completedAt: null }).onConflictDoNothing().returning();
        if (!rows.length) return null;
        // A unique-index wait may have elapsed before INSERT returned.
        const token = freshLease();
        await tx.update(operationKeys).set({ id: token }).where(eq(operationKeys.id, candidate));
        return token;
      }).catch(error => { if (error instanceof ApiError) throw error; throw new ApiError(503, "SERVER_BUSY", "Upload reservation is busy; retry with the same key"); });
      if (inserted) { leaseToken = inserted; break; }
      if (Date.now() >= deadline) throw ApiError.conflict("Unable to acquire idempotency reservation");
      continue;
    }
    if (Date.now() >= deadline) throw ApiError.conflict("An upload with this idempotency key is already in progress");
    await new Promise<void>((resolve, reject) => {
      const done = () => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); resolve(); };
      const cancel = () => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); reject(new ApiError(400, "REQUEST_ABORTED", "Request aborted")); };
      const timer = setTimeout(done, 100);
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) cancel();
    });
  }

  // Consume rate limit quota for newly owned attempt
  let retryAfter: number;
  try { retryAfter = await throttleStaffUpload(db, staffUserId); }
  catch (error) { await releaseReservation(); throw error; }
  if (retryAfter > 0) {
    // Release uncompleted reservation so user can retry once rate limit clears
    await releaseReservation();
    throw new ApiError(429, "RATE_LIMITED", "Too many upload attempts. Please try again later.", [
      { field: "upload", message: `Retry after ${retryAfter} seconds` },
    ]);
  }

  // Renew only our incomplete lease while waiting for a worker or decoding.
  // One renewal runs at a time, and persistence waits for the final renewal.
  const processing = new AbortController();
  const abortProcessing = () => processing.abort();
  signal?.addEventListener("abort", abortProcessing, { once: true });
  if (signal?.aborted) processing.abort();
  let renewing = true;
  let renewalFailure: unknown;
  let renewal: Promise<void> = Promise.resolve();
  let renewalTimer: ReturnType<typeof setTimeout>;
  const renew = () => {
    renewal = boundedLeaseTransaction(async tx => {
      const previous = leaseToken;
      const [locked] = await tx.select().from(operationKeys).where(scope).for("update");
      if (!locked || locked.id !== previous || locked.completedAt) throw ApiError.conflict("Idempotency lease lost");
      const token = freshLease();
      await tx.update(operationKeys).set({ id: token }).where(and(scope, eq(operationKeys.id, previous), isNull(operationKeys.completedAt)));
      return token;
    }).then(token => { leaseToken = token; }).catch(error => { renewalFailure = error; processing.abort(); }).finally(() => {
      if (renewing && !renewalFailure) renewalTimer = setTimeout(renew, 4000);
    });
  };
  renewalTimer = setTimeout(renew, 4000);
  let processedBuffer: Buffer;
  try {
    processedBuffer = await processImage(file.buffer, detectedMime, processing.signal);
  } catch (error) {
    renewing = false; clearTimeout(renewalTimer); await renewal;
    await releaseReservation();
    throw renewalFailure ?? error;
  } finally {
    renewing = false; clearTimeout(renewalTimer); await renewal;
    signal?.removeEventListener("abort", abortProcessing);
  }
  if (renewalFailure) { await releaseReservation(); throw renewalFailure; }

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
        .where(scope)
        .for("update");

      if (!lockedKey || lockedKey.id !== leaseToken || lockedKey.completedAt !== null || lockedKey.payloadHash !== payloadHash) {
        throw ApiError.conflict("Idempotency lease lost or payload mismatch");
      }

      // Determine next sort_order
      const [maxSortRow] = await tx
        .select({ maxOrder: sql<number>`coalesce(max(sort_order), -1)::int` })
        .from(productMedia)
        .where(and(eq(productMedia.productId, productId), isNull(productMedia.removedAt)));
      const nextSortOrder = (maxSortRow?.maxOrder ?? -1) + 1;

      // Save private file to disk
      try { await storage.savePrivate(filename, processedBuffer, { requestId }); }
      catch { throw new ApiError(503, "MEDIA_UNAVAILABLE", "Media storage unavailable"); }
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
      let committed: UploadImageResponse | null;
      try {
        committed = await boundedLeaseTransaction(async (tx) => {
          const [key] = await tx.select().from(operationKeys).where(scope).for("update");
          const [ownedMedia] = await tx.select({ id: media.id }).from(media).innerJoin(productMedia, eq(productMedia.mediaId, media.id)).where(and(eq(media.id, mediaId), eq(media.filename, filename), eq(productMedia.productId, productId)));
          if (key?.completedAt && key.id === leaseToken && ownedMedia) return key.result as unknown as UploadImageResponse;
          if (ownedMedia) throw new Error("Committed media requires recovery");
          return null;
        });
      } catch {
        console.error("Media commit resolution required", { requestId, filename, leaseToken, productId });
        throw new ApiError(503, "MEDIA_UNAVAILABLE", "Upload outcome unavailable; retry with the same key");
      }
      if (committed) return committed;
      try { await storage.removePrivate(filename); }
      catch {
        try { await storage.recordOrphan(filename, "private", { requestId }); }
        catch { console.error("Media recovery required", { key: filename, requestId }); }
      }
    }
    await releaseReservation();
    throw err;
  }
}

export type UpdateGalleryInput = {
  productId: string;
  staffUserId: string;
  requestId: string;
  payload: UpdateGalleryDto;
};

export async function updateGallery(
  db: DbContext,
  input: UpdateGalleryInput
): Promise<GalleryDto> {
  const { productId, staffUserId, requestId, payload } = input;

  if (!productId.trim() || /[\x00-\x1f\x7f]/.test(productId)) {
    throw ApiError.badRequest("Valid product id required");
  }

  return await withTransaction(db, async (tx) => {
    // 1. Lock product row FOR UPDATE
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
      throw ApiError.conflict("Only drafts can be edited");
    }

    if (product.mediaRevision.toString() !== payload.expectedRevision) {
      throw new ApiError(409, "STALE_GALLERY", "Gallery has been modified by another operation. Please reload.");
    }

    // 2. Lock active product_media rows in stable id ASC order FOR UPDATE
    const lockedMediaRows = await tx
      .select({
        id: productMedia.id,
        sortOrder: productMedia.sortOrder,
        altText: productMedia.altText,
        createdAt: productMedia.createdAt,
      })
      .from(productMedia)
      .where(and(eq(productMedia.productId, productId), isNull(productMedia.removedAt)))
      .orderBy(asc(productMedia.id))
      .for("update");

    // Order active rows by sortOrder, createdAt to match presentation order
    const activeRows = [...lockedMediaRows].sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    // 3. Strict full membership validation
    const submittedIds = payload.images.map((img) => img.id);
    const uniqueSubmittedIds = new Set(submittedIds);
    if (uniqueSubmittedIds.size !== submittedIds.length) {
      throw ApiError.unprocessableEntity("Duplicate image IDs in gallery update");
    }

    if (payload.images.length !== activeRows.length) {
      throw ApiError.unprocessableEntity("Gallery images list must contain every active image exactly once");
    }

    const activeIdSet = new Set(activeRows.map((row) => row.id));
    for (const id of submittedIds) {
      if (!activeIdSet.has(id)) {
        throw ApiError.unprocessableEntity("Unknown or foreign image ID in gallery update");
      }
    }

    // 4. No-Op detection:
    // If order and trimmed alt text are identical to active rows
    let isNoOp = true;
    for (let i = 0; i < activeRows.length; i++) {
      const submitted = payload.images[i];
      const active = activeRows[i];
      if (submitted.id !== active.id || submitted.altText.trim() !== active.altText) {
        isNoOp = false;
        break;
      }
    }

    if (isNoOp) {
      return await getGalleryByProductId(tx, productId);
    }

    // 5. Apply changes
    const orderChanged = payload.images.some((img, idx) => img.id !== activeRows[idx].id);

    if (orderChanged) {
      // Step 1: assign temporary non-colliding positions to avoid partial unique constraint collisions
      for (let i = 0; i < payload.images.length; i++) {
        await tx
          .update(productMedia)
          .set({ sortOrder: 10000 + i })
          .where(eq(productMedia.id, payload.images[i].id));
      }
      // Step 2: assign final sortOrder and updated altText
      for (let i = 0; i < payload.images.length; i++) {
        const item = payload.images[i];
        await tx
          .update(productMedia)
          .set({
            sortOrder: i,
            altText: item.altText.trim(),
            updatedAt: sql`clock_timestamp()`,
          })
          .where(eq(productMedia.id, item.id));
      }
    } else {
      // Order is unchanged; update altText where changed
      for (let i = 0; i < payload.images.length; i++) {
        const item = payload.images[i];
        const trimmed = item.altText.trim();
        if (trimmed !== activeRows[i].altText) {
          await tx
            .update(productMedia)
            .set({
              altText: trimmed,
              updatedAt: sql`clock_timestamp()`,
            })
            .where(eq(productMedia.id, item.id));
        }
      }
    }

    // 6. Increment media_revision
    const newRevision = product.mediaRevision + BigInt(1);
    await tx
      .update(products)
      .set({
        mediaRevision: newRevision,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(eq(products.id, productId));

    // 7. Write audit entry
    await writeAudit(tx, {
      actor: `staff:${staffUserId}`,
      action: "catalog.product.gallery.update",
      resource: `product:${productId}`,
      diff: {
        mediaRevision: newRevision.toString(),
        previousRevision: product.mediaRevision.toString(),
        nextRevision: newRevision.toString(),
        before: activeRows.map((row) => ({
          id: row.id,
          position: row.sortOrder,
          altText: row.altText,
        })),
        after: payload.images.map((img, idx) => ({
          id: img.id,
          position: idx,
          altText: img.altText.trim(),
        })),
      },
      requestId,
    });

    // 8. Return updated gallery
    return await getGalleryByProductId(tx, productId);
  });
}

