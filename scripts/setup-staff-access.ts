import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { parse } from 'dotenv';
export function setupStaffAccess(filename = '.env.local') {
  const existing = existsSync(filename) ? readFileSync(filename, 'utf8') : '';
  const settings = parse(existing);
  if (Object.hasOwn(settings, 'STAFF_MFA_KEY')) throw new Error('Staff MFA key already configured; refusing overwrite');
  writeFileSync(filename, `${existing}\nSTAFF_MFA_KEY=${randomBytes(32).toString('base64')}\n`, { mode: 0o600 });
  if (process.platform !== 'win32') chmodSync(filename, 0o600);
}
if (require.main === module) {
  try { setupStaffAccess(); console.log('Separate staff MFA key saved privately; no key printed.'); }
  catch { console.error('Staff setup failed; existing keys were preserved.'); process.exitCode = 1; }
}
