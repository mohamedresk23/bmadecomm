// @vitest-environment jsdom
import React from 'react';
import { beforeAll, afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { randomBytes, randomUUID } from 'node:crypto';
import { generateSync } from 'otplib';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { setupTestDb } from '../../test-utils/db';
import { users, staffAccounts, roles, userRoles, staffAuthProofs, sessions, staffRecoveryCodes } from '../../db/schema';
import { StaffAccessForm } from './staff-access-form';
import { createStaffHttp } from '../../modules/identity/infrastructure/staff-http';
import { composeStaffAuthentication } from '../../modules/identity/infrastructure/staff-auth-composition';
import { staffConfig } from '../../modules/identity/infrastructure/staff-config';
import { encryptStaffSecret, newStaffSeed, secretHash } from '../../modules/identity/infrastructure/staff-crypto';
import { hashPassword } from '../../modules/identity/infrastructure/password';
const navigation = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));
beforeAll(setupTestDb);
configure({ asyncUtilTimeout: 5000 });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); window.history.replaceState(null, '', '/'); navigation.replace.mockReset(); navigation.refresh.mockReset(); });
const config = staffConfig({ NODE_ENV: 'test', EMAIL_ADAPTER: 'sandbox', APP_URL: 'http://localhost:3000', STAFF_MFA_KEY: randomBytes(32).toString('base64') });
const password = 'synthetic private UI testing passphrase';
const meta = () => ({ source: randomUUID(), requestId: randomUUID() });
async function fixture() {
  const userId = randomUUID(), email = `${userId}@example.test`, seed = newStaffSeed();
  await db.insert(users).values({ id: userId, email, role: 'staff', name: 'Synthetic UI staff', phone: '', passwordHash: await hashPassword(password) });
  await db.insert(staffAccounts).values({ userId, mfaSeed: encryptStaffSecret(seed, config.key, userId, 'mfa'), mfaEnrolledAt: new Date() });
  await db.insert(roles).values({ key: 'manager' }).onConflictDoNothing(); await db.insert(userRoles).values({ userId, roleKey: 'manager' });
  return { userId, email, seed };
}
function bridge() {
  const cookies = new Map<string, string>(), handle = createStaffHttp(db, config);
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const op = url.split('/').pop()!;
    const headers = new Headers(init?.headers); headers.set('Cookie', [...cookies.values()].join('; ')); if (init?.method === 'POST') headers.set('Origin', config.origin);
    const response = await handle(new Request(`${config.origin}${url}`, { ...init, headers }), op);
    const cookie = response.headers.get('set-cookie')?.split(';')[0]; if (cookie) cookies.set(cookie.split('=')[0], cookie);
    return response;
  }); vi.stubGlobal('fetch', fetch); return fetch;
}
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });
const submit = () => fireEvent.submit(screen.getByRole('button', { name: /^Continue$/ }).closest('form')!);
it('real form completes two-step login, clears password, and issues no session before MFA', async () => {
  const f = await fixture(); bridge(); render(<StaffAccessForm initialMode="login" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).not.toHaveProperty('disabled', true));
  fill('Staff email', f.email); fill('Password', password); submit();
  await screen.findByLabelText('Authenticator code'); expect(screen.queryByLabelText('Password', { exact: true })).toBeNull();
  expect(await db.select().from(sessions).where(eq(sessions.userId, f.userId))).toHaveLength(0);
  fill('Authenticator code', generateSync({ secret: f.seed })); submit();
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/admin'));
  expect(await db.select().from(sessions).where(eq(sessions.userId, f.userId))).toHaveLength(1);
});
it('forged and expired challenges cannot finish login and surface a recoverable generic error', async () => {
  const f = await fixture(); bridge(); render(<StaffAccessForm initialMode="login" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).not.toHaveProperty('disabled', true));
  fill('Staff email', f.email); fill('Password', password); submit(); await screen.findByLabelText('Authenticator code');
  await db.update(staffAuthProofs).set({ expiresAt: new Date(0) }).where(eq(staffAuthProofs.userId, f.userId));
  fill('Authenticator code', generateSync({ secret: f.seed })); submit(); await screen.findByText('Authentication could not be completed.');
  expect(navigation.replace).not.toHaveBeenCalled(); expect(await db.select().from(sessions).where(eq(sessions.userId, f.userId))).toHaveLength(0);
});
it('restricted real enrollment removes fragment promptly, activates once and displays codes only in memory', async () => {
  const auth = composeStaffAuthentication(db, config), proof = await auth.provisionOwner(`${randomUUID()}@example.test`, 'Synthetic Owner', meta());
  window.history.replaceState(null, '', `/admin/enroll#token=${proof.token}&csrf=${proof.csrf}`); bridge(); render(<StaffAccessForm initialMode="enroll" />);
  await waitFor(() => expect(window.location.hash).toBe('')); fireEvent.click(await screen.findByRole('button', { name: 'Begin authenticator enrollment' }));
  const seed = await waitFor(() => { const code = document.querySelector('code'); expect(code).not.toBeNull(); return code!.textContent!; });
  fill('Password (15–128 characters)', password); fill('Code from the new authenticator', generateSync({ secret: seed })); submit();
  await screen.findByRole('region', { name: 'Recovery codes' }); expect(document.querySelectorAll('li code')).toHaveLength(10); expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
});
it('real password+saved-code recovery enters restricted enrollment and revokes every old session', async () => {
  const f = await fixture(), auth = composeStaffAuthentication(db, config), code = randomBytes(16).toString('hex');
  await db.insert(staffRecoveryCodes).values({ id: randomUUID(), userId: f.userId, codeHash: secretHash(code) });
  const p = await auth.login({ email: f.email, password }, meta()); await auth.mfa({ token: p.token, csrf: p.csrf, otp: generateSync({ secret: f.seed }) }, meta());
  bridge(); render(<StaffAccessForm initialMode="recover" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).not.toHaveProperty('disabled', true));
  fill('Staff email', f.email); fill('Current password', password); fill('Unused offline recovery code', code); submit();
  await screen.findByRole('button', { name: 'Begin authenticator enrollment' });
  const saved = await db.select().from(sessions).where(eq(sessions.userId, f.userId)); expect(saved.every(s => s.revokedAt)).toBe(true);
  expect(navigation.replace).not.toHaveBeenCalledWith('/admin');
});
it('synchronous duplicate submission guard prevents two pending credential requests and allows retry', async () => {
  const f = await fixture(), actual = bridge();
  let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => { if (url.endsWith('/login')) await pending; return actual(url, init); }));
  render(<StaffAccessForm initialMode="login" />); await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).not.toHaveProperty('disabled', true));
  fill('Staff email', f.email); fill('Password', password); const form = screen.getByRole('button', { name: 'Continue' }).closest('form')!;
  act(() => { fireEvent.submit(form); fireEvent.submit(form); });
  expect((fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([url]) => String(url).endsWith('/login'))).toHaveLength(1);
  await act(async () => { release(); }); await screen.findByLabelText('Authenticator code');
});
it('bounded request timeout aborts stalled transport and restores the form for retry', async () => {
  const actual = bridge();
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => url.endsWith('/login') ? new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) : actual(url, init)));
  render(<StaffAccessForm initialMode="login" />); await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).not.toHaveProperty('disabled', true));
  fill('Staff email', 'missing@example.test'); fill('Password', password); vi.useFakeTimers(); submit();
  await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
  expect(screen.getByRole('status').textContent).toContain('timed out'); expect(screen.getByRole('button', { name: 'Continue' })).not.toHaveProperty('disabled', true);
});
