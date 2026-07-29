import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Domain packages are pure TypeScript and run headlessly — no browser, no DOM.
    // Application-level tests (React, E2E) arrive in Sprint 2 with their own config.
    include: ['packages/*/src/**/*.test.ts'],
    reporters: ['default'],
  },
});
