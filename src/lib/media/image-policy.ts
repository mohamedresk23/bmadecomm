export const MAX_DIMENSION = 4096;
export const MAX_PIXELS = 8_000_000;

export function validateImageMetadata(metadata: { width?: number; height?: number; pages?: number }) {
  const { width, height, pages } = metadata;
  if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS || (pages ?? 1) !== 1) {
    throw new Error("IMAGE_POLICY");
  }
}

export function hasAnimation(buffer: Buffer, mime: string): boolean {
  if (mime === "image/png") {
    for (let offset = 8; offset + 12 <= buffer.length;) {
      const size = buffer.readUInt32BE(offset);
      const type = buffer.toString("ascii", offset + 4, offset + 8);
      if (type === "acTL" || type === "fcTL") return true;
      offset += size + 12;
    }
  }
  if (mime === "image/webp") {
    for (let offset = 12; offset + 8 <= buffer.length;) {
      const type = buffer.toString("ascii", offset, offset + 4);
      const size = buffer.readUInt32LE(offset + 4);
      if (type === "ANIM" || type === "ANMF" || (type === "VP8X" && size > 0 && (buffer[offset + 8] & 2))) return true;
      offset += 8 + size + (size % 2);
    }
  }
  return false;
}
