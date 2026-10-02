import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
if (process.env.NODE_ENV === 'production' || process.env.OTP_PROVIDER !== 'development') {
  throw new Error('Local OTP delivery is only available with the development provider.');
}
const phone = process.argv.slice(2).find((value) => /^\+91[6-9]\d{9}$/.test(value));
if (!phone) throw new Error('Usage: pnpm auth:otp -- +91 followed by your 10-digit mobile number');
const directory = join(root, '.local/otp');
const messages = [];
for (const name of existsSync(directory) ? await readdir(directory) : []) {
  if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
  const item = JSON.parse(await readFile(join(directory, name), 'utf8'));
  if (item.phoneNumber === phone && Date.parse(item.expiresAt) > Date.now()) messages.push(item);
}
messages.sort((a, b) => Date.parse(b.expiresAt) - Date.parse(a.expiresAt));
if (!messages[0]) {
  console.log('No unexpired development code found. Request a code in the Pharmacy app first.');
} else {
  console.log(`Development-only code: ${messages[0].code} (expires ${messages[0].expiresAt})`);
}
