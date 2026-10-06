import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { users, proofTokens } from "../../../db/schema";
import type { JobHandler } from "../../../shared/outbox/worker";
import type { EmailAdapter } from "../../../shared/email/adapter";
import { createEmailSendHandler } from "../../../shared/email/send-handler";
import { decryptToken } from "./token-encryption";

const payloadSchema = z.object({ userId: z.uuid(), proofId: z.uuid(), encryptedToken: z.string().min(1) }).strict();

export function createVerificationEmailHandler(adapter: EmailAdapter, config: { key: Buffer; origin: string }): JobHandler {
  const deliver = createEmailSendHandler(adapter);
  return async (item, db) => {
    try {
      const payload = payloadSchema.parse(item.payload);
      const [record] = await db.select({ email: users.email, expiresAt: proofTokens.expiresAt, consumedAt: proofTokens.consumedAt }).from(users).innerJoin(proofTokens,
        and(eq(proofTokens.userId, users.id), eq(proofTokens.id, payload.proofId), eq(proofTokens.purpose, "verification")))
        .where(eq(users.id, payload.userId));
      if (!record) throw new Error("Missing verification context");
      if (record.consumedAt || record.expiresAt.getTime() <= Date.now()) return;
      const token = decryptToken(payload.encryptedToken, config.key, payload.userId, payload.proofId);
      const url = new URL("/verify-email", config.origin);
      url.searchParams.set("token", token);
      url.searchParams.set("user", payload.userId);
      await deliver({ ...item, payload: { to: record.email, recipientRef: `user:${payload.userId}`,
        template: "customer-verification", data: { verificationUrl: url.toString() } } }, db);
    } catch {
      // Shared worker persists errors: never let provider input or secrets enter its error log.
      throw new Error("Verification email delivery failed");
    }
  };
}
