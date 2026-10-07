import { beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { setupTestDb, withIsolatedTx } from '../../../test-utils/db';
import type { DbContext } from '../../../db/tx';
import { users, staffAccounts, roles, userRoles, staffAuthProofs, sessions } from '../../../db/schema';
import { secretHash, secretToken } from './staff-crypto';
import { issueStaffSession, resolveStaffSession, rotateStaffSession } from './staff-sessions';

beforeAll(setupTestDb);
const policy = { idleMs: 60_000, absoluteMs: 120_000 };
async function fixture(tx: DbContext) {
  const userId = randomUUID(), role = randomUUID(), proofToken = secretToken();
  await tx.insert(users).values({ id: userId, name: 'Synthetic identity guard', email: `${userId}@example.test`, phone: '', role: 'staff', passwordHash: 'synthetic-original-hash' });
  await tx.insert(staffAccounts).values({ userId, enabled: true, mfaSeed: 'synthetic-original-encrypted-seed', mfaEnrolledAt: new Date() });
  await tx.insert(roles).values({ key: role }); await tx.insert(userRoles).values({ userId, roleKey: role });
  const session = await issueStaffSession(tx, userId, policy);
  if (!session) throw new Error('Synthetic session missing');
  await tx.insert(staffAuthProofs).values({ id: randomUUID(), userId, purpose: 'login', tokenHash: secretHash(proofToken), csrfHash: secretHash(secretToken()), expiresAt: new Date(Date.now() + 60_000) });
  return { userId, role, proofToken, ...session };
}
async function revoked(tx: DbContext, f: Awaited<ReturnType<typeof fixture>>) {
  expect(await resolveStaffSession(tx, f.token, policy)).toBeNull();
  const [stored] = await tx.select().from(sessions).where(eq(sessions.id, f.sessionId)); expect(stored.revokedAt).not.toBeNull();
  const [proof] = await tx.select().from(staffAuthProofs).where(eq(staffAuthProofs.tokenHash, secretHash(f.proofToken))); expect(proof.consumedAt).not.toBeNull();
}
it('committed direct disable atomically consumes proofs/revokes sessions and reenable cannot resurrect them', async () => withIsolatedTx(async tx => {
  const f = await fixture(tx);
  await tx.update(staffAccounts).set({ enabled: false }).where(eq(staffAccounts.userId, f.userId)); await revoked(tx, f);
  await tx.update(staffAccounts).set({ enabled: true }).where(eq(staffAccounts.userId, f.userId)); await revoked(tx, f);
  expect(await issueStaffSession(tx, f.userId, policy)).not.toBeNull();
}));
it('direct staff password replacement revokes old authority but customer password changes remain isolated', async () => withIsolatedTx(async tx => {
  const f = await fixture(tx), customerId = randomUUID(), customerToken = secretToken(), now = new Date();
  await tx.insert(users).values({ id: customerId, name: 'Synthetic customer', email: `${customerId}@example.test`, phone: '', passwordHash: 'customer-original' });
  await tx.insert(sessions).values({ id: randomUUID(), userId: customerId, context: 'customer', tokenHash: secretHash(customerToken), createdAt: now, expiresAt: new Date(now.getTime() + 60_000), lastSeenAt: now, idleExpiresAt: new Date(now.getTime() + 60_000) });
  await tx.update(users).set({ passwordHash: 'customer-replacement' }).where(eq(users.id, customerId));
  expect((await tx.select().from(sessions).where(eq(sessions.tokenHash, secretHash(customerToken))))[0].revokedAt).toBeNull();
  expect(await resolveStaffSession(tx, f.token, policy)).not.toBeNull();
  await tx.update(users).set({ passwordHash: 'synthetic-replacement-hash' }).where(eq(users.id, f.userId)); await revoked(tx, f);
}));
it('direct factor/enrollment changes revoke but ordinary replay-state touches and unchanged values do not', async () => withIsolatedTx(async tx => {
  const f = await fixture(tx);
  await tx.update(staffAccounts).set({ lastTotpStep: 123 }).where(eq(staffAccounts.userId, f.userId));
  await tx.update(staffAccounts).set({ mfaSeed: 'synthetic-original-encrypted-seed' }).where(eq(staffAccounts.userId, f.userId));
  expect(await resolveStaffSession(tx, f.token, policy)).not.toBeNull();
  await tx.update(staffAccounts).set({ mfaSeed: 'synthetic-replacement-encrypted-seed' }).where(eq(staffAccounts.userId, f.userId)); await revoked(tx, f);
  const second = await fixture(tx);
  await tx.update(staffAccounts).set({ mfaEnrolledAt: new Date(0) }).where(eq(staffAccounts.userId, second.userId)); await revoked(tx, second);
}));
it('new role assignment revokes prior sessions/proofs while an idempotent conflict does not', async () => withIsolatedTx(async tx => {
  const f = await fixture(tx), additionalRole = randomUUID();
  await tx.insert(userRoles).values({ userId: f.userId, roleKey: f.role }).onConflictDoNothing();
  expect(await resolveStaffSession(tx, f.token, policy)).not.toBeNull();
  await tx.insert(roles).values({ key: additionalRole }); await tx.insert(userRoles).values({ userId: f.userId, roleKey: additionalRole }); await revoked(tx, f);
  const fresh = await issueStaffSession(tx, f.userId, policy); expect((await resolveStaffSession(tx, fresh!.token, policy))?.roles).toEqual([f.role, additionalRole].sort());
  await tx.delete(userRoles).where(eq(userRoles.roleKey, additionalRole)); expect((await resolveStaffSession(tx, fresh!.token, policy))?.roles).toEqual([f.role]);
}));
it('changing a role assignment invalidates increased authority and user staff demotion cannot revive a session', async () => withIsolatedTx(async tx => {
  const f = await fixture(tx), replacementRole = randomUUID(); await tx.insert(roles).values({ key: replacementRole });
  await tx.update(userRoles).set({ roleKey: replacementRole }).where(eq(userRoles.userId, f.userId)); await revoked(tx, f);
  const other = await fixture(tx); await tx.update(users).set({ role: 'customer' }).where(eq(users.id, other.userId)); await revoked(tx, other);
  await tx.update(users).set({ role: 'staff' }).where(eq(users.id, other.userId)); await revoked(tx, other);
}));
it('identity guards preserve absolute expiry and do not alter valid session rotations', async () => withIsolatedTx(async tx => {
  const f = await fixture(tx), rotated = await rotateStaffSession(tx, f.token, policy);
  expect(rotated?.expiresAt).toEqual(f.expiresAt); expect(await resolveStaffSession(tx, f.token, policy)).toBeNull(); expect(await resolveStaffSession(tx, rotated!.token, policy)).not.toBeNull();
}));
