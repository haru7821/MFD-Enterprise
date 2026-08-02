import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

/**
 * A committed artefact must be what its generator produces today.
 *
 * ## The failure this exists for, which was mine and two commits old
 *
 * `6290635` changed `scripts/extract-observations.ts` from `localeCompare` to codepoint order — and
 * did not regenerate `knowledge/observations/`. The committed file kept its old, locale-derived
 * order, so for two commits the artefact and the code that writes it disagreed. Every test stayed
 * green, because nothing compared them.
 *
 * It surfaced only by accident: running the extractor twice while auditing something else changed
 * the file on the first run and not the second. That is not a detection mechanism.
 *
 * ## Why the ordering rule, not a full regeneration
 *
 * `extract-observations.ts` and `validate-corpus.ts` are top-level scripts that do their work at
 * import time, so a test cannot invoke them without side effects, and `validate-corpus` needs a
 * dataset that is not in this repository. What *is* checkable here is the property the generator
 * guarantees — the order it writes in — and that is what drifted.
 *
 * The derived knowledge base has a stronger guard already (`knowledge.test.ts` rebuilds it from the
 * observations and compares byte for byte), which is why the drift stopped at `observations/`.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function observationFiles(): string[] {
  return execFileSync('git', ['ls-files', 'knowledge/observations/*.json'], {
    cwd: REPO,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
}

describe('committed observations are in the order their generator writes', () => {
  const files = observationFiles();

  it('has observation files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(observationFiles())('%s is sorted by observation id, by codepoint', (file) => {
    /*
     * The exact rule in `scripts/extract-observations.ts`. Codepoint rather than `localeCompare`,
     * for the reason `tests/architecture/determinism.test.ts` bans the latter outright — and the
     * committed file was in the *other* order, which is what this catches.
     */
    const parsed = JSON.parse(readFileSync(join(REPO, file), 'utf8')) as {
      observations: { id: string }[];
    };
    const ids = parsed.observations.map((observation) => observation.id);

    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toEqual([...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it.each(observationFiles())('%s records each observation once', (file) => {
    /*
     * > Owner rule: *"Audit whether identical engineering evidence can enter through different
     * > routes … Count observations, never files."*
     *
     * Two checks, because they fail differently. A repeated **id** is a generator that emitted the
     * same record twice. A repeated **(drawing, page, value)** with different ids is the same
     * reading entering by two routes — the shape that made `station_pitch` claim 117 drawings of
     * support over 71 sheets, one level down.
     *
     * Both are zero today, measured. Asserted so that stays a fact rather than an assumption.
     */
    const parsed = JSON.parse(readFileSync(join(REPO, file), 'utf8')) as {
      observations: {
        id: string;
        source: { drawing: { drawingId: string; page: number } };
        value: unknown;
      }[];
    };

    const ids = parsed.observations.map((observation) => observation.id);
    expect(ids.length - new Set(ids).size, 'repeated observation ids').toBe(0);

    const readings = parsed.observations.map((observation) =>
      JSON.stringify([
        observation.source.drawing.drawingId,
        observation.source.drawing.page,
        observation.value,
      ]),
    );
    expect(
      readings.length - new Set(readings).size,
      'the same reading on the same page recorded twice',
    ).toBe(0);
  });
});
