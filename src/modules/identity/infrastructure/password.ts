import { randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

export function hashPassword(password: string): Promise<string> {
  return hash(password, {
    algorithm: 2, version: 1, // Argon2id, v19; numeric values support isolatedModules.
    memoryCost: 65536, timeCost: 3, parallelism: 4,
    outputLen: 32, salt: randomBytes(16),
  });
}

export function verifyPassword(password: string, encoded: string): Promise<boolean> {
  return verify(encoded, password);
}
