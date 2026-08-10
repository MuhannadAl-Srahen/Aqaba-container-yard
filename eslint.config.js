import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['node_modules/**', 'dist/**', 'data/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // The dev-time decoder runs under plain node: its globals are node's.
    files: ['tools/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', Buffer: 'readonly', console: 'readonly' } },
  },
  {
    rules: {
      // Project rules, not style preferences: no `any`, no escape hatches,
      // no dead code left behind.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
