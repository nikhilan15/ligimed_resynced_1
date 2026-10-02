import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DevelopmentOtpProvider } from './otp-provider.js';

/** Private filesystem delivery only: no HTTP reader and no operational log output. */
export function createDevelopmentOtpInbox(directory: string) {
  return new DevelopmentOtpProvider(async (request) => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    for (const name of await readdir(directory)) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      const path = join(directory, name);
      if (Date.now() - (await stat(path)).mtimeMs > 15 * 60_000) await rm(path);
    }
    await writeFile(
      join(directory, `${request.challengeId}.json`),
      JSON.stringify({
        ...request,
        expiresAt: new Date(Date.now() + request.expiresInSeconds * 1000).toISOString(),
      }),
      { mode: 0o600, flag: 'wx' },
    );
  });
}
