import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function aad(userId: string, proofId: string) { return Buffer.from(JSON.stringify(["verification", userId, proofId])); }

export function encryptToken(token: string, key: Buffer, userId: string, proofId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(userId, proofId));
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}

export function decryptToken(encrypted: string, key: Buffer, userId: string, proofId: string): string {
  const bytes = Buffer.from(encrypted, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
  decipher.setAAD(aad(userId, proofId));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
}
