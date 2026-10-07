import { randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { createHash } from 'node:crypto';
import commonStaffPasswordHashes from './staff-common-passwords.json';

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

// Staff-only policy: customer credentials retain their established behavior.
const staffCommonPasswords = new Set([
  'passwordpassword', 'password123456789', '123456789012345', '1234567890123456',
  'qwertyuiopasdfgh', 'qwertyuiopasdfghjkl', 'letmeinletmeinletmein', 'iloveyouiloveyou',
  'correct horse battery staple', 'adminadminadmin', 'administrator123', 'welcome123456789',
]);
const staffBlocklist = new Set(commonStaffPasswordHashes);
export function validStaffPassword(value: string) {
  const length = Array.from(value).length;
  return length >= 15 && length <= 128 && !staffCommonPasswords.has(value.toLowerCase()) && !staffBlocklist.has(createHash('sha256').update(value.toLowerCase()).digest('hex')) && !/^(.)\1+$/u.test(value);
}
