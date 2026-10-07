import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { DbContext } from "../../../db/tx";
import { withTransaction } from "../../../db/tx";
import { sessions, staffAccounts, userRoles, users } from "../../../db/schema";
import { staffSessionPolicySchema, staffTokenPattern, type StaffSessionPolicy, type StaffSessionContext } from "../contracts/staff-session";

function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }
function deadline(now: Date, ms: number) {
  const date = new Date(now.getTime() + ms);
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(date.getTime())) throw new Error("Invalid session deadline");
  return date;
}

async function currentRoles(db: DbContext, userId: string): Promise<string[]> {
  const rows = await db.select({ role: userRoles.roleKey }).from(staffAccounts)
    .innerJoin(users, eq(users.id, staffAccounts.userId))
    .innerJoin(userRoles, eq(userRoles.userId, staffAccounts.userId))
    .where(and(eq(staffAccounts.userId, userId), eq(staffAccounts.enabled, true), eq(users.role, "staff"), sql`${staffAccounts.mfaEnrolledAt} is not null`, sql`${staffAccounts.mfaSeed} is not null`));
  return rows.map(row => row.role).sort();
}

/** Internal only: login composition must complete credential and MFA verification first. */
export async function issueStaffSession(db: DbContext, userId: string, policyInput: StaffSessionPolicy, fixtureNow?: Date) {
  const policy = staffSessionPolicySchema.parse(policyInput);
  return withTransaction(db, async tx => {
    await tx.select().from(users).where(eq(users.id, userId)).for('update');
    await tx.select().from(staffAccounts).where(eq(staffAccounts.userId, userId)).for('update');
    if (!(await currentRoles(tx, userId)).length) return null;
    const now = fixtureNow ?? (await tx.select({ now: sql`clock_timestamp()`.mapWith(value => new Date(value)) }).from(staffAccounts).limit(1))[0].now;
    const token = randomBytes(32).toString("base64url");
    const expiresAt = deadline(now, policy.absoluteMs);
    const [session] = await tx.insert(sessions).values({ id: randomUUID(), userId, context: "staff", tokenHash: hashToken(token), createdAt: now, authenticatedAt: now, expiresAt, lastSeenAt: now, idleExpiresAt: deadline(now, policy.idleMs) }).returning();
    return { token, sessionId: session.id, expiresAt };
  });
}

export async function resolveStaffSession(db: DbContext, token: string | null, policyInput: StaffSessionPolicy, fixtureNow?: Date): Promise<StaffSessionContext | null> {
  const policy = staffSessionPolicySchema.parse(policyInput);
  if (!token || !staffTokenPattern.test(token)) return null;
  return withTransaction(db, async tx => {
    const [lookup] = await tx.select({ userId: sessions.userId }).from(sessions).where(and(eq(sessions.tokenHash, hashToken(token)), eq(sessions.context, 'staff')));
    if (!lookup) return null;
    await tx.select().from(users).where(eq(users.id, lookup.userId)).for('update');
    await tx.select().from(staffAccounts).where(eq(staffAccounts.userId, lookup.userId)).for('update');
    // Lock serializes touches/rotation/revocation and prevents expired-session resurrection.
    const [session] = await tx.select().from(sessions).where(and(eq(sessions.tokenHash, hashToken(token)), eq(sessions.context, "staff"), isNull(sessions.revokedAt))).for("update");
    if (!session) return null;
    // Read time after acquiring the lock, since a concurrent request can delay it.
    const now = fixtureNow ?? (await tx.select({ now: sql`clock_timestamp()`.mapWith(value => new Date(value)) }).from(sessions).limit(1))[0].now;
    deadline(now, policy.idleMs);
    if (!session.authenticatedAt || session.expiresAt <= now || session.idleExpiresAt <= now) return null;
    const roles = await currentRoles(tx, session.userId);
    if (!roles.length) return null;
    await tx.update(sessions).set({ lastSeenAt: now, idleExpiresAt: new Date(Math.min(session.expiresAt.getTime(), deadline(now, policy.idleMs).getTime())) }).where(eq(sessions.id, session.id));
    return { sessionId: session.id, userId: session.userId, context: "staff", roles, expiresAt: session.expiresAt, authenticatedAt: session.authenticatedAt };
  });
}

export async function revokeStaffSession(db: DbContext, token: string | null, now = new Date()): Promise<void> {
  if (!token || !staffTokenPattern.test(token)) return;
  await db.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.tokenHash, hashToken(token)), eq(sessions.context, "staff"), isNull(sessions.revokedAt)));
}

export async function rotateStaffSession(db: DbContext, token: string | null, policy: StaffSessionPolicy, fixtureNow?: Date) {
  return withTransaction(db, async tx => {
    const context = await resolveStaffSession(tx, token, policy, fixtureNow);
    if (!context) return null;
    const nextToken = randomBytes(32).toString("base64url");
    await tx.update(sessions).set({ tokenHash: hashToken(nextToken) }).where(eq(sessions.id, context.sessionId));
    // Rotation preserves the original absolute lifetime.
    return { token: nextToken, sessionId: context.sessionId, expiresAt: context.expiresAt };
  });
}
