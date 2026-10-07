import { z } from "zod";

// No runtime policy defaults: callers must supply approved limits explicitly.
export const staffSessionPolicySchema = z.object({
  idleMs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  absoluteMs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict().refine(value => value.idleMs <= value.absoluteMs, "Idle lifetime must not exceed absolute lifetime");

export type StaffSessionPolicy = z.infer<typeof staffSessionPolicySchema>;
export interface StaffSessionContext {
  sessionId: string;
  userId: string;
  context: "staff";
  roles: string[];
  expiresAt: Date;
  authenticatedAt: Date;
}

export const staffTokenPattern = /^[A-Za-z0-9_-]{43}$/;

/** Downstream sensitive commands must check this against the current validated session. */
export function staffAuthenticationIsFresh(context: StaffSessionContext, now = new Date()) {
  const age = now.getTime() - context.authenticatedAt.getTime();
  return age >= 0 && age <= 15 * 60_000 && context.expiresAt > now;
}
