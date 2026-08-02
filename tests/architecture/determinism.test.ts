import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

/**
 * Nothing this project generates may depend on the machine that generated it.
 *
 * `knowledge/`, `corpus.json` and every signed report are committed artefacts: they are diffed,
 * reviewed and quoted in documents. If regenerating one on a different machine changes its bytes,
 * a reviewer cannot tell a real change from a change of laptop.
 *
 * ## Why this is a repo-wide ban and not a comment
 *
 * `packages/ai-local/src/candidates.ts` has said since it was written that *"`localeCompare` would
 * depend on the runtime's locale data — the same code producing a different ranking on a different
 * machine is precisely what determinism forbids"*. It was still used in five other places, and one
 * of them — `aggregate.ts` — carried the words *"the sort is the determinism"* directly above it.
 *
 * That was not a latent risk. Replacing it moved **171 lines** of
 * `knowledge/derived/common-dimension.json`, because the corpus contains `_reference/30대_sample.pdf`
 * and pairs like `Hospital_023/dialysis_25bed.pdf` against its `_2` twin — ICU gives `_` a variable
 * weight, codepoint order does not. The committed knowledge base had been ordered by whatever locale
 * last built it.
 *
 * Knowing the rule in one file did not enforce it. This does.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The source with comments removed.
 *
 * Both bans below matched prose on their first run: `document-model/src/history.ts` and
 * `scripts/verify-drawing.ts` were reported as calling `Date.now()` when each merely *explains why
 * it does not*. A guard that fires on the documentation of the rule it enforces is worse than no
 * guard — it trains whoever hits it to add an exception.
 *
 * Same helper shape as `independence.test.ts`, which learned this earlier.
 */
function code(path: string): string {
  return readFileSync(join(REPO, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

/** Every shipped TypeScript source: production code, not tests, not fixtures, not benchmarks. */
function shippedSources(): string[] {
  const listed = execFileSync('git', ['ls-files', '*.ts', '*.tsx'], {
    cwd: REPO,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);

  return listed.filter(
    (path) =>
      !path.includes('/fixtures/') &&
      !path.endsWith('.test.ts') &&
      !path.endsWith('.test.tsx') &&
      !path.endsWith('.bench.ts') &&
      !path.startsWith('tests/'),
  );
}

describe('generated artefacts do not depend on the machine that generated them', () => {
  const sources = shippedSources();

  it('has sources to check', () => {
    /*
     * The size, asserted first. An empty list would make the sweep below pass while checking
     * nothing, which is the failure mode this repository keeps finding in its own guards — three
     * times in `verification.test.ts` alone.
     */
    expect(sources.length).toBeGreaterThan(50);
  });

  it('no shipped source orders anything with localeCompare', () => {
    /*
     * `String.prototype.localeCompare` with no explicit locale reads the runtime's. Two machines,
     * two orders, and the diff of a committed artefact stops meaning what it appears to mean.
     *
     * There is no allowlist. If a genuinely user-facing, locale-aware ordering is ever needed — a
     * list sorted for a Korean reader in the UI, say — it will not be in code that writes an
     * artefact, and this test should be given an explicit exception naming that file and saying so.
     * Until then an exception would be the hole rather than the rule.
     */
    const offenders = sources.filter((path) => /\.localeCompare\s*\(/.test(code(path)));

    expect(offenders).toEqual([]);
  });

  /**
   * The **one** place allowed to read a clock, named rather than pattern-matched.
   *
   * Not an escape hatch — the assertion is equality, so this list is also a claim that no *second*
   * clock boundary exists. `apps/web/src/editor/clock.ts` is the editor's, and it is the right
   * shape: reducers must stay pure because React invokes them twice in development, so the
   * timestamp is taken at the call site and travels in the action.
   */
  const CLOCK_BOUNDARIES = ['apps/web/src/editor/clock.ts'];

  it('reads the wall clock in exactly one declared place, and rolls no dice anywhere', () => {
    /*
     * The same failure as the sort, with a different cause: `Date.now()`, argless `new Date()` and
     * `Math.random()` make a re-run differ from the run before it on the *same* machine.
     *
     * Timestamps do legitimately reach these artefacts — `validatedAt`, `lastUpdated` — but as
     * arguments (`--now`, `meta.validatedAt`), so a re-run with the same inputs produces the same
     * bytes. The ban is on *reading* a clock, not on recording a time.
     *
     * Written as an equality against the declared list rather than a subset check: a subset would
     * let a second clock appear silently, and one clock is the architecture. Anyone adding another
     * has to come here and say which it is.
     */
    const clocks = sources.filter((path) =>
      /\bDate\.now\s*\(|\bnew\s+Date\s*\(\s*\)/.test(code(path)),
    );
    expect(clocks).toEqual(CLOCK_BOUNDARIES);

    // Randomness has no boundary at all: nothing here should ever need it.
    expect(sources.filter((path) => /\bMath\.random\s*\(/.test(code(path)))).toEqual([]);
  });
});

describe('the sweep reaches the code that writes artefacts', () => {
  it('names each area rather than counting them', () => {
    /*
     * A count would pass while the sweep quietly stopped reaching a package — and the counts in
     * this repository have been wrong twice this week. These four are the ones whose output is
     * committed and diffed, so a sweep that no longer sees one of them is the failure worth
     * catching.
     */
    const reached = new Set(
      shippedSources().map((path) => path.split('/').slice(0, 2).join('/')),
    );

    for (const area of [
      'packages/layout-knowledge',
      'packages/report-engine',
      'packages/ai-local',
      'scripts/lib',
    ]) {
      expect([...reached], area).toContain(area);
    }
  });
});
