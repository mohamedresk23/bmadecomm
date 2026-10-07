import { and, eq, sql } from 'drizzle-orm';
import type { DbContext } from '../../../db/tx';
import { withTransaction } from '../../../db/tx';
import { staffAuthBuckets } from '../../../db/schema';
import { secretHash } from './staff-crypto';
import { StaffAuthError } from '../contracts/staff-auth';
/** Always called on the root connection, outside identity transactions. Failures cannot roll budgets back. */
export async function consumeStaffBudget(db: DbContext, scope: string, identity: string, maximum: number, windowMs: number) {
  const accepted = await withTransaction(db, async tx => {
    const key = `${scope}:${secretHash(identity)}`;
    await tx.insert(staffAuthBuckets).values({ key, windowStart: new Date(), attempts: 0 }).onConflictDoNothing();
    const [bucket] = await tx.select().from(staffAuthBuckets).where(eq(staffAuthBuckets.key, key)).for('update');
    const [clock] = await tx.select({ now: sql`clock_timestamp()`.mapWith(value => new Date(value)) }).from(staffAuthBuckets).limit(1);
    const expired = clock.now.getTime() - bucket.windowStart.getTime() >= windowMs;
    if (!expired && bucket.attempts >= maximum) return false;
    await tx.update(staffAuthBuckets).set({ attempts: expired ? 1 : bucket.attempts + 1, windowStart: expired ? clock.now : bucket.windowStart }).where(eq(staffAuthBuckets.key, key));
    return expired ? clock.now : bucket.windowStart;
  });
  if (!accepted) throw new StaffAuthError(429);
  return accepted;
}
export async function resetStaffAccountBudget(db: DbContext, scope: string, identity: string) {
  await db.delete(staffAuthBuckets).where(eq(staffAuthBuckets.key, `${scope}:${secretHash(identity)}`));
}
export async function releaseStaffAccountAttempt(db: DbContext, scope: string, identity: string, reservedWindow: Date) {
  await db.update(staffAuthBuckets).set({ attempts: sql`greatest(0, ${staffAuthBuckets.attempts} - 1)` }).where(and(eq(staffAuthBuckets.key, `${scope}:${secretHash(identity)}`), eq(staffAuthBuckets.windowStart, reservedWindow)));
}
