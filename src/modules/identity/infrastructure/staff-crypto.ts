import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { generateSecret, generateSync, generateURI } from 'otplib';
export const secretToken = () => randomBytes(32).toString('base64url');
export const secretHash = (value: string) => createHash('sha256').update(value).digest('hex');
export function sameSecret(a: string, b: string) { return timingSafeEqual(Buffer.from(secretHash(a)), Buffer.from(secretHash(b))); }
export function encryptStaffSecret(secret: string, key: Buffer, userId: string, purpose: string) {
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(JSON.stringify([userId, purpose])));
  return Buffer.concat([nonce, cipher.update(secret, 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64url');
}
export function decryptStaffSecret(encoded: string, key: Buffer, userId: string, purpose: string) {
  const data = Buffer.from(encoded, 'base64url');
  if (data.length < 29) throw new Error('Invalid encrypted staff secret');
  const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  cipher.setAAD(Buffer.from(JSON.stringify([userId, purpose]))); cipher.setAuthTag(data.subarray(-16));
  return Buffer.concat([cipher.update(data.subarray(12, -16)), cipher.final()]).toString('utf8');
}
export const newStaffSeed = () => generateSecret({ length: 32 });
export const staffSeedUri = (seed: string, email: string) => generateURI({ secret: seed, issuer: 'Store administration', label: email, digits: 6, period: 30 });
/** Explicit step verification makes the persisted replay boundary independent of library result shape. */
export function staffTotpStep(seed: string, token: string, now: Date, lastStep: number | null): number | null {
  if (!/^\d{6}$/.test(token)) return null;
  const current = Math.floor(now.getTime() / 30_000);
  for (const step of [current, current - 1, current + 1]) {
    if (step <= (lastStep ?? -1)) continue;
    const expected = generateSync({ secret: seed, epoch: step * 30, period: 30, digits: 6 });
    if (sameSecret(expected, token)) return step;
  }
  return null;
}
export const sessionCsrf = (token: string, key: Buffer) => createHmac('sha256', key).update('staff-session-csrf\0').update(token).digest('base64url');
