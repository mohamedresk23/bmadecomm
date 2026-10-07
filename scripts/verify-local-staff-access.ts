import dotenv from 'dotenv';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import { chromium, type Browser } from 'playwright-core';
import { generateSync } from 'otplib';
import { localDatabaseUrl } from './local-database-config';
import type { DbContext } from '../src/db/tx';
import * as schema from '../src/db/schema';
import { composeStaffAuthentication } from '../src/modules/identity/infrastructure/staff-auth-composition';
import { staffConfig, STAFF_SESSION_POLICY } from '../src/modules/identity/infrastructure/staff-config';
import { encryptStaffSecret, newStaffSeed, secretHash } from '../src/modules/identity/infrastructure/staff-crypto';
import { hashPassword } from '../src/modules/identity/infrastructure/password';
import { resolveStaffSession } from '../src/modules/identity/infrastructure/staff-sessions';
import { composeIdentityWorker } from '../src/modules/identity/infrastructure/worker';
import { SandboxEmailAdapter } from '../src/shared/email/adapter';

dotenv.config({ path: '.env.local', quiet: true }); dotenv.config({ path: '.env', quiet: true });
const runId = randomUUID().replaceAll('-', ''), isolated = `staff_access_verify_${runId}`;
const checks: string[] = [], startedAt = new Date().toISOString();
let stage = 'safe local configuration';
const evidenceFile = path.resolve('.local/staff-access-verification.json');
async function report(status: 'running' | 'passed' | 'failed') {
  await mkdir(path.dirname(evidenceFile), { recursive: true, mode: 0o700 });
  await writeFile(evidenceFile, JSON.stringify({ runId, startedAt, status, checks, ...(status === 'failed' ? { failedStage: stage } : {}) }, null, 2), { mode: 0o600 });
}
async function passed(label: string) { checks.push(label); console.log(`PASS: ${label}`); await report('running'); }
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, Math.min(ms, 30_000)));
async function main() {
  await report('running');
  const baseConnection = localDatabaseUrl();
  const port = Number(process.env.STAFF_VERIFY_PORT ?? '3107'); assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
  const origin = `http://127.0.0.1:${port}`, trustedHeader = 'x-local-staff-verification-source';
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'development', EMAIL_ADAPTER: 'sandbox', APP_URL: origin,
    STAFF_MFA_KEY: randomBytes(32).toString('base64'), IDENTITY_TOKEN_KEY: randomBytes(32).toString('base64'), IDENTITY_TRUSTED_IP_HEADER: trustedHeader, NEXT_TELEMETRY_DISABLED: '1' };
  const config = staffConfig(env), root = postgres(baseConnection, { max: 1, onnotice: () => {}, connect_timeout: 5 });
  const independent: ReturnType<typeof postgres>[] = [];
  let created = false, server: ChildProcess | undefined, browser: Browser | undefined;
  let sourceCount = 0;
  const source = () => `fd00:${runId.slice(0, 4)}:${runId.slice(4, 8)}::${(++sourceCount).toString(16)}`;
  try {
    await root`SELECT 1`;
    assert.match(isolated, /^staff_access_verify_[a-f0-9]{32}$/);
    await root.unsafe(`CREATE SCHEMA "${isolated}"`); created = true;
    const open = () => { const c = postgres(baseConnection, { max: 1, onnotice: () => {}, connect_timeout: 5, connection: { search_path: isolated } }); independent.push(c); return c; };
    const first = open(), second = open(), one = drizzle(first, { schema }) as DbContext, two = drizzle(second, { schema }) as DbContext;
    stage = 'fresh additive migrations in an isolated PostgreSQL schema';
    const journal = JSON.parse(await readFile('src/db/migrations/meta/_journal.json', 'utf8')) as { entries: { tag: string }[] };
    for (const entry of journal.entries) {
      assert.match(entry.tag, /^\d{4}_[a-z0-9_]+$/);
      const sql = (await readFile(`src/db/migrations/${entry.tag}.sql`, 'utf8')).replaceAll('"public".', `"${isolated}".`);
      for (const statement of sql.split('--> statement-breakpoint')) if (statement.trim()) await first.unsafe(statement);
    }
    await passed(stage);
    const privateConnection = new URL(baseConnection); privateConnection.searchParams.set('search_path', isolated);
    env.DATABASE_URL = privateConnection.toString();
    stage = 'isolated built Next server startup';
    // Requires npm run build. NODE_ENV development is intentional: this is a local sandbox, not production transport.
    await readFile('.next/BUILD_ID', 'utf8');
    server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    server.stdout?.resume(); server.stderr?.resume();
    let spawnFailed = false; server.on('error', () => { spawnFailed = true; });
    let ready = false;
    for (let cycle = 0; cycle < 120; cycle++) {
      if (spawnFailed || server.exitCode !== null) throw new Error('Private server failed');
      try { const response = await fetch(`${origin}/admin/login`, { signal: AbortSignal.timeout(1000) }); if (response.status === 200) { ready = true; break; } } catch {}
      await pause(250);
    }
    assert.ok(ready);
    const auth = composeStaffAuthentication(one, config), auth2 = composeStaffAuthentication(two, config);
    const meta = () => ({ source: source(), requestId: randomUUID() });
    const password = 'isolated synthetic staff access passphrase';
    const ownerEmail = `owner-${runId}@example.test`;
    const packageProof = await auth.provisionOwner(ownerEmail, 'Isolated synthetic Owner', meta());
    const [owner] = await one.select({ userId: schema.staffBootstrap.userId }).from(schema.staffBootstrap).where(eq(schema.staffBootstrap.key, 'first-owner'));
    assert.ok(owner.userId);
    async function nextOtp(userId: string, seed: string) {
      for (let cycle = 0; cycle < 150; cycle++) {
        const [a] = await two.select({ step: schema.staffAccounts.lastTotpStep }).from(schema.staffAccounts).where(eq(schema.staffAccounts.userId, userId));
        const current = Math.floor(Date.now() / 30_000), step = Math.max(current, (a.step ?? -1) + 1);
        if (step <= current + 1) return generateSync({ secret: seed, epoch: step * 30 });
        await pause(250);
      }
      throw new Error('Authenticator clock did not advance');
    }
    stage = 'installed headless Edge Owner enrollment and two-step login';
    browser = await chromium.launch({ channel: 'msedge', headless: true, timeout: 20_000 });
    const context = await browser.newContext({ extraHTTPHeaders: { [trustedHeader]: source() } }), page = await context.newPage(); page.setDefaultTimeout(20_000);
    let leakedUrl = false;
    page.on('request', request => { const u = new URL(request.url()); if (['http:', 'https:'].includes(u.protocol) && (u.hash || u.searchParams.has('token') || u.searchParams.has('csrf'))) leakedUrl = true; });
    const enrollmentUrl = new URL('/admin/enroll', origin); enrollmentUrl.hash = new URLSearchParams({ token: packageProof.token!, csrf: packageProof.csrf! }).toString();
    await page.goto(enrollmentUrl.toString()); await page.waitForFunction(() => !window.location.hash);
    await page.getByRole('button', { name: 'Begin authenticator enrollment' }).click();
    const seedLocator = page.locator('code').first(); await seedLocator.waitFor();
    let ownerSeed = (await seedLocator.textContent())!; assert.match(ownerSeed, /^[A-Z2-7]+$/);
    await page.getByLabel('Password (15–128 characters)', { exact: true }).fill(password);
    await page.getByLabel('Code from the new authenticator').fill(await nextOtp(owner.userId, ownerSeed));
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('region', { name: 'Recovery codes' }).waitFor();
    const ownerCodes = await page.locator('li code').allTextContents(); assert.equal(ownerCodes.length, 10);
    assert.equal((await two.select().from(schema.sessions).where(eq(schema.sessions.userId, owner.userId))).length, 0);
    await page.getByRole('button', { name: 'I saved the codes — sign in' }).click();
    async function browserLogin() {
      await context.setExtraHTTPHeaders({ [trustedHeader]: source() });
      await page.goto(`${origin}/admin/login`);
      await page.getByLabel('Staff email').fill(ownerEmail); await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByLabel('Authenticator code', { exact: true }).waitFor();
      assert.equal(await page.locator('input[type=password]').count(), 0);
      await page.getByLabel('Authenticator code', { exact: true }).fill(await nextOtp(owner.userId!, ownerSeed));
      await page.getByRole('button', { name: 'Continue', exact: true }).click(); await page.waitForURL(`${origin}/admin`);
      assert.equal(await page.getByRole('heading', { name: 'Administration', exact: true }).count(), 1);
    }
    await browserLogin(); assert.equal(leakedUrl, false);
    await passed(stage);
    stage = 'browser reauthentication rotates token and retains original absolute expiry';
    const oldCookie = (await context.cookies()).find(c => c.name === '__Host-staff-session')!.value;
    const [oldSession] = await two.select().from(schema.sessions).where(eq(schema.sessions.tokenHash, secretHash(oldCookie)));
    await page.goto(`${origin}/admin/security`); await page.getByLabel('Current password').fill(password);
    await page.getByLabel('New authenticator code').fill(await nextOtp(owner.userId, ownerSeed));
    await page.getByRole('button', { name: 'Continue', exact: true }).click(); await page.getByRole('status').filter({ hasText: 'Password and MFA verified' }).waitFor();
    const nextCookie = (await context.cookies()).find(c => c.name === '__Host-staff-session')!.value;
    assert.notEqual(nextCookie, oldCookie); assert.equal(await resolveStaffSession(two, oldCookie, STAFF_SESSION_POLICY), null);
    const [rotated] = await two.select().from(schema.sessions).where(eq(schema.sessions.tokenHash, secretHash(nextCookie))); assert.equal(rotated.expiresAt.getTime(), oldSession.expiresAt.getTime());
    await passed(stage);
    stage = 'browser recovery consumes saved code and requires new-factor proof and fresh login';
    await context.setExtraHTTPHeaders({ [trustedHeader]: source() });
    await page.goto(`${origin}/admin/recover`); await page.getByLabel('Staff email').fill(ownerEmail); await page.getByLabel('Current password').fill(password); await page.getByLabel('Unused offline recovery code').fill(ownerCodes[0]);
    await page.getByRole('button', { name: 'Continue', exact: true }).click(); await page.getByRole('button', { name: 'Begin authenticator enrollment' }).waitFor();
    assert.equal(await resolveStaffSession(two, nextCookie, STAFF_SESSION_POLICY), null);
    await page.getByRole('button', { name: 'Begin authenticator enrollment' }).click(); await seedLocator.waitFor();
    ownerSeed = (await seedLocator.textContent())!;
    await page.getByLabel('Password (15–128 characters)', { exact: true }).fill(password); await page.getByLabel('Code from the new authenticator').fill(await nextOtp(owner.userId, ownerSeed));
    await page.getByRole('button', { name: 'Continue', exact: true }).click(); await page.getByRole('region', { name: 'Recovery codes' }).waitFor();
    assert.equal((await two.select().from(schema.staffRecoveryCodes).where(and(eq(schema.staffRecoveryCodes.userId, owner.userId), eq(schema.staffRecoveryCodes.codeHash, secretHash(ownerCodes[0]))))).length, 0);
    await page.getByRole('button', { name: 'I saved the codes — sign in' }).click(); await browserLogin(); await passed(stage);

    async function fixture(label: string) {
      const userId = randomUUID(), email = `${label}-${runId}@example.test`, seed = newStaffSeed();
      await one.insert(schema.users).values({ id: userId, email, name: 'Isolated synthetic staff', phone: '', passwordHash: await hashPassword(password), role: 'staff' });
      await one.insert(schema.staffAccounts).values({ userId, mfaSeed: encryptStaffSecret(seed, config.key, userId, 'mfa'), mfaEnrolledAt: new Date() });
      await one.insert(schema.userRoles).values({ userId, roleKey: 'owner' });
      return { userId, email, seed };
    }
    async function login(f: { userId: string; email: string; seed: string }) {
      const p = await auth.login({ email: f.email, password }, meta()); return auth.mfa({ token: p.token, csrf: p.csrf, otp: await nextOtp(f.userId, f.seed) }, meta());
    }
    stage = 'independent PostgreSQL OTP/proof/code races accept exactly one use';
    const raced = await fixture('race'), p1 = await auth.login({ email: raced.email, password }, meta()), p2 = await auth.login({ email: raced.email, password }, meta()), value = await nextOtp(raced.userId, raced.seed);
    const attempts = await Promise.allSettled([auth.mfa({ token: p1.token, csrf: p1.csrf, otp: value }, meta()), auth2.mfa({ token: p2.token, csrf: p2.csrf, otp: value }, meta())]);
    assert.equal(attempts.filter(a => a.status === 'fulfilled').length, 1);
    const code = randomBytes(16).toString('hex'); await one.insert(schema.staffRecoveryCodes).values({ id: randomUUID(), userId: raced.userId, codeHash: secretHash(code) });
    const recoveries = await Promise.allSettled([auth.recover({ email: raced.email, password, code }, meta()), auth2.recover({ email: raced.email, password, code }, meta())]); assert.equal(recoveries.filter(a => a.status === 'fulfilled').length, 1);
    const recovered = recoveries.find(a => a.status === 'fulfilled')!; assert.equal(recovered.status, 'fulfilled'); if (recovered.status !== 'fulfilled') throw new Error();
    const details = await auth.enroll({ token: recovered.value.token, csrf: recovered.value.csrf }, meta()), newOtp = generateSync({ secret: details.seed! });
    const confirmations = await Promise.allSettled([auth.confirmEnrollment({ token: recovered.value.token, csrf: recovered.value.csrf, password, otp: newOtp }, meta()), auth2.confirmEnrollment({ token: recovered.value.token, csrf: recovered.value.csrf, password, otp: newOtp }, meta())]); assert.equal(confirmations.filter(a => a.status === 'fulfilled').length, 1);
    await passed(stage);
    stage = 'failed identity transaction rolls back factor, proof consumption, sessions and audit';
    const rollback = await fixture('rollback'), issued = await login(rollback), recovery = randomBytes(16).toString('hex');
    await one.insert(schema.staffRecoveryCodes).values({ id: randomUUID(), userId: rollback.userId, codeHash: secretHash(recovery) });
    await first.unsafe(`CREATE FUNCTION reject_recovery_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='staff.recovery.begun' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`);
    await first.unsafe('CREATE TRIGGER synthetic_recovery_rollback BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_recovery_audit()');
    await assert.rejects(auth.recover({ email: rollback.email, password, code: recovery }, meta()));
    assert.ok(await resolveStaffSession(two, issued.token!, STAFF_SESSION_POLICY));
    const [savedCode] = await two.select().from(schema.staffRecoveryCodes).where(eq(schema.staffRecoveryCodes.codeHash, secretHash(recovery))); assert.equal(savedCode.consumedAt, null);
    await first.unsafe('DROP TRIGGER synthetic_recovery_rollback ON audit_events'); await first.unsafe('DROP FUNCTION reject_recovery_audit()');
    await passed(stage);

    class Http {
      cookies = new Map<string, string>();
      async request(op: string, body?: unknown, headers: Record<string, string> = {}) {
        const response = await fetch(`${origin}/api/v1/admin/auth/${op}`, { method: body ? 'POST' : 'GET', headers: { Cookie: [...this.cookies.values()].join('; '), [trustedHeader]: source(), ...(body ? { Origin: origin, 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20_000) });
        const cookie = response.headers.get('set-cookie')?.split(';')[0]; if (cookie) this.cookies.set(cookie.split('=')[0], cookie); return response;
      }
    }
    stage = 'actual HTTP customer/invalid/disabled/missing-role and forged-header denial';
    const http = new Http(), csrf = (await (await http.request('preauth')).json()).csrf;
    const customerId = randomUUID(), customerEmail = `customer-${runId}@example.test`;
    await one.insert(schema.users).values({ id: customerId, email: customerEmail, name: 'Isolated customer', phone: '', passwordHash: await hashPassword(password) });
    for (const email of [customerEmail, `invalid-${runId}@example.test`]) assert.equal((await http.request('login', { email, password, csrf })).status, 401);
    assert.equal((await http.request('session', undefined, { 'x-mock-user': owner.userId })).status, 401);
    const boundary = await fixture('boundary'), httpProof = await (await http.request('login', { email: boundary.email, password, csrf })).json();
    const mfaResponse = await http.request('mfa', { token: httpProof.token, csrf: httpProof.csrf, otp: await nextOtp(boundary.userId, boundary.seed) }); assert.equal(mfaResponse.status, 200); const sessionBody = await mfaResponse.json(); assert.equal(sessionBody.token, undefined);
    assert.equal((await http.request('session')).status, 200);
    await one.update(schema.staffAccounts).set({ enabled: false }).where(eq(schema.staffAccounts.userId, boundary.userId)); assert.equal((await http.request('session')).status, 401);
    await one.update(schema.staffAccounts).set({ enabled: true }).where(eq(schema.staffAccounts.userId, boundary.userId)); await one.delete(schema.userRoles).where(eq(schema.userRoles.userId, boundary.userId)); assert.equal((await http.request('session')).status, 401);
    await passed(stage);
    stage = 'strict Origin/session CSRF and no-store HTTP boundaries';
    assert.equal((await http.request('login', { email: ownerEmail, password, csrf }, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await http.request('login', { email: ownerEmail, password, csrf }, { Origin: '' })).status, 403);
    assert.equal((await http.request('logout', { csrf: 'x'.repeat(43) })).status, 403);
    const noStore = await http.request('session'); assert.ok(noStore.headers.get('cache-control')?.includes('no-store'));
    await passed(stage);
    stage = 'persistent MFA challenge budgets and twenty-attempt shared source budget';
    const limited = await fixture('limited');
    for (let i = 0; i < 5; i++) {
      const p = await auth.login({ email: limited.email, password }, meta());
      await assert.rejects(auth.mfa({ token: p.token, csrf: p.csrf, otp: 'invalid' }, meta()), error => (error as { status: number }).status === 401);
    }
    const extra = await auth.login({ email: limited.email, password }, meta()); await assert.rejects(auth2.mfa({ token: extra.token, csrf: extra.csrf, otp: generateSync({ secret: limited.seed }) }, meta()), error => (error as { status: number }).status === 429);
    const sharedSource = source();
    for (let i = 0; i < 20; i++) await assert.rejects(auth.login({ email: `missing-${runId}-${i}@example.test`, password: 'wrong' }, { source: sharedSource, requestId: randomUUID() }), error => (error as { status: number }).status === 401);
    await assert.rejects(auth2.login({ email: `missing-${runId}-extra@example.test`, password: 'wrong' }, { source: sharedSource, requestId: randomUUID() }), error => (error as { status: number }).status === 429);
    await passed(stage);
    stage = 'mailbox plus saved-code reset grants only one-use restricted rebind';
    const reset = await fixture('reset'), resetCode = randomBytes(16).toString('hex');
    await one.insert(schema.staffRecoveryCodes).values({ id: randomUUID(), userId: reset.userId, codeHash: secretHash(resetCode) }); await auth.resetRequest({ email: reset.email }, meta());
    const mail = new SandboxEmailAdapter(), worker = composeIdentityWorker(one, env, mail);
    for (let cycle = 0; cycle < 100 && !mail.sent.some(m => m.template === 'staff-password-reset' && m.to === reset.email); cycle++) await worker.runOnce();
    const resetMail = mail.sent.find(m => m.template === 'staff-password-reset' && m.to === reset.email); assert.ok(resetMail);
    const fragment = new URLSearchParams(new URL(String(resetMail.data.resetUrl)).hash.slice(1));
    const rebound = await auth.resetConfirm({ token: fragment.get('token')!, csrf: fragment.get('csrf')!, password, code: resetCode }, meta()); assert.equal(rebound.rebind, true); assert.equal(await resolveStaffSession(two, rebound.token!, STAFF_SESSION_POLICY), null);
    await assert.rejects(auth2.resetConfirm({ token: fragment.get('token')!, csrf: fragment.get('csrf')!, password, code: resetCode }, meta())); await passed(stage);
    stage = 'password/factor/code changes reject old sessions and sanitized audit/outbox contain no bearer secrets';
    const change = await fixture('change'), changeSession = await login(change);
    await auth.own('password', changeSession.token!, { csrf: changeSession.csrf!, password, newPassword: 'isolated replacement passphrase value', otp: await nextOtp(change.userId, change.seed) }, meta());
    assert.equal(await resolveStaffSession(two, changeSession.token!, STAFF_SESSION_POLICY), null);
    const serial = JSON.stringify({ audit: await two.select().from(schema.auditEvents), outbox: await two.select().from(schema.outbox) });
    for (const secret of [password, packageProof.token!, ownerSeed, changeSession.token!, resetCode, fragment.get('token')!]) assert.equal(serial.includes(secret), false);
    await passed(stage);
    stage = 'protected browser shell rejects the next request after committed revoke-all';
    await one.update(schema.sessions).set({ revokedAt: new Date() }).where(eq(schema.sessions.userId, owner.userId));
    await page.goto(`${origin}/admin`); await page.waitForURL(`${origin}/admin/login`); assert.equal(await page.getByRole('heading', { name: 'Administration', exact: true }).count(), 0);
    await page.goto(`${origin}/admin/security`); await page.waitForURL(`${origin}/admin/login`); assert.equal(leakedUrl, false); await passed(stage);
    await report('passed');
  } finally {
    await browser?.close();
    if (server && server.exitCode === null) { server.kill(); await Promise.race([new Promise<void>(resolve => server!.once('exit', () => resolve())), pause(5000)]); }
    for (const connection of independent) await connection.end({ timeout: 5 });
    if (created) { assert.equal(isolated, `staff_access_verify_${runId}`); assert.match(isolated, /^staff_access_verify_[a-f0-9]{32}$/); await root.unsafe(`DROP SCHEMA "${isolated}" CASCADE`); }
    await root.end({ timeout: 5 });
  }
}
main().then(() => { console.log(`Staff access verification passed ${checks.length} groups. No secrets printed or recorded.`); process.exit(0); }).catch(async () => {
  await report('failed').catch(() => {}); console.error(`Staff access verification failed at: ${stage}. No proof values were printed.`); process.exit(1);
});
