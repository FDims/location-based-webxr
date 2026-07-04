// @ts-check
import { fileURLToPath } from 'node:url';
import globals from 'globals';
import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import vitest from '@vitest/eslint-plugin';
import prettierConfig from 'eslint-config-prettier';

const tsconfigRootDir = fileURLToPath(new URL('..', import.meta.url));
const tsconfigForLint = fileURLToPath(
  new URL('../tsconfig.eslint.json', import.meta.url)
);

export default defineConfig(
  // Base JavaScript recommendations
  eslint.configs.recommended,

  // Shared project defaults
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      curly: 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-extend-native': 'error',
      // WARNING RATCHET (2026-07-04 code-health pass): the lint script runs
      // with `--max-warnings 23` — exactly the current count of `complexity`
      // warnings (acknowledged design debt: reduce a function's complexity
      // when you next touch it, then LOWER the ratchet in package.json). Any
      // NEW warning of any kind now fails the gate instead of scrolling by.
      complexity: ['warn', 10],
      'max-depth': ['warn', 4],
      // App code must consume the closed-source core library only via the
      // curated `gps-plus-slam-app-framework` re-exports. RecorderApp no
      // longer takes a direct dependency on `gps-plus-slam-js` â€” see
      // GpsPlusSlamJs_Docs/docs/2026-05-05-recorder-app-drop-direct-core-dep-plan.md.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'gps-plus-slam-js',
              message:
                "Import core symbols from 'gps-plus-slam-app-framework' (or a subpath like '/state' / '/licensing') instead. The framework curates the public surface of gps-plus-slam-js for app consumers.",
            },
          ],
          patterns: [
            {
              group: ['gps-plus-slam-js/*'],
              message:
                "Import via 'gps-plus-slam-app-framework' subpaths instead of reaching into 'gps-plus-slam-js' submodules. RecorderApp does not take a direct dep on gps-plus-slam-js.",
            },
          ],
        },
      ],
    },
  },

  // Vitest-aware overrides for colocated test files
  {
    files: [
      '**/*.test.{js,ts,tsx,mts,cts}',
      '**/*.spec.{js,ts,tsx,mts,cts}',
      '**/*.property.test.{js,ts}',
    ],
    plugins: {
      vitest,
    },
    languageOptions: {
      globals: {
        ...vitest.environments.env.globals,
      },
    },
    rules: {
      ...vitest.configs.recommended.rules,
      // Allow expect(value, message) 2-argument form (Vitest 1.3+ feature)
      'vitest/valid-expect': ['error', { maxArgs: 2 }],
      // Recognize custom assertion helpers that contain expect() calls
      'vitest/expect-expect': [
        'error',
        {
          assertFunctionNames: [
            'expect',
            'expectNonSerializableDetected',
            'expectMarkDispatchedTimes',
            'expectTypeOf',
          ],
        },
      ],
    },
  },

  // TypeScript-specific rules only run on TypeScript sources
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.cts', '**/*.mts'],
    extends: [
      ...tseslint.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        project: tsconfigForLint,
        tsconfigRootDir,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      // Enforce `import type { Foo }` when only importing types.
      '@typescript-eslint/consistent-type-imports': 'error',
      // Ensure `return await` inside try/catch for proper stack traces;
      // omit elsewhere. Replaces the deprecated base no-return-await.
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],
      // Catch leftover debugging; warn so it doesn't block development.
      'no-console': 'warn',
      // Use the TS version to avoid false positives on enums/types;
      // disable the base rule so reports are not duplicated.
      'no-shadow': 'off',
      '@typescript-eslint/no-shadow': 'error',
    },
  },

  // Allow underscore-prefixed unused params in plain JS files as well
  {
    files: ['**/*.js', '**/*.jsx', '**/*.mjs'],
    rules: {
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },

  // Relax strict TypeScript rules for test files
  // - Vitest matchers (expect.stringContaining, expect.arrayContaining, etc.)
  //   return `any` by design, which triggers unsafe-assignment in objectContaining.
  // - unbound-method fires on the standard vitest assertion pattern
  //   `expect(mock.method).toHaveBeenCalled()` which is NOT an actual unbound
  //   method bug — the reference is only used for spy introspection.
  {
    files: [
      '**/*.test.{ts,tsx,mts,cts}',
      '**/*.spec.{ts,tsx,mts,cts}',
      '**/*.property.test.ts',
    ],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/unbound-method': 'off',
      // vi.hoisted() requires re-declaring variables inside the factory,
      // which triggers no-shadow against the outer destructured bindings.
      '@typescript-eslint/no-shadow': 'off',
      // Test files commonly use console for debugging and test output.
      'no-console': 'off',
    },
  },

  // Ignore generated artefacts, vendor directories, and root config shims
  // that are not part of any tsconfig project (avoids parser errors).
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'reports/**',
      'test-results/**',
      'playwright-report/**',
      '.stryker-tmp/**',
      'node_modules/**',
      'vitest.config.ts',
    ],
  },

  // Disable ESLint rules that conflict with Prettier (must be last)
  prettierConfig
);
