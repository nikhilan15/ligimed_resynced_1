import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

import { defineConfig } from 'prisma/config';

const environmentFile = new URL('.env', import.meta.url);
if (existsSync(environmentFile)) loadEnvFile(environmentFile);
const databaseUrl = process.env['DATABASE_URL'];

export default defineConfig({
  schema: 'database/prisma/schema.prisma',
  migrations: {
    path: 'database/migrations',
    seed: 'pnpm --filter @ligimed/database db:seed',
  },
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
});
