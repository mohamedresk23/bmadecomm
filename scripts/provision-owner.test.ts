import { beforeAll, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { setupTestDb, withIsolatedTx } from '../src/test-utils/db';
import { provisionOwner } from './provision-owner';
beforeAll(setupTestDb);
it('creates a private purpose-scoped Owner setup package without exposing password/seed/session', async () => withIsolatedTx(async tx => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'owner-package-test-'));
  try {
    const filename = await provisionOwner(tx, `${randomUUID()}@example.test`, 'Synthetic Owner', directory, { NODE_ENV: 'test', EMAIL_ADAPTER: 'sandbox', APP_URL: 'http://localhost:3000', STAFF_MFA_KEY: randomBytes(32).toString('base64') });
    const content = JSON.parse(await readFile(filename, 'utf8')), url = new URL(content.enrollmentUrl);
    expect(url.pathname).toBe('/admin/enroll'); expect(url.search).toBe(''); expect(new URLSearchParams(url.hash.slice(1)).get('token')).toHaveLength(43);
    expect(content.password).toBeUndefined(); expect(content.seed).toBeUndefined(); expect(content.session).toBeUndefined();
    expect(new Date(content.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(15 * 60_000);
  } finally { await rm(directory, { recursive: true, force: true }); }
}));
