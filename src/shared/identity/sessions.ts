import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { sessions } from "../../db/schema";
import { type DbContext, withTransaction } from "../../db/tx";
import { generateToken, hashToken } from "./tokens";

export type SessionScope = "admin" | "customer";
const now = sql`clock_timestamp()`;
function safe(session: typeof sessions.$inferSelect) {
  return { id: session.id, subject: session.subject, scope: session.scope,
    idleExpiresAt: session.idleExpiresAt, absoluteExpiresAt: session.absoluteExpiresAt };
}
function valid(scope: SessionScope, hash: string) {
  return and(eq(sessions.scope, scope), eq(sessions.tokenHash, hash), isNull(sessions.revokedAt),
    gt(sessions.idleExpiresAt, now), gt(sessions.absoluteExpiresAt, now));
}

export async function createSession(context: DbContext, scope: SessionScope, subject: string) {
  const token = generateToken();
  const absolute = scope === "admin" ? sql`${now} + interval '12 hours'` : sql`${now} + interval '7 days'`;
  const idle = scope === "admin" ? sql`${now} + interval '30 minutes'` : absolute;
  const [session] = await context.insert(sessions).values({ id: randomUUID(), scope, subject,
    tokenHash: hashToken(token)!, createdAt: now, absoluteExpiresAt: absolute, idleExpiresAt: idle }).returning();
  return { ...safe(session), token };
}

/** Resolution establishes possession only; callers must check current account and authority. */
export async function resolveSession(context: DbContext, scope: SessionScope, token: unknown) {
  const hash = hashToken(token);
  if (!hash) return null;
  return withTransaction(context, async tx => {
    // Lock first: expiry predicates must run after any wait on an unchanged row.
    await tx.select().from(sessions).where(and(eq(sessions.scope, scope), eq(sessions.tokenHash, hash))).for("update");
    const [session] = await tx.update(sessions).set({ idleExpiresAt: scope === "admin"
      ? sql`least(${sessions.absoluteExpiresAt}, ${now} + interval '30 minutes')` : sessions.absoluteExpiresAt })
      .where(valid(scope, hash)).returning();
    return session ? safe(session) : null;
  });
}

export async function rotateSession(context: DbContext, scope: SessionScope, token: unknown) {
  const hash = hashToken(token);
  if (!hash) return null;
  return withTransaction(context, async tx => {
    await tx.select().from(sessions).where(and(eq(sessions.scope, scope), eq(sessions.tokenHash, hash))).for("update");
    const replacement = generateToken();
    const [session] = await tx.update(sessions).set({ tokenHash: hashToken(replacement)!,
      idleExpiresAt: scope === "admin" ? sql`least(${sessions.absoluteExpiresAt}, ${now} + interval '30 minutes')` : sessions.absoluteExpiresAt })
      .where(valid(scope, hash)).returning();
    return session ? { ...safe(session), token: replacement } : null;
  });
}

export async function revokeSession(context: DbContext, scope: SessionScope, token: unknown) {
  const hash = hashToken(token);
  if (!hash) return;
  await context.update(sessions).set({ revokedAt: now })
    .where(and(eq(sessions.scope, scope), eq(sessions.tokenHash, hash), isNull(sessions.revokedAt)));
}

/** Subject-wide revocation deliberately spans both session scopes. */
export async function revokeAllSessions(context: DbContext, subject: string) {
  await context.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.subject, subject), isNull(sessions.revokedAt)));
}
