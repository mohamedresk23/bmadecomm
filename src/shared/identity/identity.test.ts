import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { sessions, proofTokens } from "../../db/schema";
import { setupTestDb, withIsolatedTx } from "../../test-utils/db";
import { createSession, resolveSession, rotateSession, revokeSession, revokeAllSessions } from "./sessions";
import { issueProof, consumeProof, invalidateProofs } from "./proof-tokens";
import { generateToken, hashToken } from "./tokens";

beforeAll(setupTestDb);
describe("opaque identity primitives", () => {
  it("validates canonical 32-byte tokens and stores only hashes", () => withIsolatedTx(async tx => {
    const session = await createSession(tx, "admin", "person");
    const [row] = await tx.select().from(sessions).where(eq(sessions.id, session.id));
    expect(row.tokenHash).toBe(hashToken(session.token));
    expect(JSON.stringify(row)).not.toContain(session.token);
    for (const token of [null, {}, "", "a".repeat(44), "!".repeat(43), "A".repeat(42) + "B"])
      expect(hashToken(token)).toBeNull();
    expect(hashToken(generateToken())).toMatch(/^[a-f0-9]{64}$/);
  }));
  it("isolates scopes, enforces policies, refreshes admin idle with absolute cap", () => withIsolatedTx(async tx => {
    const admin = await createSession(tx, "admin", "person");
    const customer = await createSession(tx, "customer", "person");
    expect(await resolveSession(tx, "customer", admin.token)).toBeNull();
    expect(await resolveSession(tx, "admin", customer.token)).toBeNull();
    const [row] = await tx.select().from(sessions).where(eq(sessions.id, admin.id));
    expect(row.absoluteExpiresAt.getTime() - row.createdAt.getTime()).toBeCloseTo(12 * 3600000, -2);
    expect(row.idleExpiresAt.getTime() - row.createdAt.getTime()).toBeCloseTo(30 * 60000, -2);
    expect(customer.absoluteExpiresAt.getTime() - row.createdAt.getTime()).toBeCloseTo(7 * 86400000, -2);
    await tx.update(sessions).set({ absoluteExpiresAt: sql`clock_timestamp() + interval '10 minutes'`,
      idleExpiresAt: sql`clock_timestamp() + interval '5 minutes'` }).where(eq(sessions.id, admin.id));
    const resolved = await resolveSession(tx, "admin", admin.token);
    expect(resolved?.idleExpiresAt).toEqual(resolved?.absoluteExpiresAt);
    // Deadlines at server time are invalid, even within the same transaction.
    await tx.update(sessions).set({ idleExpiresAt: sql`clock_timestamp()` }).where(eq(sessions.id, admin.id));
    expect(await resolveSession(tx, "admin", admin.token)).toBeNull();
    expect(await rotateSession(tx, "admin", admin.token)).toBeNull();
    await tx.update(sessions).set({ idleExpiresAt: sql`clock_timestamp()`, absoluteExpiresAt: sql`clock_timestamp()` })
      .where(eq(sessions.id, customer.id));
    expect(await resolveSession(tx, "customer", customer.token)).toBeNull();
  }));
  it("rotates atomically, rolls back failed rotation and revokes both scopes", () => withIsolatedTx(async tx => {
    const session = await createSession(tx, "admin", "person");
    await expect(tx.transaction(async nested => { await rotateSession(nested, "admin", session.token); throw new Error("rollback"); })).rejects.toThrow("rollback");
    expect(await resolveSession(tx, "admin", session.token)).not.toBeNull();
    const rotated = await rotateSession(tx, "admin", session.token);
    expect(await resolveSession(tx, "admin", session.token)).toBeNull();
    expect(await resolveSession(tx, "admin", rotated!.token)).not.toBeNull();
    await revokeSession(tx, "admin", rotated!.token);
    await revokeSession(tx, "admin", rotated!.token);
    expect(await resolveSession(tx, "admin", rotated!.token)).toBeNull();
    const a = await createSession(tx, "admin", "person");
    const c = await createSession(tx, "customer", "person");
    await revokeAllSessions(tx, "person");
    expect(await resolveSession(tx, "admin", a.token)).toBeNull();
    expect(await resolveSession(tx, "customer", c.token)).toBeNull();
  }));
  it("consumes only subject/purpose matching live proof and restores it on rollback", () => withIsolatedTx(async tx => {
    const proof = await issueProof(tx, "password_reset", "person");
    const [row] = await tx.select().from(proofTokens).where(eq(proofTokens.id, proof.id));
    expect(row.tokenHash).toBe(hashToken(proof.token));
    expect(JSON.stringify(row)).not.toContain(proof.token);
    expect(proof.expiresAt.getTime() - row.createdAt.getTime()).toBeCloseTo(30 * 60000, -2);
    expect(await consumeProof(tx, "email_verification", "person", proof.token)).toBe(false);
    expect(await consumeProof(tx, "password_reset", "other", proof.token)).toBe(false);
    expect(await consumeProof(tx, "password_reset", "person", generateToken())).toBe(false);
    expect(await consumeProof(tx, "password_reset", "person", "invalid")).toBe(false);
    await expect(tx.transaction(async nested => { expect(await consumeProof(nested, "password_reset", "person", proof.token)).toBe(true); throw new Error("business failure"); })).rejects.toThrow("business failure");
    expect(await consumeProof(tx, "password_reset", "person", proof.token)).toBe(true);
    expect(await consumeProof(tx, "password_reset", "person", proof.token)).toBe(false);
    const expired = await issueProof(tx, "email_verification", "person");
    expect(expired.expiresAt.getTime() - row.createdAt.getTime()).toBeCloseTo(24 * 3600000, -2);
    await tx.update(proofTokens).set({ expiresAt: sql`clock_timestamp()` }).where(eq(proofTokens.id, expired.id));
    expect(await consumeProof(tx, "email_verification", "person", expired.token)).toBe(false);
    const invalidated = await issueProof(tx, "email_verification", "person");
    await invalidateProofs(tx, "email_verification", "person");
    expect(await consumeProof(tx, "email_verification", "person", invalidated.token)).toBe(false);
  }));
});
