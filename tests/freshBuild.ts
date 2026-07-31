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

/**
 * Everything a change to which must reach the bundle before a spec can mean anything.
 *
 * Source trees **and** the files that configure or feed the build. The first version watched only
 * source, and the review found the hole: `platform.spec.ts` fetches `/sw.js` out of `dist` and
 * asserts its *contents*, so an unbuilt service-worker edit is exactly the stale-build false pass
 * this exists to close — and `apps/web/index.html`, `vite.config.ts` and the lockfile all change
 * the bundle without any file under `src` moving.
 */
const WATCHED = [
  join(REPO, 'apps/web/src'),
  join(REPO, 'apps/web/public'),
  join(REPO, 'apps/web/index.html'),
  join(REPO, 'apps/web/vite.config.ts'),
  join(REPO, 'packages'),
  join(REPO, 'standards'),
  join(REPO, 'knowledge'),
  join(REPO, 'pnpm-lock.yaml'),
];

const DIST = join(REPO, 'apps/web/dist');

/**
 * Directories that hold no build input and can be large.
 *
 * Named rather than pattern-matched, and dotfiles are **not** skipped: an earlier version ignored
 * every name beginning with `.`, which would have quietly excluded a future `.env` — a file whose
 * whole purpose is to change what the build produces.
 */
const SKIP = new Set(['node_modules', 'dist', '.turbo', '.git', 'coverage']);

/** The newest modification anywhere under a path, whether it is a file or a directory. */
function newestModification(path: string): number {
  let stats;
  try {
    stats = statSync(path);
  } catch {
    // A watched path that does not exist cannot be newer than the build. A file that vanished
    // between listing and stat is the same case; neither is the same as ignoring a real change.
    return 0;
  }

  if (!stats.isDirectory()) return stats.mtimeMs;

  let newest = stats.mtimeMs;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    newest = Math.max(newest, newestModification(join(path, entry.name)));
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
