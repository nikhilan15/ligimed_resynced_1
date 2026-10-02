import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/.next/**',
      '**/coverage/**',
      '**/dist/**',
      'eslint.config.mjs',
      '**/generated/**',
      '**/node_modules/**',
      'infrastructure/scripts/read-dev-otp.mjs',
      '**/postcss.config.mjs',
      'outputs/**',
      'work/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
  {
    // Prisma's generated client is intentionally excluded from linting. The project service cannot
    // resolve its operation result types while linting this executable seed script, although tsc
    // validates the same file. Keep the narrow exception here rather than weakening application code.
    files: ['packages/database/src/seed.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
);
