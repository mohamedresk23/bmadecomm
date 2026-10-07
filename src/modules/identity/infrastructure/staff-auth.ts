import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { DbContext } from '../../../db/tx';
import { withTransaction } from '../../../db/tx';
import { staffAccounts, users, userRoles, sessions, staffAuthProofs, staffRecoveryCodes, staffBootstrap, staffAuthBuckets, roles } from '../../../db/schema';
import { writeAudit } from '../../../shared/authz/audit';
import { enqueue } from '../../../shared/outbox/enqueue';
import { StaffAuthError } from '../contracts/staff-auth';
import { hashPassword, verifyPassword, validStaffPassword } from './password';
import { decryptStaffSecret, encryptStaffSecret, newStaffSeed, sameSecret, secretHash, secretToken, sessionCsrf, staffSeedUri, staffTotpStep } from './staff-crypto';
import { STAFF_SESSION_POLICY, type StaffConfig } from './staff-config';
import { consumeStaffBudget, resetStaffAccountBudget, releaseStaffAccountAttempt } from './staff-throttle';

type Input = { [key: string]: string | undefined };
type Meta = { source: string; requestId: string };
type Proof = typeof staffAuthProofs.$inferSelect;
type Account = typeof staffAccounts.$inferSelect & { email: string; passwordHash: string };
type Result = { token?: string; csrf?: string; seed?: string; uri?: string; codes?: string[]; expiresAt?: Date; sessionId?: string; rebind?: boolean; ok?: boolean };
const denied = { denied: true } as const;
let dummyPasswordHash: Promise<string> | undefined;
async function checkStaffPassword(a: Account | null, value: string, eligible: boolean) {
  dummyPasswordHash ??= hashPassword(secretToken());
  const hash = eligible && a ? a.passwordHash : await dummyPasswordHash;
  const matches = await verifyPassword(value, hash);
  return eligible && matches;
}
const nowAt = async (tx: DbContext) => (await tx.select({ now: sql`clock_timestamp()`.mapWith(value => new Date(value)) }).from(staffAccounts).limit(1))[0].now;

