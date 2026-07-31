import { readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Refuse to run the browser specs against a build older than the source.
 *
 * `playwright.config.ts` serves `apps/web/dist` through `vite preview` — a production build, for
 * the reasons given there — and reuses an already-running server locally. Neither of those is
 * wrong, and together they mean **a source change that was never built is invisible to every
 * spec**: the page under test is the last build, and the suite passes on it.
 *
 * That is not hypothetical. The D1 blocked-state specs passed against a stale bundle before the
 * feature existed in it, and the failure looked exactly like a real answer from the optimiser —
 * `already_best` rather than a crash. It is the same shape as an earlier one in this repository,
 * where a "break the guard" check whose break did not compile reported success from the previous
 * bundle.
 *
 * CI was never exposed: `browser.yml` builds first, and `CI` being set turns off
 * `reuseExistingServer`. This closes it locally, where the specs are actually written.
 *
 * Comparing timestamps rather than rebuilding: a `globalSetup` that ran the build would add it to
 * every `--grep` of a single spec, and a check that takes milliseconds and says *"run pnpm build"*
 * is a better trade than a rebuild nobody asked for.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Source trees whose changes must reach the bundle before a spec can mean anything. */
const WATCHED = [
  join(REPO, 'apps/web/src'),
  join(REPO, 'packages'),
  join(REPO, 'standards'),
  join(REPO, 'knowledge'),
];

const DIST = join(REPO, 'apps/web/dist');

/** Directories that hold no source and can be large. */
const SKIP = new Set(['node_modules', 'dist', '.turbo', 'coverage']);

function newestModification(directory: string): number {
  let newest = 0;
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestModification(path));
      continue;
    }
    try {
      newest = Math.max(newest, statSync(path).mtimeMs);
    } catch {
      // A file that vanished between listing and stat cannot be newer than the build in any
      // sense that matters; skipping it is not the same as ignoring a real source change.
    }
  }
  return newest;
}

export default function assertBuildIsFresh(): void {
  let built: number;
  try {
    built = statSync(join(DIST, 'index.html')).mtimeMs;
  } catch {
    throw new Error(
      'apps/web/dist does not exist. The browser specs run against a production build — run `pnpm build` first.',
    );
  }

  const newestSource = Math.max(...WATCHED.map(newestModification));
  if (newestSource <= built) return;

  throw new Error(
    [
      'apps/web/dist is older than the source it is built from.',
      '',
      'The browser specs would run against the previous bundle, and would pass or fail on code',
      'that is not the code you changed. Run `pnpm build` and try again.',
      '',
      `  built:  ${new Date(built).toISOString()}`,
      `  source: ${new Date(newestSource).toISOString()}`,
    ].join('\n'),
  );
}
