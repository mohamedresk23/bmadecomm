import { staffTokenPattern } from "../contracts/staff-session";

export const STAFF_COOKIE_NAME = "__Host-staff-session";

export function readStaffCookie(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header || header.length > 16384) return null;
  const matches = header.split(";").map(part => part.trim()).filter(part => part.startsWith(`${STAFF_COOKIE_NAME}=`));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(STAFF_COOKIE_NAME.length + 1);
  return staffTokenPattern.test(token) ? token : null;
}

export function staffSessionCookie(token: string, expiresAt: Date): string {
  if (!staffTokenPattern.test(token) || !Number.isFinite(expiresAt.getTime())) throw new Error("Invalid staff cookie");
  return `${STAFF_COOKIE_NAME}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Expires=${expiresAt.toUTCString()}`;
}

export function clearStaffSessionCookie(): string {
  return `${STAFF_COOKIE_NAME}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`;
}
