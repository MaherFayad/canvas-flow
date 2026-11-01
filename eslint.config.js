// ESLint flat config for the whole monorepo: `pnpm lint` (runs in CI).
// Pragmatic on purpose: syntax-level typescript-eslint rules (no type-aware
// linting, so it stays fast) plus React hooks rules where React is used.
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '.claude/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/.output/**',
      '**/.wxt/**',
      '**/coverage/**',
      'e2e/test-results/**',
      'e2e/playwright-report/**',
      'apps/extension/scripts/out/**',
      'packages/sdk/.vite-test-*/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // `_`-prefixed names are intentionally unused (destructuring, callbacks).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
      // Empty catch blocks carry a comment where they matter; allow them.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // `cond && fn()` and ternary calls are an accepted idiom in event handlers here.
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
      // New in ESLint 10; flags defensive initialisers. Warn, do not block.
      'no-useless-assignment': 'warn',
    },
  },
  {
    files: ['**/*.{tsx,jsx}', 'packages/sdk/src/react.ts', 'apps/**/hooks/**/*.ts', 'apps/demo/src/lib/**/*.ts'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Plain Node scripts (CommonJS and ESM).
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Tests and e2e drive untyped debug handles (window.__fc) and fixtures.
    files: ['**/*.test.{ts,tsx}', 'packages/*/test/**/*.ts', 'e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // Owned by the extension UI work in progress: report unused code as a
    // warning there instead of failing CI (follow-ups listed in the PR).
    files: ['apps/extension/components/**', 'apps/extension/store/**', 'apps/extension/lib/canvas/**', 'apps/extension/scripts/**'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
      // `(a = x), (b = y);` comma statements are used in a few handlers.
      '@typescript-eslint/no-unused-expressions': ['warn', { allowShortCircuit: true, allowTernary: true }],
    },
  },
);
