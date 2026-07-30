import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Domain packages are pure TypeScript and run headlessly — no browser, no DOM.
    // Application-level tests (React, E2E) arrive in Sprint 2 with their own config.
    include: ['packages/*/src/**/*.test.ts'],
    // The PDF renderer embeds and subsets a 2.7 MB Korean font twice per case, so its
    // suite is slower than a geometry test. Generous, but not unbounded: a hang is a bug.
    testTimeout: 30_000,
    reporters: ['default'],
  },
});
