import dotenv from 'dotenv';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { composeStaffAuthentication } from '../src/modules/identity/infrastructure/staff-auth-composition';
import { staffConfig } from '../src/modules/identity/infrastructure/staff-config';
import type { DbContext } from '../src/db/tx';

export async function writeOwnerPackage(directory: string, origin: string, proof: { token?: string; csrf?: string; expiresAt?: Date }) {
  if (!proof.token || !proof.csrf || !proof.expiresAt) throw new Error('Invalid setup package');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') {
    const user = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
    if (!process.env.USERDOMAIN || !process.env.USERNAME) throw new Error('Private Windows account required');
    execFileSync('icacls.exe', [directory, '/inheritance:r', '/grant:r', `${user}:(OI)(CI)F`], { stdio: 'pipe', windowsHide: true });
  }
  const url = new URL('/admin/enroll', origin); url.hash = new URLSearchParams({ token: proof.token, csrf: proof.csrf }).toString();
  const filename = path.join(directory, `${randomUUID()}.json`);
  await writeFile(filename, JSON.stringify({ enrollmentUrl: url.toString(), expiresAt: proof.expiresAt.toISOString(), instruction: 'Open privately within 15 minutes. Choose your own password and confirm TOTP. Save emergency recovery codes offline.' }, null, 2), { flag: 'wx', mode: 0o600 });
  return filename;
}
export async function provisionOwner(db: DbContext, email: string, name: string, directory: string, env = process.env) {
  const input = z.object({ email: z.string().max(512).trim().toLowerCase().pipe(z.email().max(254)), name: z.string().trim().min(1).max(100) }).strict().parse({ email, name });
  const config = staffConfig(env);
  const proof = await composeStaffAuthentication(db, config).provisionOwner(input.email, input.name, { source: 'deliberate-cli', requestId: randomUUID() });
  return writeOwnerPackage(directory, config.origin, proof);
}
if (require.main === module) {
  dotenv.config({ path: '.env.local', quiet: true }); dotenv.config({ path: '.env', quiet: true });
  void (async () => {
    const { db } = await import('../src/db');
    await provisionOwner(db, process.argv[2] ?? '', process.argv[3] ?? '', path.resolve('.local/owner-setup'));
    console.log('First Owner private setup package saved under .local/owner-setup. No setup secret printed.');
  })().then(() => process.exit(0)).catch(() => { console.error('Owner provisioning refused or failed. No existing password, customer or enrolled factor was overwritten.'); process.exit(1); });
}
