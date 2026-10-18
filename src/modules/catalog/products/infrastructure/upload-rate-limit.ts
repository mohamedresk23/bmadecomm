import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { DbContext } from "../../../../db/tx";
import { uploadRateBuckets as buckets } from "../../../../db/schema";

export const UPLOAD_RATE_LIMIT = 20;
export const UPLOAD_RATE_WINDOW_MS = 600_000; // 10 minutes in milliseconds

/**
 * Atomically checks and increments the staff upload attempt counter.
 * Returns 0 if permitted, or the retry-after duration in seconds if rate limited.
 */
export async function throttleStaffUpload(
  db: DbContext,
  staffUserId: string,
  now = new Date()
): Promise<number> {
  const key = createHash("sha256").update(JSON.stringify(["staff_upload", staffUserId])).digest("hex");
  const windowStart = new Date(Math.floor(now.getTime() / UPLOAD_RATE_WINDOW_MS) * UPLOAD_RATE_WINDOW_MS);
  const windowInstant = sql`${windowStart.toISOString()}::timestamptz`;

  const rows = await db
    .insert(buckets)
    .values({ key, windowStart, attempts: 1 })
    .onConflictDoUpdate({
      target: buckets.key,
      set: {
        windowStart: sql`greatest(${buckets.windowStart}, ${windowInstant})`,
        attempts: sql`CASE WHEN ${buckets.windowStart} < ${windowInstant} THEN 1 ELSE ${buckets.attempts} + 1 END`,
      },
      setWhere: sql`${buckets.windowStart} < ${windowInstant} OR ${buckets.attempts} < ${UPLOAD_RATE_LIMIT}`,
    })
    .returning();

  if (rows.length) {
    return 0; // Allowed
  }

  // Rate limited: query the current window start to compute Retry-After
  const [stored] = await db.select({ windowStart: buckets.windowStart }).from(buckets).where(eq(buckets.key, key));
  const elapsedSinceStart = stored ? now.getTime() - stored.windowStart.getTime() : 0;
  const remainingMs = Math.max(0, UPLOAD_RATE_WINDOW_MS - elapsedSinceStart);
  return Math.max(1, Math.ceil(remainingMs / 1000));
}

