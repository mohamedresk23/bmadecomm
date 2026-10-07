import { z } from 'zod';
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const password = z.string().min(1).max(512);
const email = z.string().max(512).trim().toLowerCase().pipe(z.email().max(254));
const otp = z.string().regex(/^\d{6}$/);
const proof = { token, csrf: token };
const own = { csrf: token, password, otp };
export const staffAuthInputs = {
  login: z.object({ email, password, csrf: token }).strict(),
  mfa: z.object({ ...proof, otp }).strict(),
  enroll: z.object({ ...proof }).strict(),
  'enroll-confirm': z.object({ ...proof, password, otp }).strict(),
  recover: z.object({ email, password, code: z.string().regex(/^[a-f0-9]{32}$/), csrf: token }).strict(),
  'reset-request': z.object({ email, csrf: token }).strict(),
  'reset-confirm': z.object({ ...proof, password, otp: otp.optional(), code: z.string().regex(/^[a-f0-9]{32}$/).optional() }).strict().refine(v => !!v.otp !== !!v.code),
  reauth: z.object(own).strict(),
  password: z.object({ ...own, newPassword: password }).strict(),
  factor: z.object(own).strict(),
  codes: z.object(own).strict(),
  logout: z.object({ csrf: token }).strict(),
} as const;
export type StaffOperation = keyof typeof staffAuthInputs;
export type StaffAuthInput = Record<string, string | undefined>;
export type StaffAuthMeta = { source: string; requestId: string };
export type StaffAuthResult = { token?: string; csrf?: string; seed?: string; uri?: string; codes?: string[]; expiresAt?: Date; sessionId?: string; rebind?: boolean; ok?: boolean };
export class StaffAuthError extends Error {
  constructor(public status = 401) { super(status === 429 ? 'Please try again later.' : status === 403 ? 'Request denied.' : 'Authentication could not be completed.'); }
}
