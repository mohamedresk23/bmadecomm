import { processImage } from "./image-process";
import { hasAnimation } from "./image-policy";
import { createId } from "@paralleldrive/cuid2";
import { db } from "../../db";
import { media } from "../../db/schema";
import { ApiError } from "../../shared/api/errors";
import { storage } from "./storage";
import { eq } from "drizzle-orm";

export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
export const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function checkMagicBytes(buffer: Buffer): Promise<string | null> {
  if (buffer.length < 4) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  // WebP: RIFF ... WEBP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

export async function processAndSaveMedia(file: Pick<File, "name" | "size" | "type" | "arrayBuffer">, signal?: AbortSignal) {
  if (file.size > MAX_FILE_SIZE) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Payload Too Large");
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const detectedMime = await checkMagicBytes(buffer);
  const extensions: Record<string, RegExp> = { "image/jpeg": /\.jpe?g$/i, "image/png": /\.png$/i, "image/webp": /\.webp$/i };
  if (!detectedMime || !ALLOWED_MIME_TYPES.includes(detectedMime) || file.type !== detectedMime || !extensions[detectedMime].test(file.name)) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Unsupported Media Type");
  }

  if (hasAnimation(buffer, detectedMime)) throw ApiError.unprocessableEntity("Static images required");
  const processedBuffer = await processImage(buffer, detectedMime, signal);
  const extension = detectedMime === "image/jpeg" ? "jpg" : detectedMime.split("/")[1];

  const id = createId();
  const filename = `${id}.${extension}`;
  
  let staged = false;
  try {
    await storage.savePrivate(filename, processedBuffer);
    staged = true;
    if (signal?.aborted) throw new ApiError(400, "REQUEST_ABORTED", "Request aborted");
    await db.insert(media).values({
    id,
    filename,
    mimeType: detectedMime,
    size: processedBuffer.length,
    status: "pending",
    });
  } catch (error) {
    try { if (staged) await storage.removePrivate(filename); }
    catch { try { await storage.recordOrphan(filename); } catch { console.error("Media recovery required", { key: filename }); } }
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "MEDIA_UNAVAILABLE", "Media storage unavailable");
  }

  return {
    id,
    status: "pending",
  };
}

export async function publishMedia(id: string) {
  const records = await db.select().from(media).where(eq(media.id, id));
  if (records.length === 0) {
    throw new ApiError(404, "NOT_FOUND", "Media not found");
  }

  const record = records[0];
  if (record.status === "active") {
    return { id: record.id, url: `/uploads/${record.filename}` };
  }

  let url: string;
  try { url = await storage.publish(record.filename); }
  catch { throw new ApiError(503, "MEDIA_UNAVAILABLE", "Media storage unavailable"); }

  try { await db.update(media)
    .set({ status: "active" })
    .where(eq(media.id, id)); }
  catch {
    try { await storage.removePublic(record.filename); }
    catch { try { await storage.recordOrphan(record.filename, "public"); } catch { console.error("Media recovery required", { key: record.filename, location: "public" }); } }
    throw new ApiError(503, "MEDIA_UNAVAILABLE", "Media storage unavailable");
  }

  return {
    id: record.id,
    url,
  };
}

