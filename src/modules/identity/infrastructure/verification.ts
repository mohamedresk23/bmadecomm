import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { DbContext } from "../../../db/tx";
import { withTransaction } from "../../../db/tx";
import { users, proofTokens } from "../../../db/schema";
import { createVerifyCustomer } from "../application/verify";
import { consumeProof } from "./proofs";

export function composeVerification(db: DbContext) {
  return createVerifyCustomer({ activate: input => withTransaction(db, async tx => {
    // Every consumer locks the account before its proof. Check permanent account
    // state before touching consumption, then wait for the proof lock as well.
    const [account] = await tx.select().from(users).where(eq(users.id, input.userId)).for("update");
    if (!account || account.role !== "customer" || account.verifiedAt) return false;
    const tokenHash = createHash("sha256").update(input.token).digest("hex");
    const [proof] = await tx.select().from(proofTokens).where(and(
      eq(proofTokens.userId, input.userId), eq(proofTokens.tokenHash, tokenHash), eq(proofTokens.purpose, "verification"),
    )).for("update");
    if (!proof || proof.consumedAt) return false;
    // CURRENT_TIMESTAMP is transaction-start time; clock_timestamp is fresh AFTER
    // both row-lock waits. Use this one instant for expiry and both state writes.
    const [clock] = await tx.select({ instant: sql<string>`clock_timestamp()::text` }).from(users).where(eq(users.id, input.userId));
    const now = new Date(clock.instant);
    if (!await consumeProof(tx, { ...input, purpose: "verification" }, now)) return false;
    const updated = await tx.update(users).set({ verifiedAt: now }).where(and(
      eq(users.id, input.userId), eq(users.role, "customer"), isNull(users.verifiedAt),
    )).returning();
    // Throwing rolls back consumption if account activation cannot commit.
    if (updated.length !== 1) throw new Error("Account activation failed");
    return true;
  }) });
}
