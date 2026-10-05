import sharp from "sharp";
import { createId } from "@paralleldrive/cuid2";
import path from "node:path";
import fs from "node:fs/promises";
import { db } from "../../db";
import { media } from "../../db/schema";
import { ApiError } from "../../shared/api/errors";

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

export async function processAndSaveMedia(file: File) {
  if (file.size > MAX_FILE_SIZE) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Payload Too Large");
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const detectedMime = await checkMagicBytes(buffer);
  if (!detectedMime || !ALLOWED_MIME_TYPES.includes(detectedMime)) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Unsupported Media Type");
  }

  // Process with sharp to strip metadata and convert/re-encode
  // We'll keep the same format but sharp will naturally strip EXIF
  let processedBuffer: Buffer;
  let extension = "bin";
  
  if (detectedMime === "image/jpeg") {
    processedBuffer = await sharp(buffer).jpeg().toBuffer();
    extension = "jpg";
  } else if (detectedMime === "image/png") {
    processedBuffer = await sharp(buffer).png().toBuffer();
    extension = "png";
  } else if (detectedMime === "image/webp") {
    processedBuffer = await sharp(buffer).webp().toBuffer();
    extension = "webp";
  } else {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Unsupported Media Type");
  }

  const id = createId();
  const filename = `${id}.${extension}`;
  
  // Storage location strategy: "public/uploads"
  const uploadDir = path.join(process.cwd(), "public", "uploads");
  await fs.mkdir(uploadDir, { recursive: true });
  const filePath = path.join(uploadDir, filename);

  await fs.writeFile(filePath, processedBuffer);

  await db.insert(media).values({
    id,
    filename,
    mimeType: detectedMime,
    size: processedBuffer.length,
    status: "active",
  });

  return {
    id,
    url: `/uploads/${filename}`,
  };
}

