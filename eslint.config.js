// Flat ESLint config. TypeScript files are linted with full type information.
// JS files and *.config.ts are linted without types (they belong to no tsconfig).
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['**/dist/', '**/coverage/', '**/playwright-report/', '**/test-results/']),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Numbers in template literals are fine; the other strict defaults stay on.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // A leading underscore marks something as intentionally unused, e.g. Express's
      // 4-argument error handler or `const { dropped: _dropped, ...rest } = obj`.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    // Browser code: the Rules of Hooks, plus browser globals.
    files: ['apps/web/**/*.{ts,tsx}'],
    ignores: ['apps/web/*.config.ts'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },
  {
    // Fast Refresh needs component files to export only components. Tests are exempt.
    files: ['apps/web/src/**/*.tsx'],
    ignores: ['**/*.test.tsx', 'apps/web/src/testing/**'],
    extends: [reactRefresh.configs.vite],
  },
  {
    files: ['**/*.{js,mjs,cjs}', '**/*.config.ts'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  prettier,
);
