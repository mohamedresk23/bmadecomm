import { beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { users, roles, userRoles, staffAccounts, sessions } from "../../../db/schema";
import { setupTestDb, withIsolatedTx } from "../../../test-utils/db";
import type { DbContext } from "../../../db/tx";
import { issueStaffSession, resolveStaffSession, revokeStaffSession, rotateStaffSession } from "./staff-sessions";

beforeAll(setupTestDb);
const policy = { idleMs: 1000, absoluteMs: 5000 };
const now = new Date("2026-01-01T00:00:00Z");
async function fixture(tx: DbContext) {
  const userId = randomUUID(), role = randomUUID();
  await tx.insert(users).values({ id: userId, name: "Synthetic staff", email: `${userId}@example.test`, phone: "123", passwordHash: "unused", role: "staff" });
  await tx.insert(staffAccounts).values({ userId, mfaSeed: 'fixture-encrypted-seed', mfaEnrolledAt: now });
  await tx.insert(roles).values({ key: role });
  await tx.insert(userRoles).values({ userId, roleKey: role });
  const issued = await issueStaffSession(tx, userId, policy, now);
  if (!issued) throw new Error("Fixture session not issued");
  return { userId, role, ...issued };
}

describe("database backed staff sessions", () => {
  it("stores only a hash and rejects missing, forged and customer sessions", async () => withIsolatedTx(async tx => {
    const input = await fixture(tx);
    const [stored] = await tx.select().from(sessions).where(eq(sessions.id, input.sessionId));
    expect(stored.tokenHash).toBe(createHash("sha256").update(input.token).digest("hex"));
    expect(stored.tokenHash).not.toBe(input.token);
    expect((await resolveStaffSession(tx, input.token, policy, now))?.roles).toEqual([input.role]);
    for (const token of [null, "forged", "a".repeat(43)]) expect(await resolveStaffSession(tx, token, policy, now)).toBeNull();
    const customerId = randomUUID(), customerToken = "c".repeat(43);
    await tx.insert(users).values({ id: customerId, name: "Synthetic customer", email: `${customerId}@example.test`, phone: "123", passwordHash: "unused" });
    await tx.insert(sessions).values({ ...stored, id: randomUUID(), userId: customerId, context: "customer", tokenHash: createHash("sha256").update(customerToken).digest("hex") });
    expect(await resolveStaffSession(tx, customerToken, policy, now)).toBeNull();
    await tx.update(users).set({ role: "customer" }).where(eq(users.id, input.userId));
    expect(await issueStaffSession(tx, input.userId, policy, now)).toBeNull();
    expect(await resolveStaffSession(tx, input.token, policy, now)).toBeNull();
    await tx.update(sessions).set({ context: "customer" }).where(eq(sessions.id, input.sessionId));
    expect(await resolveStaffSession(tx, input.token, policy, now)).toBeNull();
  }));
  it("denies at idle/absolute boundaries without extending expired sessions", async () => withIsolatedTx(async tx => {
    const input = await fixture(tx);
    expect(await resolveStaffSession(tx, input.token, policy, new Date(now.getTime() + 1000))).toBeNull();
    expect((await tx.select().from(sessions).where(eq(sessions.id, input.sessionId)))[0].lastSeenAt).toEqual(now);
    await tx.update(sessions).set({ idleExpiresAt: new Date(now.getTime() + 6000) }).where(eq(sessions.id, input.sessionId));
    expect(await resolveStaffSession(tx, input.token, policy, new Date(now.getTime() + 5000))).toBeNull();
  }));
  it("revokes privilege increases, keeps reductions live and never revives a disabled session", async () => withIsolatedTx(async tx => {
    const input = await fixture(tx), nextRole = randomUUID();
    await tx.insert(roles).values({ key: nextRole });
    await tx.insert(userRoles).values({ userId: input.userId, roleKey: nextRole });
    expect(await resolveStaffSession(tx, input.token, policy, now)).toBeNull();
    const fresh = await issueStaffSession(tx, input.userId, policy, now);
    expect((await resolveStaffSession(tx, fresh!.token, policy, now))?.roles).toEqual([input.role, nextRole].sort());
    await tx.delete(userRoles).where(eq(userRoles.roleKey, input.role));
    expect((await resolveStaffSession(tx, fresh!.token, policy, now))?.roles).toEqual([nextRole]);
    await tx.update(staffAccounts).set({ enabled: false }).where(eq(staffAccounts.userId, input.userId));
    expect(await resolveStaffSession(tx, fresh!.token, policy, now)).toBeNull();
    await tx.update(staffAccounts).set({ enabled: true }).where(eq(staffAccounts.userId, input.userId));
    expect(await resolveStaffSession(tx, fresh!.token, policy, now)).toBeNull();
    await tx.delete(userRoles).where(eq(userRoles.userId, input.userId));
    expect(await resolveStaffSession(tx, input.token, policy, now)).toBeNull();
    await tx.insert(userRoles).values({ userId: input.userId, roleKey: input.role });
    await revokeStaffSession(tx, input.token, now);
    expect(await resolveStaffSession(tx, input.token, policy, now)).toBeNull();
  }));
  it("rotates atomically, invalidates old tokens and preserves absolute expiry", async () => withIsolatedTx(async tx => {
    const input = await fixture(tx);
    const rotated = await rotateStaffSession(tx, input.token, policy, new Date(now.getTime() + 500));
    expect(rotated?.token).not.toBe(input.token);
    expect(rotated?.expiresAt).toEqual(input.expiresAt);
    expect(await resolveStaffSession(tx, input.token, policy, now)).toBeNull();
    expect(await resolveStaffSession(tx, rotated!.token, policy, new Date(now.getTime() + 600))).not.toBeNull();
  }));
  it("requires explicitly valid policy", async () => withIsolatedTx(async tx => {
    const input = await fixture(tx);
    await expect(issueStaffSession(tx, input.userId, { idleMs: 0, absoluteMs: 10 }, now)).rejects.toThrow();
    await expect(resolveStaffSession(tx, input.token, { idleMs: 20, absoluteMs: 10 }, now)).rejects.toThrow();
  }));
  it("uses current database time for runtime expiration", async () => withIsolatedTx(async tx => {
    const input = await fixture(tx);
    await tx.update(sessions).set({ expiresAt: new Date(0), idleExpiresAt: new Date(0) }).where(eq(sessions.id, input.sessionId));
    expect(await resolveStaffSession(tx, input.token, policy)).toBeNull();
  }));
});
