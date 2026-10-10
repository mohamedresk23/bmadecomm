import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { proofTokens } from "../../db/schema";
import type { DbContext } from "../../db/tx";
import { generateToken, hashToken } from "./tokens";

export type ProofPurpose = "password_reset" | "email_verification";
export async function issueProof(context: DbContext, purpose: ProofPurpose, subject: string) {
  const token = generateToken();
  const [proof] = await context.insert(proofTokens).values({ id: randomUUID(), purpose, subject,
    tokenHash: hashToken(token)!, createdAt: sql`clock_timestamp()`,
    expiresAt: purpose === "password_reset" ? sql`clock_timestamp() + interval '30 minutes'` : sql`clock_timestamp() + interval '24 hours'`,
  } as never).returning();
  return { id: proof.id, expiresAt: proof.expiresAt, token };
}

/** Pass the business transaction; rollback must restore proof eligibility. */
export async function consumeProof(tx: DbContext, purpose: ProofPurpose, subject: string, token: unknown): Promise<boolean> {
  const hash = hashToken(token);
  if (!hash) return false;
  await tx.select().from(proofTokens).where(and(eq(proofTokens.tokenHash, hash),
    eq(proofTokens.purpose, purpose), eq(proofTokens.subject, subject))).for("update");
  const rows = await tx.update(proofTokens).set({ consumedAt: sql`clock_timestamp()` }).where(and(
    eq(proofTokens.tokenHash, hash), eq(proofTokens.purpose, purpose), eq(proofTokens.subject, subject),
    isNull(proofTokens.consumedAt), gt(proofTokens.expiresAt, sql`clock_timestamp()`),
  )).returning();
  return rows.length === 1;
}

export async function invalidateProofs(tx: DbContext, purpose: ProofPurpose, subject: string) {
  await tx.update(proofTokens).set({ consumedAt: sql`clock_timestamp()` })
    .where(and(eq(proofTokens.purpose, purpose), eq(proofTokens.subject, subject), isNull(proofTokens.consumedAt)));
}
