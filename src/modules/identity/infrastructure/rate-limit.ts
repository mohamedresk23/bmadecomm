import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { eq, sql } from "drizzle-orm";
import type { DbContext } from "../../../db/tx";
import { registrationRateBuckets as buckets } from "../../../db/schema";

export function registrationSource(req: Request, trustedHeader?: string): string {
  const value = trustedHeader ? req.headers.get(trustedHeader) : null;
  if (!value) return "shared-source";
  const version = isIP(value);
  if (version === 6 && !value.includes("%")) return new URL(`http://[${value}]/`).hostname.slice(1, -1);
  return version === 4 ? value : "shared-source";
}

async function take(db: DbContext, scope: string, value: string, limit: number, windowMs: number, now: Date) {
  const key = createHash("sha256").update(JSON.stringify([scope, value])).digest("hex");
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  // Raw SQL parameters bypass the column's Date encoder; postgres-js needs text.
  const windowInstant = sql`${windowStart.toISOString()}::timestamptz`;
  const rows = await db.insert(buckets).values({ key, windowStart, attempts: 1 }).onConflictDoUpdate({
    target: buckets.key,
    set: { windowStart: sql`greatest(${buckets.windowStart}, ${windowInstant})`,
      attempts: sql`CASE WHEN ${buckets.windowStart} < ${windowInstant} THEN 1 ELSE ${buckets.attempts} + 1 END` },
    setWhere: sql`${buckets.windowStart} < ${windowInstant} OR ${buckets.attempts} < ${limit}`,
  }).returning();
  if (rows.length) return 0;
  const [stored] = await db.select({ windowStart: buckets.windowStart }).from(buckets).where(eq(buckets.key, key));
  return Math.max(1, Math.ceil((stored.windowStart.getTime() + windowMs - now.getTime()) / 1000));
}

export async function throttleRegistration(db: DbContext, source: string, email: string, now = new Date()): Promise<number> {
  // Separate committed operations intentionally count accepted source attempts even if email rejects.
  const sourceRetry = await take(db, "source", source, 10, 900000, now);
  if (sourceRetry) return sourceRetry;
  return take(db, "email", email, 3, 3600000, now);
}

export function throttleVerification(db: DbContext, source: string, now = new Date()) {
  return take(db, "verification-source", source, 10, 900000, now);
}