export function createStaffAuthentication(db: DbContext, config: StaffConfig) {
  const encrypt = (secret: string, userId: string, purpose: string) => encryptStaffSecret(secret, config.key, userId, purpose);
  const decrypt = (secret: string, userId: string, purpose: string) => decryptStaffSecret(secret, config.key, userId, purpose);
  async function audit(tx: DbContext, userId: string, action: string, meta: Meta, notify = false) {
    await writeAudit(tx, { actor: `staff:${userId}`, action, resource: `staff:${userId}`, requestId: meta.requestId });
    if (notify) await enqueue(tx, { topic: 'StaffSecurityChanged', payload: { userId, action }, dedupeKey: `staff-security:${randomUUID()}` });
  }
  async function recordDenied(identity: string, meta: Meta, userId?: string) {
    await withTransaction(db, async tx => {
      await writeAudit(tx, { actor: userId ? `staff:${userId}` : `unknown:${secretHash(identity)}`, action: 'staff.authentication.failed', resource: userId ? `staff:${userId}` : 'staff-authentication', requestId: meta.requestId });
      if (userId) {
        const [bucket] = await tx.select().from(staffAuthBuckets).where(eq(staffAuthBuckets.key, `mfa:account:${secretHash(userId)}`));
        if (bucket?.attempts >= 5) await enqueue(tx, { topic: 'StaffSecurityChanged', payload: { userId, action: 'staff.mfa.repeated-failures' }, dedupeKey: `staff-mfa-failures:${userId}:${bucket.windowStart.toISOString()}` });
      }
    });
  }
  async function account(tx: DbContext, userId: string): Promise<Account | null> {
    // One lock order for every identity mutation: user/account -> session/proof -> codes.
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
    if (!user || user.role !== 'staff') return null;
    const [staff] = await tx.select().from(staffAccounts).where(eq(staffAccounts.userId, userId)).for('update');
    return staff ? { ...staff, email: user.email, passwordHash: user.passwordHash } : null;
  }
  async function active(tx: DbContext, a: Account) {
    return a.enabled && !!a.mfaEnrolledAt && !!a.mfaSeed && (await tx.select().from(userRoles).where(eq(userRoles.userId, a.userId))).length > 0;
  }
  async function proof(tx: DbContext, userId: string, purpose: string, duration: number, seed?: string) {
    const token = secretToken(), csrf = secretToken(), id = randomUUID();
    const expiresAt = new Date((await nowAt(tx)).getTime() + duration);
    await tx.insert(staffAuthProofs).values({ id, userId, purpose, tokenHash: secretHash(token), csrfHash: secretHash(csrf), expiresAt, seed: seed ? encrypt(seed, userId, `proof:${id}`) : null });
    return { token, csrf, expiresAt };
  }
  async function invalidate(tx: DbContext, userId: string, now: Date) {
    await tx.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.userId, userId), eq(sessions.context, 'staff'), isNull(sessions.revokedAt)));
    await tx.update(staffAuthProofs).set({ consumedAt: now }).where(and(eq(staffAuthProofs.userId, userId), isNull(staffAuthProofs.consumedAt)));
  }
  async function newCodes(tx: DbContext, userId: string) {
    await tx.delete(staffRecoveryCodes).where(eq(staffRecoveryCodes.userId, userId));
    const codes = Array.from({ length: 10 }, () => randomBytes(16).toString('hex'));
    await tx.insert(staffRecoveryCodes).values(codes.map(code => ({ id: randomUUID(), userId, codeHash: secretHash(code) })));
    return codes;
  }
  async function useCode(tx: DbContext, userId: string, value: string, now: Date) {
    const [code] = await tx.select().from(staffRecoveryCodes).where(and(eq(staffRecoveryCodes.userId, userId), eq(staffRecoveryCodes.codeHash, secretHash(value)), isNull(staffRecoveryCodes.consumedAt))).for('update');
    if (!code) return false;
    await tx.update(staffRecoveryCodes).set({ consumedAt: now }).where(eq(staffRecoveryCodes.id, code.id));
    return true;
  }
  async function useTotp(tx: DbContext, a: Account, value: string, now: Date) {
    if (!a.mfaSeed) return false;
    const step = staffTotpStep(decrypt(a.mfaSeed, a.userId, 'mfa'), value, now, a.lastTotpStep);
    if (step === null) return false;
    await tx.update(staffAccounts).set({ lastTotpStep: step }).where(eq(staffAccounts.userId, a.userId));
    return true;
  }
  async function session(tx: DbContext, a: Account, now: Date) {
    const token = secretToken(), sessionId = randomUUID(), expiresAt = new Date(now.getTime() + STAFF_SESSION_POLICY.absoluteMs);
    await tx.insert(sessions).values({ id: sessionId, userId: a.userId, context: 'staff', tokenHash: secretHash(token), createdAt: now, authenticatedAt: now, lastSeenAt: now, idleExpiresAt: new Date(now.getTime() + STAFF_SESSION_POLICY.idleMs), expiresAt });
    return { token, sessionId, expiresAt, csrf: sessionCsrf(token, config.key) };
  }
  async function budget(surface: string, identity: string, meta: Meta, accountMaximum = 5, window = 15 * 60_000, sourceMaximum = 20) {
    try {
      await consumeStaffBudget(db, `${surface}:source`, meta.source, sourceMaximum, window);
      return await consumeStaffBudget(db, `${surface}:account`, identity, accountMaximum, window);
    } catch (error) {
      if (error instanceof StaffAuthError) await writeAudit(db, { actor: `unknown:${secretHash(identity)}`, action: 'staff.authentication.throttled', resource: 'staff-authentication', requestId: meta.requestId });
      throw error;
    }
  }
  async function finish(result: Result | typeof denied): Promise<Result> {
    if ('denied' in result) throw new StaffAuthError();
    return result;
  }
  async function withProof(input: Input, purposes: string[], meta: Meta, callback: (tx: DbContext, a: Account, p: Proof, now: Date) => Promise<Result | typeof denied>) {
    const [lookup] = await db.select({ userId: staffAuthProofs.userId }).from(staffAuthProofs).where(eq(staffAuthProofs.tokenHash, secretHash(input.token ?? '')));
    const reservedWindow = await budget('mfa', lookup?.userId ?? secretHash(input.token ?? ''), meta);
    const result = await withTransaction(db, async tx => {
      if (!lookup) return denied;
      const a = await account(tx, lookup.userId);
      if (!a) return denied;
      const [p] = await tx.select().from(staffAuthProofs).where(eq(staffAuthProofs.tokenHash, secretHash(input.token ?? ''))).for('update');
      const now = await nowAt(tx);
      if (!p || p.userId !== a.userId || p.consumedAt || p.expiresAt <= now || p.failures >= 5 || !purposes.includes(p.purpose)) return denied;
      if (!sameSecret(p.csrfHash, secretHash(input.csrf ?? ''))) throw new StaffAuthError(403);
      const result = await callback(tx, a, p, now);
      if ('denied' in result) {
        await tx.update(staffAuthProofs).set({ failures: p.failures + 1 }).where(eq(staffAuthProofs.id, p.id));
      }
      return result;
    });
    if (!('denied' in result) && lookup) await releaseStaffAccountAttempt(db, 'mfa:account', lookup.userId, reservedWindow);
    if ('denied' in result) await recordDenied(input.token ?? '', meta, lookup?.userId);
    return finish(result);
  }

  return {
    async provisionOwner(email: string, name: string, meta: Meta): Promise<Result> {
      return finish(await withTransaction(db, async tx => {
        await tx.insert(staffBootstrap).values({ key: 'first-owner' }).onConflictDoNothing();
        const [guard] = await tx.select().from(staffBootstrap).where(eq(staffBootstrap.key, 'first-owner')).for('update');
        if (guard.userId) {
          const a = await account(tx, guard.userId);
          if (!a || a.email !== email || a.enabled || a.mfaEnrolledAt || a.mfaSeed) return denied;
          await invalidate(tx, a.userId, await nowAt(tx));
          return proof(tx, a.userId, 'setup', 15 * 60_000);
        }
        if ((await tx.select().from(userRoles).where(eq(userRoles.roleKey, 'owner'))).length || (await tx.select().from(users).where(eq(users.email, email))).length) return denied;
        const userId = randomUUID();
        await tx.insert(users).values({ id: userId, email, name, phone: '', role: 'staff', passwordHash: await hashPassword(secretToken()) });
        await tx.insert(staffAccounts).values({ userId, enabled: false });
        await tx.insert(roles).values({ key: 'owner' }).onConflictDoNothing();
        await tx.insert(userRoles).values({ userId, roleKey: 'owner' });
        await tx.update(staffBootstrap).set({ userId }).where(eq(staffBootstrap.key, 'first-owner'));
        await audit(tx, userId, 'staff.provisioned', meta);
        return proof(tx, userId, 'setup', 15 * 60_000);
      }));
    },
    async login(input: Input, meta: Meta) {
      const email = input.email ?? '';
      const reservedWindow = await budget('password', email, meta);
      const result = await withTransaction(db, async tx => {
        const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
        const a = u ? await account(tx, u.id) : null;
        const eligible = !!a && await active(tx, a);
        if (!(await checkStaffPassword(a, input.password ?? '', eligible)) || !a) return denied;
        return proof(tx, a.userId, 'login', 5 * 60_000);
      });
      if (!('denied' in result)) await releaseStaffAccountAttempt(db, 'password:account', email, reservedWindow);
      else await recordDenied(email, meta);
      return finish(result);
    },
    async mfa(input: Input, meta: Meta) {
      const result = await withProof(input, ['login'], meta, async (tx, a, p, now) => {
        if (!(await active(tx, a)) || !(await useTotp(tx, a, input.otp ?? '', now))) return denied;
        await tx.update(staffAuthProofs).set({ consumedAt: now }).where(eq(staffAuthProofs.id, p.id));
        const result = await session(tx, a, now);
        await resetStaffAccountBudget(tx, 'mfa:account', a.userId);
        await resetStaffAccountBudget(tx, 'password:account', a.email);
        await audit(tx, a.userId, 'staff.login.succeeded', meta);
        return result;
      });
      return result;
    },
    async enroll(input: Input, meta: Meta) {
      return withProof(input, ['setup', 'rebind', 'factor'], meta, async (tx, a, p) => {
        if ((p.purpose === 'setup' && (a.enabled || a.mfaEnrolledAt)) || (p.purpose !== 'setup' && !(await active(tx, a)))) return denied;
        // Repeated reads reuse the same seed; they cannot reset proof failures.
        const seed = p.seed ? decrypt(p.seed, a.userId, `proof:${p.id}`) : newStaffSeed();
        if (!p.seed) await tx.update(staffAuthProofs).set({ seed: encrypt(seed, a.userId, `proof:${p.id}`) }).where(eq(staffAuthProofs.id, p.id));
        return { seed, uri: staffSeedUri(seed, a.email) };
      });
    },
    async confirmEnrollment(input: Input, meta: Meta) {
      return withProof(input, ['setup', 'rebind', 'factor'], meta, async (tx, a, p, now) => {
        if (!p.seed || (p.purpose === 'setup' && (a.enabled || a.mfaEnrolledAt)) || (p.purpose !== 'setup' && !(await active(tx, a)))) return denied;
        if (!validStaffPassword(input.password ?? '') || !(p.purpose === 'setup' || await verifyPassword(input.password ?? '', a.passwordHash))) return denied;
        const seed = decrypt(p.seed, a.userId, `proof:${p.id}`), step = staffTotpStep(seed, input.otp ?? '', now, null);
        if (step === null) return denied;
        if (p.purpose === 'setup') await tx.update(users).set({ passwordHash: await hashPassword(input.password!), verifiedAt: now }).where(eq(users.id, a.userId));
        await tx.update(staffAccounts).set({ enabled: true, mfaSeed: encrypt(seed, a.userId, 'mfa'), mfaEnrolledAt: now, lastTotpStep: step }).where(eq(staffAccounts.userId, a.userId));
        await invalidate(tx, a.userId, now);
        const codes = await newCodes(tx, a.userId);
        await audit(tx, a.userId, p.purpose === 'setup' ? 'staff.activated' : 'staff.mfa.replaced', meta, true);
        return { codes, ok: true };
      });
    },
    async recover(input: Input, meta: Meta) {
      const reservedWindow = await budget('recovery', input.email ?? '', meta);
      const result = await withTransaction(db, async tx => {
        const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.email, input.email ?? ''));
        const a = u ? await account(tx, u.id) : null;
        const eligible = !!a && await active(tx, a);
        if (!(await checkStaffPassword(a, input.password ?? '', eligible)) || !a) return denied;
        const now = await nowAt(tx);
        if (!(await useCode(tx, a.userId, input.code ?? '', now))) return denied;
        await invalidate(tx, a.userId, now);
        await audit(tx, a.userId, 'staff.recovery.begun', meta, true);
        return { ...await proof(tx, a.userId, 'rebind', 5 * 60_000), rebind: true };
      });
      if (!('denied' in result)) await releaseStaffAccountAttempt(db, 'recovery:account', input.email ?? '', reservedWindow);
      else await recordDenied(input.email ?? '', meta);
      return finish(result);
    },
    async resetRequest(input: Input, meta: Meta): Promise<Result> {
      // Public outcome is identical, including throttled/unsupported requests.
      try { await budget('reset-request', input.email ?? '', meta, 3, 60 * 60_000, 10); } catch (error) { if (error instanceof StaffAuthError) return { ok: true }; throw error; }
      if (!config.sandbox) return { ok: true };
      await withTransaction(db, async tx => {
        const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.email, input.email ?? ''));
        const a = u ? await account(tx, u.id) : null;
        if (!a || !(await active(tx, a))) return;
        const result = await proof(tx, a.userId, 'reset', 30 * 60_000);
        await enqueue(tx, { topic: 'StaffPasswordResetRequested', payload: { userId: a.userId, encryptedProof: encrypt(JSON.stringify({ token: result.token, csrf: result.csrf }), a.userId, 'reset-mail') }, dedupeKey: `staff-reset:${randomUUID()}` });
      });
      return { ok: true };
    },
    async resetConfirm(input: Input, meta: Meta) {
      if (!config.sandbox) throw new StaffAuthError();
      return withProof(input, ['reset'], meta, async (tx, a, _p, now) => {
        if (!(await active(tx, a)) || !validStaffPassword(input.password ?? '')) return denied;
        const totp = input.otp ? await useTotp(tx, a, input.otp, now) : false;
        const code = input.code ? await useCode(tx, a.userId, input.code, now) : false;
        if (!totp && !code) return denied;
        await tx.update(users).set({ passwordHash: await hashPassword(input.password!) }).where(eq(users.id, a.userId));
        await invalidate(tx, a.userId, now);
        await audit(tx, a.userId, 'staff.password.reset', meta, true);
        // Mailbox + saved code enters restricted rebinding; never a normal session.
        return code ? { ...await proof(tx, a.userId, 'rebind', 5 * 60_000), rebind: true } : { ok: true };
      });
    },
    async own(operation: 'reauth' | 'password' | 'factor' | 'codes' | 'logout', token: string, input: Input, meta: Meta) {
      const [lookup] = await db.select({ userId: sessions.userId }).from(sessions).where(and(eq(sessions.tokenHash, secretHash(token)), eq(sessions.context, 'staff')));
      if (!sameSecret(sessionCsrf(token, config.key), input.csrf ?? '')) throw new StaffAuthError(403);
      const reservedWindow = operation !== 'logout' ? await budget('mfa', lookup?.userId ?? secretHash(token), meta) : null;
      const result = await withTransaction(db, async tx => {
        if (!lookup) return denied;
        const a = await account(tx, lookup.userId);
        if (!a || !(await active(tx, a))) return denied;
        const [s] = await tx.select().from(sessions).where(and(eq(sessions.tokenHash, secretHash(token)), eq(sessions.context, 'staff'))).for('update');
        const now = await nowAt(tx);
        if (!s || s.revokedAt || !s.authenticatedAt || s.expiresAt <= now || s.idleExpiresAt <= now) return denied;
        if (operation === 'logout') {
          await tx.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, s.id));
          await audit(tx, a.userId, 'staff.logout', meta); return { ok: true };
        }
        if (operation === 'password' && !validStaffPassword(input.newPassword ?? '')) return denied;
        if (!(await verifyPassword(input.password ?? '', a.passwordHash)) || !(await useTotp(tx, a, input.otp ?? '', now))) return denied;
        if (operation === 'reauth') {
          const next = secretToken();
          await tx.update(sessions).set({ tokenHash: secretHash(next), authenticatedAt: now, lastSeenAt: now, idleExpiresAt: new Date(Math.min(s.expiresAt.getTime(), now.getTime() + STAFF_SESSION_POLICY.idleMs)) }).where(eq(sessions.id, s.id));
          await audit(tx, a.userId, 'staff.session.rotated', meta);
          return { token: next, csrf: sessionCsrf(next, config.key), expiresAt: s.expiresAt, sessionId: s.id };
        }
        if (operation === 'password') {
          await tx.update(users).set({ passwordHash: await hashPassword(input.newPassword!) }).where(eq(users.id, a.userId));
          await invalidate(tx, a.userId, now); await audit(tx, a.userId, 'staff.password.changed', meta, true); return { ok: true };
        }
        if (operation === 'codes') {
          const codes = await newCodes(tx, a.userId);
          await invalidate(tx, a.userId, now); await audit(tx, a.userId, 'staff.recovery-codes.renewed', meta, true); return { codes, ok: true };
        }
        await audit(tx, a.userId, 'staff.factor-change.begun', meta, true);
        return { ...await proof(tx, a.userId, 'factor', 5 * 60_000), rebind: true };
      });
      if (reservedWindow && !('denied' in result) && lookup) await releaseStaffAccountAttempt(db, 'mfa:account', lookup.userId, reservedWindow);
      if ('denied' in result) await recordDenied(token, meta, lookup?.userId);
      return finish(result);
    },
  };
}
