import { expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { setupStaffAccess } from './setup-staff-access';
it('adds an independent key once while preserving customer keys and configured settings', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'staff-key-test-'));
  try {
    const filename = path.join(directory, '.env.local'); await writeFile(filename, 'IDENTITY_TOKEN_KEY=customer-key\nAPP_URL=http://localhost:3000\n');
    setupStaffAccess(filename); const text = await readFile(filename, 'utf8'); expect(text).toContain('IDENTITY_TOKEN_KEY=customer-key'); expect(text).toMatch(/STAFF_MFA_KEY=[A-Za-z0-9+/]{43}=/);
    expect(() => setupStaffAccess(filename)).toThrow(); expect(await readFile(filename, 'utf8')).toBe(text);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
