import { generateSync } from 'otplib';
import fs from 'node:fs';
import path from 'node:path';

const credsPath = path.resolve('.local/dev-owner-credentials.json');
if (!fs.existsSync(credsPath)) {
  console.error('Credentials file not found.');
  process.exit(1);
}

const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
const currentEpoch = Math.floor(Date.now() / 30_000) * 30;
const otp = generateSync({ secret: creds.seed, epoch: currentEpoch });
const remainingSeconds = 30 - (Math.floor(Date.now() / 1000) % 30);

console.log(`\n========================================`);
console.log(`Staff Email : ${creds.email}`);
console.log(`Password    : ${creds.password}`);
console.log(`Current OTP : ${otp} (Valid for ${remainingSeconds} seconds)`);
console.log(`========================================\n`);

