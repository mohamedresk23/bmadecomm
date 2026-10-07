export const STAFF_SESSION_POLICY = { idleMs: 30 * 60_000, absoluteMs: 12 * 60 * 60_000 };
export function staffConfig(env: NodeJS.ProcessEnv = process.env) {
  const text = env.STAFF_MFA_KEY ?? "";
  const key = Buffer.from(text, "base64");
  if (key.length !== 32 || key.toString("base64") !== text || text === env.IDENTITY_TOKEN_KEY) throw new Error("Separate staff MFA key required");
  const url = new URL(env.APP_URL ?? "");
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || (env.NODE_ENV === 'production' && url.protocol !== 'https:')) throw new Error('Staff origin configuration invalid');
  const trustedHeader = env.IDENTITY_TRUSTED_IP_HEADER;
  if (trustedHeader && !/^[a-z][a-z0-9-]*$/.test(trustedHeader)) throw new Error('Trusted source configuration invalid');
  return { key, origin: url.origin, trustedHeader, sandbox: env.NODE_ENV !== 'production' && env.EMAIL_ADAPTER === 'sandbox' };
}
export type StaffConfig = ReturnType<typeof staffConfig>;
