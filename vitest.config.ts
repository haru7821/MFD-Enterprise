import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Mirrors apps/web/vite.config.ts's own alias — apps/web's pure-logic modules import through
    // it (e.g. `@/editor/editorState`), and a test importing one of those modules needs it to
    // resolve the same way the app itself does.
    alias: {
      '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)),
    },
  },
  test: {
    // Domain packages are pure TypeScript and run headlessly — no browser, no DOM. apps/web's own
    // component tests still belong to Playwright (browser.yml) — this only reaches its pure-logic
    // modules (the solver adapter, not React), which have no UI to render and nothing this config
    // doesn't already provide.
    include: ['packages/*/src/**/*.test.ts', 'apps/web/src/**/*.test.ts'],
    // The PDF renderer embeds and subsets a 2.7 MB Korean font twice per case, so its
    // suite is slower than a geometry test. Generous, but not unbounded: a hang is a bug.
    testTimeout: 30_000,
    reporters: ['default'],
  },
});
