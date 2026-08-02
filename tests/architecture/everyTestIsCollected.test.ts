import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Every test file this repository tracks is actually run.
 *
 * The failure this exists for has happened here: `scripts/**` was absent from vitest's `include`,
 * so `scripts/lib/validateDrawing.ts` could be mutated — every `drawing_error` reclassified as
 * `extraction_error` — with the whole suite green, because a test written there would never have
 * been collected. The fix at the time was to add one glob. That is a fix for one directory, not for
 * the class.
 *
 * A test that is never collected is indistinguishable from a test that always passes, and neither
 * `pnpm test`'s output nor a green CI badge can tell you which you have.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function tracked(): string[] {
  return execFileSync('git', ['ls-files', '*.test.ts', '*.test.tsx'], { cwd: REPO, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .sort();
}

describe('vitest collects every test file in the repository', () => {
  const files = tracked();

  it('finds test files to check', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('collects all of them', () => {
    /*
     * Asked of vitest rather than re-implemented against its glob syntax — a second matcher here
     * would answer about itself rather than about the runner, and mine got this wrong once already
     * while writing this file: a hand-rolled glob-to-regex reported five `apps/web` tests as
     * uncollected when vitest was running all of them.
     */
    const collected = new Set(
      execFileSync('npx', ['vitest', 'list', '--filesOnly'], { cwd: REPO, encoding: 'utf8' })
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => (line.startsWith(REPO) ? line.slice(REPO.length + 1) : line)),
    );

    expect(files.filter((file) => !collected.has(file))).toEqual([]);
  });
});
