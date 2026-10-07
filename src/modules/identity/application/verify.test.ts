import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../../../db";
import { users, proofTokens } from "../../../db/schema";
import { setupTestDb, withIsolatedTx } from "../../../test-utils/db";
import { issueVerificationProof } from "../infrastructure/proofs";
import { composeVerification } from "../infrastructure/verification";
import type { DbContext } from "../../../db/tx";

beforeAll(setupTestDb);
async function fixture(tx: DbContext, now?: Date) {
  const userId = randomUUID();
  await tx.insert(users).values({ id: userId, name: "Synthetic", email: `${userId}@example.test`, phone: "123", passwordHash: "unused" });
  const { token, proofId } = await issueVerificationProof(tx, userId, now);
  return { userId, token, proofId };
}
describe("transactional activation", () => {
  it("rejects already verified and non-customer accounts without consuming valid proofs", async () => withIsolatedTx(async tx => {
    for (const state of [{ verifiedAt: new Date(0) }, { role: "admin" }]) {
      const input = await fixture(tx);
      await tx.update(users).set(state).where(eq(users.id, input.userId));
      const [before] = await tx.select().from(users).where(eq(users.id, input.userId));
      expect(await composeVerification(tx)(input)).toBe(false);
      expect((await tx.select().from(users).where(eq(users.id, input.userId)))[0]).toEqual(before);
      expect((await tx.select().from(proofTokens).where(eq(proofTokens.id, input.proofId)))[0].consumedAt).toBeNull();
    }
  }));
  it("activates once with matching timestamps, including racing consumption", async () => {
    const input = await fixture(db);
    const results = await Promise.all([composeVerification(db)(input), composeVerification(db)(input)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const [user] = await db.select().from(users).where(eq(users.id, input.userId));
    const [proof] = await db.select().from(proofTokens).where(eq(proofTokens.id, input.proofId));
    expect(user.verifiedAt).toEqual(proof.consumedAt);
    expect(user.verifiedAt).not.toBeNull();
    expect(await composeVerification(db)(input)).toBe(false);
  });
  it("rejects forgery, wrong user/scope and expiry without activation", async () => withIsolatedTx(async tx => {
    const input = await fixture(tx);
    expect(await composeVerification(tx)({ ...input, token: "a".repeat(43) })).toBe(false);
    expect(await composeVerification(tx)({ ...input, userId: randomUUID() })).toBe(false);
    await tx.update(proofTokens).set({ purpose: "password_reset" }).where(eq(proofTokens.id, input.proofId));
    expect(await composeVerification(tx)(input)).toBe(false);
    await tx.update(proofTokens).set({ purpose: "verification", expiresAt: new Date(0) }).where(eq(proofTokens.id, input.proofId));
    expect(await composeVerification(tx)(input)).toBe(false);
    expect((await tx.select().from(users).where(eq(users.id, input.userId)))[0].verifiedAt).toBeNull();
    expect((await tx.select().from(proofTokens).where(eq(proofTokens.id, input.proofId)))[0].consumedAt).toBeNull();
  }));
  it("rolls consumption back when the account update fails", async () => withIsolatedTx(async tx => {
    const input = await fixture(tx);
    await tx.execute(sql`CREATE FUNCTION pg_temp.reject_activation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$ LANGUAGE plpgsql`);
    await tx.execute(sql`CREATE TRIGGER reject_activation BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_activation()`);
    await expect(composeVerification(tx)(input)).rejects.toThrow();
    expect((await tx.select().from(proofTokens).where(eq(proofTokens.id, input.proofId)))[0].consumedAt).toBeNull();
    expect((await tx.select().from(users).where(eq(users.id, input.userId)))[0].verifiedAt).toBeNull();
  }));
});
