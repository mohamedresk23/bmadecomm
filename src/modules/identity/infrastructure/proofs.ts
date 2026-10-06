import crypto from "crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { proofTokens } from "../../../db/schema";
import type { DbContext } from "../../../db/tx";

export function generateProofToken() {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  return { token, tokenHash };
}

export async function issueVerificationProof(tx: DbContext, userId: string, now = new Date()) {
  const { token, tokenHash } = generateProofToken();
  const proofId = crypto.randomUUID();
  await tx.insert(proofTokens).values({ id: proofId, userId, tokenHash,
    purpose: "verification", createdAt: now, expiresAt: new Date(now.getTime() + 86400000) });
  return { token, proofId };
}

/** Scoped primitive only: consumption never changes account verification state. */
export async function consumeProof(db: DbContext, input: { token: string; userId: string; purpose: string }, now = new Date()): Promise<boolean> {
  const tokenHash = crypto.createHash("sha256").update(input.token).digest("hex");
  const rows = await db.update(proofTokens).set({ consumedAt: now }).where(and(
    eq(proofTokens.tokenHash, tokenHash), eq(proofTokens.userId, input.userId),
    eq(proofTokens.purpose, input.purpose), gt(proofTokens.expiresAt, now), isNull(proofTokens.consumedAt),
  )).returning();
  return rows.length === 1;
}
