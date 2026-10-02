import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/database/test/*.integration.test.ts',
      'services/api/test/*.integration.test.ts',
    ],
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
