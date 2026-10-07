import { randomUUID } from "node:crypto";
import type { DbContext } from "../../../db/tx";
import { withTransaction } from "../../../db/tx";
import { users } from "../../../db/schema";
import { enqueue } from "../../../shared/outbox/enqueue";
import { createRegisterCustomer } from "../application/register";
import { hashPassword } from "./password";
import { issueVerificationProof } from "./proofs";
import { encryptToken } from "./token-encryption";

export function composeRegistration(db: DbContext, key: Buffer) {
  return createRegisterCustomer({ hashPassword, async createCustomer(dto, passwordHash) {
    await withTransaction(db, async tx => {
      const userId = randomUUID();
      const inserted = await tx.insert(users).values({ id: userId, name: dto.name,
        email: dto.email, phone: dto.phone, passwordHash, role: "customer", verifiedAt: null,
      }).onConflictDoNothing({ target: users.email }).returning();
      if (inserted.length === 0) return;
      const { token, proofId } = await issueVerificationProof(tx, userId);
      await enqueue(tx, { topic: "CustomerRegistered", dedupeKey: `register-verification-${userId}`,
        payload: { userId, proofId, encryptedToken: encryptToken(token, key, userId, proofId) } });
    });
  } });
}
