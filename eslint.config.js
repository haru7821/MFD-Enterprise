import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // Flat config does not read .gitignore, so generated output has to be named here as
    // well. Enabling the Playwright html reporter made this necessary: its bundled trace
    // viewer is minified JavaScript, and linting it produced four thousand errors in
    // somebody else's code.
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.d.ts',
      'playwright-report/**',
      'test-results/**',
      'blob-report/**',
      'coverage/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  /*
   * Architectural boundary, enforced by the linter rather than by memory.
   *
   * CLAUDE.md: "Every module must be independent." cad-engine is the domain core —
   * it must stay runnable in a browser, a server and a test runner, which means it
   * may not reach for a UI framework, a renderer or a Node built-in.
   */
  {
    files: ['packages/*/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-dom', 'konva', 'react-konva', '@nestjs/*', 'node:*'],
              message:
                'packages/ holds the framework-free domain core. Put renderer or server code in apps/ instead.',
            },
          ],
        },
      ],
    },
  },

  /*
   * One narrow exemption: a **test** may read a fixture file from disk.
   *
   * The rule above is about shipped code — a package that imports node:fs is a package that
   * runs in exactly one of the three places this architecture requires. A test is not shipped,
   * and the PDF renderer's test has to get 5 MB of font bytes from somewhere. The renderer
   * itself still takes bytes as an argument, which is the property the rule exists to protect,
   * and `no-restricted-imports` cannot express "except for the argument".
   *
   * Scoped to test files so it cannot quietly widen: a non-test file under packages/ that
   * imports node:fs still fails.
   */
  {
    files: ['packages/*/**/*.test.ts'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-dom', 'konva', 'react-konva', '@nestjs/*'],
              message:
                'packages/ holds the framework-free domain core. Put renderer or server code in apps/ instead.',
            },
          ],
        },
      ],
    },
  },

  /*
   * The service worker runs in a worker scope, not a window: `self`, `caches` and `clients`
   * exist and `document` and `window` do not. Given its own config rather than being added to
   * the browser globals, so a *component* reaching for `caches` still fails.
   */
  {
    files: ['apps/web/public/sw.js'],
    languageOptions: {
      globals: { ...globals.serviceworker },
    },
  },

  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  {
    files: ['**/*.config.{js,ts}', 'apps/web/vite.config.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
);
