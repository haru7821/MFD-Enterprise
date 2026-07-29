import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.d.ts'],
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
    files: ['packages/cad-engine/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-dom', 'konva', 'react-konva', '@nestjs/*', 'node:*'],
              message:
                'cad-engine is the framework-free domain core. Put renderer or server code in apps/ instead.',
            },
          ],
        },
      ],
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
