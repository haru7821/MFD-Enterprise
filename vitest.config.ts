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
    /*
     * `scripts/**` is here because it was not, and the omission was load-bearing.
     *
     * `scripts/lib` is 1,338 lines that produce every documented corpus number — the 7,402 mm room
     * width, the discrepancy taxonomy, the validation ledger — and the audit found two mutations
     * escaping the entire suite there: `measureRoomWidth` forced to return null, and every
     * `drawing_error` reclassified as `extraction_error`. Neither could be caught, because a test
     * written in `scripts/` would never have been collected.
     */
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/web/src/**/*.test.ts',
      'scripts/**/*.test.ts',
    ],
    // The PDF renderer embeds and subsets a 2.7 MB Korean font twice per case, so its
    // suite is slower than a geometry test. Generous, but not unbounded: a hang is a bug.
    testTimeout: 30_000,
    reporters: ['default'],
  },
});
