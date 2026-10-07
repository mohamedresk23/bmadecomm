import { beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { generateSync } from 'otplib';
import { eq } from 'drizzle-orm';
import { setupTestDb, withIsolatedTx } from '../../../test-utils/db';
import { staffAccounts, users, roles, userRoles } from '../../../db/schema';
import { hashPassword } from './password';
import { staffConfig } from './staff-config';
import { encryptStaffSecret, newStaffSeed } from './staff-crypto';
import { createStaffHttp } from './staff-http';
import type { DbContext } from '../../../db/tx';
beforeAll(setupTestDb);
const config = staffConfig({ NODE_ENV: 'test', EMAIL_ADAPTER: 'sandbox', APP_URL: 'http://localhost:3000', STAFF_MFA_KEY: randomBytes(32).toString('base64') });
const password = 'synthetic authentication testing phrase';
async function transport(tx: DbContext) {
  const userId = randomUUID(), email = `${userId}@example.test`, seed = newStaffSeed();
  await tx.insert(users).values({ id: userId, email, role: 'staff', name: 'Synthetic staff', phone: '', passwordHash: await hashPassword(password) });
  await tx.insert(staffAccounts).values({ userId, mfaEnrolledAt: new Date(), mfaSeed: encryptStaffSecret(seed, config.key, userId, 'mfa') });
  await tx.insert(roles).values({ key: 'owner' }).onConflictDoNothing(); await tx.insert(userRoles).values({ userId, roleKey: 'owner' });
  const handle = createStaffHttp(tx, config), cookies = new Map<string, string>();
  async function request(operation: string, body?: unknown, headers: Record<string, string> = {}) {
    const response = await handle(new Request(`${config.origin}/api/v1/admin/auth/${operation}`, { method: body ? 'POST' : 'GET', headers: { Cookie: [...cookies.values()].join('; '), ...(body ? { Origin: config.origin, 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }), operation);
    const cookie = response.headers.get('set-cookie')?.split(';')[0]; if (cookie) cookies.set(cookie.split('=')[0], cookie);
    return response;
  }
  const preauth = await (await request('preauth')).json();
  return { userId, email, seed, request, preauth, cookies };
}
describe('real staff HTTP adapters', () => {
  it('normalizes email, requires real challenge, exposes session cookie only after MFA, and returns nested safe errors', async () => withIsolatedTx(async tx => {
    const f = await transport(tx);
    const login = await f.request('login', { email: ` ${f.email.toUpperCase()} `, password, csrf: f.preauth.csrf });
    expect(login.status).toBe(200); expect(login.headers.get('set-cookie')).toBeNull();
    const p = await login.json();
    const mfa = await f.request('mfa', { token: p.token, csrf: p.csrf, otp: generateSync({ secret: f.seed }) });
    expect(mfa.status).toBe(200); expect(mfa.headers.get('set-cookie')).toContain('__Host-staff-session='); expect(mfa.headers.get('set-cookie')).toContain('Secure; HttpOnly; SameSite=Strict');
    const safe = await mfa.json(); expect(safe.token).toBeUndefined(); expect(safe.seed).toBeUndefined(); expect(safe.csrf).toHaveLength(43);
    const session = await f.request('session'); expect(session.status).toBe(200); expect(session.headers.get('cache-control')).toContain('no-store');
    const wrong = await f.request('mfa', { token: 'x'.repeat(43), csrf: 'y'.repeat(43), otp: '000000' }); expect(wrong.status).toBe(401); expect((await wrong.json()).error.code).toBe('AUTHENTICATION_FAILED');
  }));
  it('strict Origin and bound CSRF deny before identity effects', async () => withIsolatedTx(async tx => {
    const f = await transport(tx);
    for (const headers of [{ Origin: 'https://evil.example' }, { Origin: '' }]) {
      const response = await f.request('login', { email: f.email, password, csrf: f.preauth.csrf }, headers); expect(response.status).toBe(403);
    }
    expect((await f.request('login', { email: f.email, password, csrf: 'x'.repeat(43) })).status).toBe(403);
    const login = await (await f.request('login', { email: f.email, password, csrf: f.preauth.csrf })).json();
    await f.request('mfa', { token: login.token, csrf: login.csrf, otp: generateSync({ secret: f.seed }) });
    expect((await f.request('logout', { csrf: 'x'.repeat(43) })).status).toBe(403); expect((await f.request('session')).status).toBe(200);
  }));
  it('disabled accounts and forged mock headers cannot read session or gain authority', async () => withIsolatedTx(async tx => {
    const f = await transport(tx);
    expect((await f.request('session', undefined, { 'x-mock-user': f.userId })).status).toBe(401);
    const login = await (await f.request('login', { email: f.email, password, csrf: f.preauth.csrf })).json();
    await f.request('mfa', { token: login.token, csrf: login.csrf, otp: generateSync({ secret: f.seed }) });
    await tx.update(staffAccounts).set({ enabled: false }).where(eq(staffAccounts.userId, f.userId));
    expect((await f.request('session', undefined, { 'x-mock-user': f.userId })).status).toBe(401);
  }));
  it('runtime schemas and bounded JSON never serialize submitted secrets', async () => withIsolatedTx(async tx => {
    const f = await transport(tx), secret = 'submitted-private-password';
    const response = await f.request('login', { email: f.email, password: secret, csrf: f.preauth.csrf, injected: secret });
    expect(response.status).toBe(400); expect(await response.text()).not.toContain(secret);
    const oversized = await f.request('login', { email: f.email, password: secret.repeat(1000), csrf: f.preauth.csrf }); expect(oversized.status).toBe(413);
  }));
});
