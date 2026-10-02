import { defineConfig } from '@playwright/test';

const webServer = [
  {
    command: 'node apps/pharmacy/node_modules/next/dist/bin/next dev apps/pharmacy --port 3000',
    port: 3000,
    reuseExistingServer: true,
  },
  {
    command: 'node apps/dealer/node_modules/next/dist/bin/next dev apps/dealer --port 3001',
    port: 3001,
    reuseExistingServer: true,
  },
  {
    command: 'node apps/transport/node_modules/next/dist/bin/next dev apps/transport --port 3002',
    port: 3002,
    reuseExistingServer: true,
  },
  {
    command: 'node apps/admin/node_modules/next/dist/bin/next dev apps/admin --port 3003',
    port: 3003,
    reuseExistingServer: true,
  },
];

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 2 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: {
    trace: 'on-first-retry',
  },
  ...(process.env['E2E_EXTERNAL_SERVERS'] === 'true' ? {} : { webServer }),
});
