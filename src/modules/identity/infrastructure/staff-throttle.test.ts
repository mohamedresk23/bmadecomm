import { beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { setupTestDb, withIsolatedTx } from '../../../test-utils/db';
import { staffAuthBuckets } from '../../../db/schema';
import { consumeStaffBudget, releaseStaffAccountAttempt } from './staff-throttle';
import { secretHash } from './staff-crypto';
beforeAll(setupTestDb);
it('a successful operation in an old window cannot clear a newer failure window', async () => withIsolatedTx(async tx => {
  const identity = randomUUID(), key = `synthetic:account:${secretHash(identity)}`;
  const reserved = await consumeStaffBudget(tx, 'synthetic:account', identity, 5, 1000);
  const nextWindow = new Date(reserved.getTime() + 1000);
  await tx.update(staffAuthBuckets).set({ windowStart: nextWindow, attempts: 5 }).where(eq(staffAuthBuckets.key, key));
  await releaseStaffAccountAttempt(tx, 'synthetic:account', identity, reserved);
  expect((await tx.select().from(staffAuthBuckets).where(eq(staffAuthBuckets.key, key)))[0].attempts).toBe(5);
  await releaseStaffAccountAttempt(tx, 'synthetic:account', identity, nextWindow);
  expect((await tx.select().from(staffAuthBuckets).where(eq(staffAuthBuckets.key, key)))[0].attempts).toBe(4);
}));
