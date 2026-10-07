import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { boundedJson } from '../../../shared/api/bounded-json';
import { ApiError } from '../../../shared/api/errors';
import type { DbContext } from '../../../db/tx';
import { StaffAuthError, staffAuthInputs, type StaffOperation } from '../contracts/staff-auth';
import { composeStaffAuthentication } from './staff-auth-composition';
import { staffConfig, STAFF_SESSION_POLICY, type StaffConfig } from './staff-config';
import { secretToken, sessionCsrf, sameSecret } from './staff-crypto';
import { resolveStaffSession } from './staff-sessions';
import { readStaffCookie, staffSessionCookie, clearStaffSessionCookie } from './staff-cookies';

const PREAUTH = '__Host-staff-preauth';
function preauthCookie(req: Request) {
  const matches = (req.headers.get('cookie') ?? '').split(';').map(p => p.trim()).filter(p => p.startsWith(`${PREAUTH}=`));
  const value = matches.length === 1 ? matches[0].slice(PREAUTH.length + 1) : '';
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
function json(value: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store', 'Pragma': 'no-cache', ...extra } });
}
export function createStaffHttp(db: DbContext, config: StaffConfig = staffConfig()) {
  const auth = composeStaffAuthentication(db, config);
  return async function handle(req: Request, operation: string) {
    const requestId = randomUUID();
    try {
      if (req.method === 'GET' && operation === 'preauth') {
        const token = secretToken();
        return json({ csrf: sessionCsrf(token, config.key) }, 200, { 'Set-Cookie': `${PREAUTH}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=600` });
      }
      if (req.method === 'GET' && operation === 'session') {
        const token = readStaffCookie(req), context = await resolveStaffSession(db, token, STAFF_SESSION_POLICY);
        if (!context || !token) throw new StaffAuthError();
        return json({ userId: context.userId, roles: context.roles, authenticatedAt: context.authenticatedAt, csrf: sessionCsrf(token, config.key) });
      }
      if (req.method !== 'POST' || !(operation in staffAuthInputs)) return json({ error: { code: 'NOT_FOUND', message: 'Not found.', request_id: requestId } }, 404);
      if (req.headers.get('origin') !== config.origin) throw new StaffAuthError(403);
      const parsed = staffAuthInputs[operation as StaffOperation].safeParse(await boundedJson(req));
      if (!parsed.success) return json({ error: { code: 'BAD_REQUEST', message: 'Invalid authentication request.', request_id: requestId } }, 400);
      const input = parsed.data as Record<string, string>;
      if (['login', 'recover', 'reset-request'].includes(operation)) {
        const preauth = preauthCookie(req);
        if (!preauth || !sameSecret(sessionCsrf(preauth, config.key), input.csrf)) throw new StaffAuthError(403);
      }
      const source = config.trustedHeader ? req.headers.get(config.trustedHeader) ?? 'shared-source' : 'shared-source';
      const meta = { source: isIP(source) ? source : 'shared-source', requestId };
      const token = readStaffCookie(req);
      const result = operation === 'login' ? await auth.login(input, meta)
        : operation === 'mfa' ? await auth.mfa(input, meta)
        : operation === 'enroll' ? await auth.enroll(input, meta)
        : operation === 'enroll-confirm' ? await auth.confirmEnrollment(input, meta)
        : operation === 'recover' ? await auth.recover(input, meta)
        : operation === 'reset-request' ? await auth.resetRequest(input, meta)
        : operation === 'reset-confirm' ? await auth.resetConfirm(input, meta)
        : await auth.own(operation as 'reauth' | 'password' | 'factor' | 'codes' | 'logout', token ?? '', input, meta);
      const establishes = operation === 'mfa' || operation === 'reauth';
      const headers: Record<string, string> = {};
      if (establishes && result.token && result.expiresAt) headers['Set-Cookie'] = staffSessionCookie(result.token, result.expiresAt);
      else if (['logout', 'password', 'codes', 'recover', 'reset-confirm', 'enroll-confirm'].includes(operation)) headers['Set-Cookie'] = clearStaffSessionCookie();
      const { token: proofToken, ...safe } = result;
      return json(establishes ? safe : { ...safe, ...(proofToken ? { token: proofToken } : {}) }, 200, headers);
    } catch (error) {
      const status = error instanceof StaffAuthError ? error.status : error instanceof ApiError ? error.statusCode : 500;
      return json({ error: { code: status === 429 ? 'RATE_LIMITED' : status === 403 ? 'FORBIDDEN' : status === 500 ? 'INTERNAL_SERVER_ERROR' : 'AUTHENTICATION_FAILED', message: status === 500 ? 'Request could not be completed.' : status === 429 ? 'Please try again later.' : 'Authentication could not be completed.', request_id: requestId } }, status, status === 429 ? { 'Retry-After': '900' } : {});
    }
  };
}
