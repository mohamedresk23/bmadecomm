import { eq } from "drizzle-orm";
import type { DbContext } from "../../db/tx";
import { media, productMedia, storeSettings } from "../../db/schema";
import { ApiError } from "../../shared/api/errors";
import { storage, type StorageAdapter, type PublicCopy, type QuarantinedCopy } from "./storage";
import { sameMediaStorageKey } from "./catalog-ownership";

export type CatalogCopyFailureReason = "INVALID_MEDIA_KEY" | "INVALID_PUBLIC_OBJECT" | "QUARANTINE_MISMATCH" | "PUBLIC_COPY_CHANGED" | "PERMISSION_DENIED" | "STORAGE_FULL" | "OBJECT_MISSING" | "IO_FAILURE" | "STORAGE_FAILURE";
export type CatalogCopyResult = { key: string; state: "absent" | "exposed" | "withdrawn" | "conflict" | "failed"; copy?: PublicCopy | QuarantinedCopy; reason?: CatalogCopyFailureReason };

function failureReason(error: unknown): CatalogCopyFailureReason {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  switch (code) {
    case "INVALID_MEDIA_KEY": case "INVALID_PUBLIC_OBJECT": case "QUARANTINE_MISMATCH": case "PUBLIC_COPY_CHANGED": return code;
    case "EACCES": case "EPERM": return "PERMISSION_DENIED";
    case "ENOSPC": case "EDQUOT": return "STORAGE_FULL";
    case "ENOENT": return "OBJECT_MISSING";
    case "EIO": return "IO_FAILURE";
    default: return "STORAGE_FAILURE";
  }
}

/** Includes retained, removed and shared ownership, without status filters. */
export async function reconcileCatalogPublicCopies(db: DbContext, options: { productId?: string; apply?: boolean; adapter?: StorageAdapter; requestId?: string } = {}): Promise<CatalogCopyResult[]> {
  const adapter = options.adapter ?? storage;
  const links = await db.select({ mediaId: productMedia.mediaId, productId: productMedia.productId }).from(productMedia);
  const ownedIds = new Set(links.map(link => link.mediaId));
  const scopedIds = new Set(links.filter(link => !options.productId || link.productId === options.productId).map(link => link.mediaId));
  const records = await db.select({ id: media.id, filename: media.filename }).from(media);
  const keys = [...new Set(records.filter(row => scopedIds.has(row.id)).map(row => row.filename))].sort();
  const logos = await db.select({ mediaId: storeSettings.logoMediaId }).from(storeSettings).where(eq(storeSettings.id, "default"));
  const logoIds = new Set(logos.map(row => row.mediaId));
  const results: CatalogCopyResult[] = [];
  for (const key of keys) {
    try {
      const copy = await adapter.inspectPublic(key);
      if (!copy) { results.push({ key, state: "absent" }); continue; }
      // A legacy alias may be an unrelated public image or the currently selected logo.
      if (records.some(row => sameMediaStorageKey(row.filename, key) && (!ownedIds.has(row.id) || logoIds.has(row.id)))) {
        results.push({ key, state: "conflict", copy }); continue;
      }
      if (!options.apply) { results.push({ key, state: "exposed", copy }); continue; }
      const preserved = await adapter.quarantinePublic(key, { requestId: options.requestId });
      results.push({ key, state: preserved ? "withdrawn" : "absent", ...(preserved ? { copy: preserved } : {}) });
    } catch (error) {
      results.push({ key, state: "failed", reason: failureReason(error) });
    }
  }
  return results;
}

export async function withdrawProductPublicCopies(db: DbContext, productId: string, requestId?: string) {
  const results = await reconcileCatalogPublicCopies(db, { productId, apply: true, requestId });
  if (results.some(result => result.state === "conflict")) throw ApiError.conflict("Catalog public media shares a key with unrelated media or the current logo; separate references before retrying");
  if (results.some(result => result.state === "failed")) throw new ApiError(503, "MEDIA_UNAVAILABLE", "Catalog media withdrawal unavailable; retry required");
}
