import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

/**
 * Browser validation.
 *
 * Runs against a **production build**, not the dev server: React's development
 * build carries overhead that would make the performance assertions meaningless
 * and hides bundling mistakes the users would actually hit.
 *
 * These specs run in their own CI workflow (.github/workflows/browser.yml) rather
 * than the fast one, because installing a browser costs minutes and the
 * typecheck/lint/unit gate should stay under a minute.
 */
export default defineConfig({
  // Only the e2e specs. Frame-time measurement lives in tests/perf and is run on
  // demand (`pnpm test:perf`): frame times on a shared runner are noisy enough that
  // asserting on them would produce a flaky gate, and a flaky gate gets muted.
  testDir: process.env['MFD_PERF'] ? './tests/perf' : './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  // One worker on CI so the shared preview server is not raced; locally, default.
  // Spread rather than pass undefined — exactOptionalPropertyTypes treats an
  // explicit undefined as a value, not as "absent".
  ...(process.env['CI'] ? { workers: 1 } : {}),
  // Owner decision: Browser CI reports **PASS/FAIL and execution time, and nothing else**.
  // `./tests/summaryReporter.ts` prints those two lines; `html` writes the report that
  // browser.yml uploads on failure, which is where the detail lives now that the log does
  // not carry it. The `github` reporter was dropped with `list` — its inline annotations
  // are the same detail in a different place.
  //
  // Locally `list` stays: a developer running the suite wants to see it progress.
  reporter: process.env['CI']
    ? [['html', { open: 'never' }], ['./tests/summaryReporter.ts']]
    : [['list']],

  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Wide enough that the canvas keeps room between the equipment palette
        // and the findings panel; the specs place objects relative to the canvas,
        // but a cramped viewport leaves nowhere to drag to.
        viewport: { width: 1600, height: 900 },
        // Escape hatch for sandboxes that ship a pre-installed browser at a
        // version Playwright did not download. CI leaves this unset and uses the
        // browser it installed itself.
        ...(process.env['CHROMIUM_PATH']
          ? { launchOptions: { executablePath: process.env['CHROMIUM_PATH'] } }
          : {}),
      },
    },
  ],

  /*
   * Refuse to run against a bundle older than the source — see `tests/freshBuild.ts`.
   *
   * `vite preview` serves the built `dist` and `reuseExistingServer` keeps a stale one alive, so
   * without this a source change that was never built is simply invisible to every spec below.
   */
  globalSetup: './tests/freshBuild.ts',

  webServer: {
    command: `pnpm --filter @mfd/web preview --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
