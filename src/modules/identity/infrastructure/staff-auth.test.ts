import { beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { generateSync } from 'otplib';
import { setupTestDb, withIsolatedTx } from '../../../test-utils/db';
import type { DbContext } from '../../../db/tx';
import { staffAccounts, staffAuthProofs, staffBootstrap, staffRecoveryCodes, staffAuthBuckets, sessions, users, roles, userRoles, outbox, auditEvents } from '../../../db/schema';
import { composeStaffAuthentication } from './staff-auth-composition';
import { staffConfig, STAFF_SESSION_POLICY } from './staff-config';
import { encryptStaffSecret, decryptStaffSecret, newStaffSeed, secretHash, secretToken, staffTotpStep, sessionCsrf } from './staff-crypto';
import { hashPassword, validStaffPassword } from './password';
import { resolveStaffSession } from './staff-sessions';
import { composeIdentityWorker } from './worker';
import { SandboxEmailAdapter } from '../../../shared/email/adapter';

beforeAll(setupTestDb);
const env: NodeJS.ProcessEnv = { NODE_ENV: 'test', EMAIL_ADAPTER: 'sandbox', APP_URL: 'http://localhost:3000', STAFF_MFA_KEY: randomBytes(32).toString('base64'), IDENTITY_TOKEN_KEY: randomBytes(32).toString('base64') };
const config = staffConfig(env), password = 'synthetic offline testing passphrase';
const proofInput = (value: { token?: string; csrf?: string }) => ({ token: value.token!, csrf: value.csrf! });
const metadata = () => ({ source: randomUUID(), requestId: randomUUID() });
const otp = (seed: string, step = 0) => generateSync({ secret: seed, epoch: Math.floor(Date.now() / 30_000) * 30 + step * 30 });
async function fixture(tx: DbContext) {
  const userId = randomUUID(), email = `${userId}@example.test`, seed = newStaffSeed();
  await tx.insert(users).values({ id: userId, email, name: 'Synthetic staff', phone: '', role: 'staff', passwordHash: await hashPassword(password) });
  await tx.insert(staffAccounts).values({ userId, mfaSeed: encryptStaffSecret(seed, config.key, userId, 'mfa'), mfaEnrolledAt: new Date() });
  await tx.insert(roles).values({ key: 'owner' }).onConflictDoNothing();
  await tx.insert(userRoles).values({ userId, roleKey: 'owner' });
  const auth = composeStaffAuthentication(tx, config), meta = metadata();
  const challenge = await auth.login({ email, password }, meta);
  return { userId, email, seed, auth, meta, challenge };
}
async function clearReplay(tx: DbContext, userId: string) {
  // Separate synthetic operations need independent authenticator steps; this changes fixtures, not verification.
  await tx.update(staffAccounts).set({ lastTotpStep: null }).where(eq(staffAccounts.userId, userId));
}
describe('staff authentication against actual database and cryptographic code', () => {
  it('requires password and an unused TOTP, keeps only token hashes, and blocks replay', async () => withIsolatedTx(async tx => {
    const f = await fixture(tx);
    expect(await tx.select().from(sessions).where(eq(sessions.userId, f.userId))).toHaveLength(0);
    const login = await f.auth.mfa({ ...proofInput(f.challenge), otp: otp(f.seed) }, f.meta);
    expect(login.token).toHaveLength(43);
    expect((await resolveStaffSession(tx, login.token!, STAFF_SESSION_POLICY))?.userId).toBe(f.userId);
    const [stored] = await tx.select().from(sessions).where(eq(sessions.id, login.sessionId!));
    expect(stored.tokenHash).toBe(secretHash(login.token!));
    expect(stored.authenticatedAt).not.toBeNull();
    await expect(f.auth.mfa({ ...proofInput(f.challenge), otp: otp(f.seed) }, f.meta)).rejects.toMatchObject({ status: 401 });
    const challenge2 = await f.auth.login({ email: f.email, password }, f.meta);
    await expect(f.auth.mfa({ ...proofInput(challenge2), otp: otp(f.seed) }, f.meta)).rejects.toMatchObject({ status: 401 });
  }));
  it('rejects invalid/customer/disabled credentials and missing roles', async () => withIsolatedTx(async tx => {
    const f = await fixture(tx);
    for (const input of [{ email: 'absent@example.test', password }, { email: f.email, password: 'wrong' }]) await expect(f.auth.login(input, metadata())).rejects.toMatchObject({ status: 401 });
    await tx.update(staffAccounts).set({ enabled: false }).where(eq(staffAccounts.userId, f.userId));
    await expect(f.auth.login({ email: f.email, password }, metadata())).rejects.toMatchObject({ status: 401 });
    await tx.update(staffAccounts).set({ enabled: true }).where(eq(staffAccounts.userId, f.userId));
    await tx.delete(userRoles).where(eq(userRoles.userId, f.userId));
    await expect(f.auth.login({ email: f.email, password }, metadata())).rejects.toMatchObject({ status: 401 });
    await tx.update(users).set({ role: 'customer' }).where(eq(users.id, f.userId));
    await expect(f.auth.login({ email: f.email, password }, metadata())).rejects.toMatchObject({ status: 401 });
    expect(await tx.select().from(sessions).where(eq(sessions.userId, f.userId))).toHaveLength(0);
  }));
  it('retains failed MFA account budgets across newly generated challenges', async () => withIsolatedTx(async tx => {
    const f = await fixture(tx);
    const wrong = otp(f.seed) === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++) {
      const p = await f.auth.login({ email: f.email, password }, metadata());
      await expect(f.auth.mfa({ ...proofInput(p), otp: wrong }, metadata())).rejects.toMatchObject({ status: 401 });
    }
    const another = await f.auth.login({ email: f.email, password }, metadata());
    await expect(f.auth.mfa({ ...proofInput(another), otp: otp(f.seed) }, metadata())).rejects.toMatchObject({ status: 429 });
    const [bucket] = await tx.select().from(staffAuthBuckets).where(eq(staffAuthBuckets.key, `mfa:account:${secretHash(f.userId)}`));
    expect(bucket.attempts).toBe(5);
  }));
  it('counts password failures and shared source attempts without success clearing source', async () => withIsolatedTx(async tx => {
    const f = await fixture(tx), shared = metadata();
    for (let i = 0; i < 5; i++) await expect(f.auth.login({ email: f.email, password: 'wrong' }, shared)).rejects.toMatchObject({ status: 401 });
    await expect(f.auth.login({ email: f.email, password }, shared)).rejects.toMatchObject({ status: 429 });
    const other = metadata();
    for (let i = 0; i < 20; i++) await expect(f.auth.login({ email: `${randomUUID()}@example.test`, password: 'wrong' }, other)).rejects.toMatchObject({ status: 401 });
    await expect(f.auth.login({ email: 'another@example.test', password }, other)).rejects.toMatchObject({ status: 429 });
  }));
  it('twenty verification attempts share one source across unknown/recreated challenges', async () => withIsolatedTx(async tx => {
    const auth = composeStaffAuthentication(tx, config), meta = metadata();
    for (let i = 0; i < 20; i++) await expect(auth.mfa({ token: secretToken(), csrf: secretToken(), otp: '000000' }, meta)).rejects.toMatchObject({ status: 401 });
    await expect(auth.mfa({ token: secretToken(), csrf: secretToken(), otp: '000000' }, meta)).rejects.toMatchObject({ status: 429 });
  }));
  it('first Owner enrollment activates once, reissues only pending setup and cannot reset MFA', async () => withIsolatedTx(async tx => {
    const auth = composeStaffAuthentication(tx, config), meta = metadata(), email = `${randomUUID()}@example.test`;
    const old = await auth.provisionOwner(email, 'Synthetic Owner', meta);
    const p = await auth.provisionOwner(email, 'Synthetic Owner', meta);
    await expect(auth.enroll(proofInput(old), meta)).rejects.toMatchObject({ status: 401 });
    const details = await auth.enroll(proofInput(p), meta);
    const result = await auth.confirmEnrollment({ ...proofInput(p), password, otp: otp(details.seed!) }, meta);
    expect(result.codes).toHaveLength(10);
    const [guard] = await tx.select().from(staffBootstrap).where(eq(staffBootstrap.key, 'first-owner'));
    const [account] = await tx.select().from(staffAccounts).where(eq(staffAccounts.userId, guard.userId!));
    expect(account.enabled).toBe(true); expect(account.mfaEnrolledAt).not.toBeNull();
    expect(await tx.select().from(sessions).where(eq(sessions.userId, account.userId))).toHaveLength(0);
    await expect(auth.confirmEnrollment({ ...proofInput(p), password, otp: otp(details.seed!) }, meta)).rejects.toMatchObject({ status: 401 });
    await expect(auth.provisionOwner(email, 'Synthetic Owner', meta)).rejects.toMatchObject({ status: 401 });
    await expect(auth.provisionOwner(`${randomUUID()}@example.test`, 'Other Owner', meta)).rejects.toMatchObject({ status: 401 });
  }));
  it('never converts a customer during bootstrap', async () => withIsolatedTx(async tx => {
    const email = `${randomUUID()}@example.test`, userId = randomUUID();
    await tx.insert(users).values({ id: userId, email, name: 'Customer', phone: '', passwordHash: 'unchanged' });
    await expect(composeStaffAuthentication(tx, config).provisionOwner(email, 'Owner', metadata())).rejects.toMatchObject({ status: 401 });
    const [user] = await tx.select().from(users).where(eq(users.id, userId)); expect(user.role).toBe('customer'); expect(user.passwordHash).toBe('unchanged');
  }));
  it('audit failure rolls back activation/password/factor/codes/proof atomically while failure reservation persists', async () => withIsolatedTx(async tx => {
    const auth = composeStaffAuthentication(tx, config), meta = metadata();
    const p = await auth.provisionOwner(`${randomUUID()}@example.test`, 'Synthetic Owner', meta);
    const details = await auth.enroll(proofInput(p), meta);
    const [proofBefore] = await tx.select().from(staffAuthProofs).where(eq(staffAuthProofs.tokenHash, secretHash(p.token!)));
    const [userBefore] = await tx.select().from(users).where(eq(users.id, proofBefore.userId));
    await tx.execute(sql.raw("CREATE FUNCTION reject_staff_activation_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='staff.activated' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$"));
    await tx.execute(sql.raw('CREATE TRIGGER staff_activation_rollback_test BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_staff_activation_test()'));
    await expect(auth.confirmEnrollment({ ...proofInput(p), password, otp: otp(details.seed!) }, meta)).rejects.toThrow();
    const [account] = await tx.select().from(staffAccounts).where(eq(staffAccounts.userId, proofBefore.userId));
    const [proofAfter] = await tx.select().from(staffAuthProofs).where(eq(staffAuthProofs.id, proofBefore.id));
    const [userAfter] = await tx.select().from(users).where(eq(users.id, proofBefore.userId));
    expect(account.enabled).toBe(false); expect(account.mfaSeed).toBeNull(); expect(account.lastTotpStep).toBeNull();
    expect(proofAfter.consumedAt).toBeNull(); expect(userAfter.passwordHash).toBe(userBefore.passwordHash);
    expect(await tx.select().from(staffRecoveryCodes).where(eq(staffRecoveryCodes.userId, account.userId))).toHaveLength(0);
    const [bucket] = await tx.select().from(staffAuthBuckets).where(eq(staffAuthBuckets.key, `mfa:account:${secretHash(account.userId)}`)); expect(bucket.attempts).toBe(1);
    await tx.execute(sql.raw('DROP TRIGGER staff_activation_rollback_test ON audit_events')); await tx.execute(sql.raw('DROP FUNCTION reject_staff_activation_test()'));
    expect((await auth.confirmEnrollment({ ...proofInput(p), password, otp: otp(details.seed!) }, meta)).codes).toHaveLength(10);
  }));
  it('rotates after fresh proofs while retaining absolute lifetime and not counting successful own MFA as failures', async () => withIsolatedTx(async tx => {
    const f = await fixture(tx);
    let issued = await f.auth.mfa({ ...proofInput(f.challenge), otp: otp(f.seed) }, f.meta);
    const absolute = issued.expiresAt;
    for (let i = 0; i < 6; i++) {
      await clearReplay(tx, f.userId);
      const old = issued.token!;
      issued = await f.auth.own('reauth', old, { csrf: issued.csrf!, password, otp: otp(f.seed) }, f.meta);
      expect(issued.expiresAt).toEqual(absolute);
      expect(await resolveStaffSession(tx, old, STAFF_SESSION_POLICY)).toBeNull();
      expect((await resolveStaffSession(tx, issued.token!, STAFF_SESSION_POLICY))?.authenticatedAt).not.toBeNull();
    }
    const [bucket] = await tx.select().from(staffAuthBuckets).where(eq(staffAuthBuckets.key, `mfa:account:${secretHash(f.userId)}`)); expect(bucket.attempts).toBe(0);
    const [source] = await tx.select().from(staffAuthBuckets).where(eq(staffAuthBuckets.key, `mfa:source:${secretHash(f.meta.source)}`)); expect(source.attempts).toBe(7);
  }));
  it('factor begin leaves sessions/factor intact; only proved replacement revokes sessions and codes', async () => withIsolatedTx(async tx => {
    const f = await fixture(tx), login = await f.auth.mfa({ ...proofInput(f.challenge), otp: otp(f.seed) }, f.meta);
    await clearReplay(tx, f.userId);
    const p = await f.auth.own('factor', login.token!, { csrf: login.csrf!, password, otp: otp(f.seed) }, f.meta);
    expect(await resolveStaffSession(tx, login.token!, STAFF_SESSION_POLICY)).not.toBeNull();
    const details = await f.auth.enroll(proofInput(p), f.meta);
    await expect(f.auth.confirmEnrollment({ ...proofInput(p), password, otp: 'wrong' }, f.meta)).rejects.toMatchObject({ status: 401 });
    expect(await resolveStaffSession(tx, login.token!, STAFF_SESSION_POLICY)).not.toBeNull();
    const replacement = await f.auth.confirmEnrollment({ ...proofInput(p), password, otp: otp(details.seed!) }, f.meta);
    expect(replacement.codes).toHaveLength(10); expect(await resolveStaffSession(tx, login.token!, STAFF_SESSION_POLICY)).toBeNull();
    const [account] = await tx.select().from(staffAccounts).where(eq(staffAccounts.userId, f.userId)); expect(decryptStaffSecret(account.mfaSeed!, config.key, f.userId, 'mfa')).toBe(details.seed);
  }));
  it('password and code changes revoke every session on the next read', async () => withIsolatedTx(async tx => {
    const f = await fixture(tx), login = await f.auth.mfa({ ...proofInput(f.challenge), otp: otp(f.seed) }, f.meta);
    await clearReplay(tx, f.userId);
    const codes = await f.auth.own('codes', login.token!, { csrf: login.csrf!, password, otp: otp(f.seed) }, f.meta);
    expect(codes.codes).toHaveLength(10); expect(await resolveStaffSession(tx, login.token!, STAFF_SESSION_POLICY)).toBeNull();
    await clearReplay(tx, f.userId);
    const p = await f.auth.login({ email: f.email, password }, f.meta), second = await f.auth.mfa({ ...proofInput(p), otp: otp(f.seed) }, f.meta);
    await clearReplay(tx, f.userId);
    await f.auth.own('password', second.token!, { csrf: second.csrf!, password, otp: otp(f.seed), newPassword: 'synthetic replacement password phrase' }, f.meta);
    expect(await resolveStaffSession(tx, second.token!, STAFF_SESSION_POLICY)).toBeNull();
    await expect(f.auth.login({ email: f.email, password }, f.meta)).rejects.toMatchObject({ status: 401 });
  }));
  it('consumes a recovery code once, grants only restricted rebind and revokes old sessions', async () => withIsolatedTx(async tx => {
    const f = await fixture(tx), login = await f.auth.mfa({ ...proofInput(f.challenge), otp: otp(f.seed) }, f.meta), code = randomBytes(16).toString('hex');
    await tx.insert(staffRecoveryCodes).values({ id: randomUUID(), userId: f.userId, codeHash: secretHash(code) });
    const recovered = await f.auth.recover({ email: f.email, password, code }, f.meta);
    expect(recovered.rebind).toBe(true); expect(await resolveStaffSession(tx, recovered.token!, STAFF_SESSION_POLICY)).toBeNull();
    expect(await resolveStaffSession(tx, login.token!, STAFF_SESSION_POLICY)).toBeNull();
    await expect(f.auth.recover({ email: f.email, password, code }, f.meta)).rejects.toMatchObject({ status: 401 });
    const details = await f.auth.enroll(proofInput(recovered), f.meta);
    await f.auth.confirmEnrollment({ ...proofInput(recovered), password, otp: otp(details.seed!) }, f.meta);
    expect(await tx.select().from(staffRecoveryCodes).where(and(eq(staffRecoveryCodes.userId, f.userId), eq(staffRecoveryCodes.codeHash, secretHash(code))))).toHaveLength(0);
  }));
  it('mailbox plus saved code replaces password and restricts factor rebind without MFA-free login', async () => withIsolatedTx(async tx => {
    const f = await fixture(tx), code = randomBytes(16).toString('hex');
    await tx.insert(staffRecoveryCodes).values({ id: randomUUID(), userId: f.userId, codeHash: secretHash(code) });
    await f.auth.resetRequest({ email: f.email }, f.meta);
    const adapter = new SandboxEmailAdapter(), worker = composeIdentityWorker(tx, env, adapter);
    await worker.runOnce();
    const mail = adapter.sent.find(item => item.template === 'staff-password-reset'); expect(mail).toBeDefined();
    const fragment = new URLSearchParams(new URL(String(mail!.data.resetUrl)).hash.slice(1));
    const recovered = await f.auth.resetConfirm({ token: fragment.get('token')!, csrf: fragment.get('csrf')!, password: 'synthetic replacement password phrase', code }, f.meta);
    expect(recovered.rebind).toBe(true); expect(await resolveStaffSession(tx, recovered.token!, STAFF_SESSION_POLICY)).toBeNull();
    await expect(f.auth.resetConfirm({ token: fragment.get('token')!, csrf: fragment.get('csrf')!, password, code }, f.meta)).rejects.toMatchObject({ status: 401 });
    const stored = await tx.select().from(outbox);
    const serialized = JSON.stringify(stored); expect(serialized).not.toContain(fragment.get('token')); expect(serialized).not.toContain(code); expect(serialized).not.toContain(f.seed);
  }));
  it('expiry, proof CSRF and five proof failures deny without activation', async () => withIsolatedTx(async tx => {
    const f = await fixture(tx);
    await expect(f.auth.mfa({ token: f.challenge.token!, csrf: 'x'.repeat(43), otp: otp(f.seed) }, f.meta)).rejects.toMatchObject({ status: 403 });
    await tx.update(staffAuthProofs).set({ expiresAt: new Date(0) }).where(eq(staffAuthProofs.tokenHash, secretHash(f.challenge.token!)));
    await expect(f.auth.mfa({ ...proofInput(f.challenge), otp: otp(f.seed) }, f.meta)).rejects.toMatchObject({ status: 401 });
    expect(await tx.select().from(sessions).where(eq(sessions.userId, f.userId))).toHaveLength(0);
  }));
  it('logout and session-bound CSRF enforce no-effect denial', async () => withIsolatedTx(async tx => {
    const f = await fixture(tx), login = await f.auth.mfa({ ...proofInput(f.challenge), otp: otp(f.seed) }, f.meta);
    await expect(f.auth.own('logout', login.token!, { csrf: sessionCsrf('x'.repeat(43), config.key) }, f.meta)).rejects.toMatchObject({ status: 403 });
    expect(await resolveStaffSession(tx, login.token!, STAFF_SESSION_POLICY)).not.toBeNull();
    await f.auth.own('logout', login.token!, { csrf: login.csrf! }, f.meta);
    expect(await resolveStaffSession(tx, login.token!, STAFF_SESSION_POLICY)).toBeNull();
  }));
  it('sanitized audit and notification rows never serialize authentication secrets', async () => withIsolatedTx(async tx => {
    const f = await fixture(tx), login = await f.auth.mfa({ ...proofInput(f.challenge), otp: otp(f.seed) }, f.meta);
    const serialized = JSON.stringify({ audit: await tx.select().from(auditEvents), outbox: await tx.select().from(outbox) });
    for (const secret of [password, f.seed, login.token!, f.challenge.token!, otp(f.seed)]) expect(serialized).not.toContain(secret);
  }));
  it('all recovery material lost and unsupported production mailbox recovery fail closed', async () => withIsolatedTx(async tx => {
    const f = await fixture(tx);
    await expect(f.auth.recover({ email: f.email, password, code: randomBytes(16).toString('hex') }, metadata())).rejects.toMatchObject({ status: 401 });
    const production = composeStaffAuthentication(tx, { ...config, sandbox: false });
    expect(await production.resetRequest({ email: f.email }, metadata())).toEqual({ ok: true });
    expect(await tx.select().from(staffAuthProofs).where(and(eq(staffAuthProofs.userId, f.userId), eq(staffAuthProofs.purpose, 'reset')))).toHaveLength(0);
    await expect(production.resetConfirm({ token: secretToken(), csrf: secretToken(), password, code: secretToken() }, metadata())).rejects.toMatchObject({ status: 401 });
  }));
});
describe('staff cryptographic configuration and password policy', () => {
  it('requires independent keys and HTTPS production origin', () => {
    expect(() => staffConfig({ ...env, STAFF_MFA_KEY: env.IDENTITY_TOKEN_KEY })).toThrow();
    expect(() => staffConfig({ ...env, NODE_ENV: 'production' })).toThrow();
    expect(staffConfig({ ...env, NODE_ENV: 'production', APP_URL: 'https://example.test' }).sandbox).toBe(false);
  });
  it('uses RFC 6238 vector and enforces once-only steps, encryption account/purpose binding', () => {
    const seed = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    expect(staffTotpStep(seed, '287082', new Date(59_000), null)).toBe(1);
    expect(staffTotpStep(seed, '287082', new Date(59_000), 1)).toBeNull();
    const encrypted = encryptStaffSecret(seed, config.key, 'one', 'mfa');
    expect(decryptStaffSecret(encrypted, config.key, 'one', 'mfa')).toBe(seed);
    expect(() => decryptStaffSecret(encrypted, config.key, 'two', 'mfa')).toThrow();
    expect(() => decryptStaffSecret(encrypted, config.key, 'one', 'reset')).toThrow();
  });
  it('validates Unicode code points and a staff-only common-password blocklist', () => {
    expect(validStaffPassword('short')).toBe(false); expect(validStaffPassword('passwordpassword')).toBe(false);
    expect(validStaffPassword('123456789987654321')).toBe(false);
    expect(validStaffPassword('😀'.repeat(14))).toBe(false); expect(validStaffPassword('😀'.repeat(14) + 'x')).toBe(true);
    expect(validStaffPassword('x'.repeat(128) + '😀')).toBe(false); expect(validStaffPassword(password)).toBe(true);
  });
});

