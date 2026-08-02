import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Every published figure, recomputed **without the code that published it**.
 *
 * `knowledge.test.ts` already asserts the derived files regenerate byte for byte — but it does that
 * by calling `aggregate()`, the very function that wrote them. That guard catches a corrupted
 * artefact and cannot catch a changed *rule*: alter the median to an average and the artefact and
 * the test move together, both green, and the number an engineer reads has quietly changed meaning.
 *
 * So this file re-derives the figures from `knowledge/observations/` with a second implementation,
 * written from the documented rules rather than imported:
 *
 * - **median** is the *lower* of the two middle readings, never their average — an average of 1,800
 *   and 1,900 is 1,850, a number no drawing showed;
 * - **plans** collapses `.dwg`/`.pdf` twins (owner decision D15);
 * - **facilities** counts the leading path segment (D6);
 * - the sample is deduplicated by **plan and value**, so one sheet recording two genuinely different
 *   runs keeps both.
 *
 * A second implementation is normally the thing this project removes. It is right here for the same
 * reason a verification record is checked by arithmetic rather than by the pipeline that produced
 * it: the point is precisely to not ask the same code the same question twice.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE = join(HERE, '..', '..', '..', 'knowledge');

interface Observation {
  readonly source: { readonly drawing: { readonly drawingId: string } };
  readonly value: { readonly kind: string; readonly name?: string; readonly millimetres?: number | null };
}

function observations(): Observation[] {
  const directory = join(KNOWLEDGE, 'observations');
  return readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .flatMap(
      (name) =>
        (JSON.parse(readFileSync(join(directory, name), 'utf8')) as { observations: Observation[] })
          .observations,
    );
}

/** Everything up to the extension — one plan, however many formats it was exported in. */
function planOf(drawingId: string): string {
  const dot = drawingId.lastIndexOf('.');
  const slash = drawingId.lastIndexOf('/');
  return dot > slash ? drawingId.slice(0, dot) : drawingId;
}

/** The leading path segment — one hospital. */
function facilityOf(drawingId: string): string {
  const slash = drawingId.indexOf('/');
  return slash === -1 ? drawingId : drawingId.slice(0, slash);
}

describe('the published dimension figures follow from the observations', () => {
  const derived = JSON.parse(
    readFileSync(join(KNOWLEDGE, 'derived', 'common-dimension.json'), 'utf8'),
  ) as {
    entries: {
      subject: string;
      distribution: { minimum: number; median: number; maximum: number } | null;
      support: { plans: number; facilities: number; observations: number; sources: unknown[] };
    }[];
  };

  const all = observations().filter((entry) => entry.value.kind === 'common_dimension');

  it('has observations and entries to check', () => {
    // Both sides non-empty, or every assertion below is a comparison of two nothings.
    expect(all.length).toBeGreaterThan(100);
    expect(derived.entries.length).toBeGreaterThan(0);
  });

  it.each(
    JSON.parse(readFileSync(join(KNOWLEDGE, 'derived', 'common-dimension.json'), 'utf8'))
      .entries.map((entry: { subject: string }) => entry.subject) as string[],
  )('%s: median, range, plans, facilities and observation count all re-derive', (subject) => {
    const entry = derived.entries.find((candidate) => candidate.subject === subject)!;
    const members = all.filter((observation) => observation.value.name === subject);

    expect(members.length, `${subject} has no observations behind it`).toBeGreaterThan(0);

    // The sample: one reading per (plan, value), which is what D6 settled.
    const seen = new Set<string>();
    const values: number[] = [];
    for (const observation of members) {
      const millimetres = observation.value.millimetres;
      if (millimetres === null || millimetres === undefined) continue;
      const key = `${planOf(observation.source.drawing.drawingId)}#${millimetres}`;
      if (seen.has(key)) continue;
      seen.add(key);
      values.push(millimetres);
    }
    values.sort((a, b) => a - b);

    // The lower middle reading. `(n - 1) / 2` floored, so an even sample takes the lower of the two.
    const median = values[Math.floor((values.length - 1) / 2)];

    expect(entry.distribution?.median, `${subject} median`).toBe(median);
    expect(entry.distribution?.minimum, `${subject} minimum`).toBe(values[0]);
    expect(entry.distribution?.maximum, `${subject} maximum`).toBe(values[values.length - 1]);

    expect(entry.support.plans, `${subject} plans`).toBe(
      new Set(members.map((observation) => planOf(observation.source.drawing.drawingId))).size,
    );
    expect(entry.support.facilities, `${subject} facilities`).toBe(
      new Set(members.map((observation) => facilityOf(observation.source.drawing.drawingId))).size,
    );
    expect(entry.support.observations, `${subject} observations`).toBe(members.length);
  });

  it('accounts for every observation in the corpus, with none counted twice', () => {
    /*
     * The figures could each re-derive while the *set* of entries silently dropped a subject. Every
     * `common_dimension` observation belongs to exactly one entry, so the counts must sum to the
     * corpus — no orphans on either side.
     */
    const published = derived.entries.reduce((sum, entry) => sum + entry.support.observations, 0);
    expect(published).toBe(all.length);
  });

  it('names a real drawing for every source it cites', () => {
    /*
     * A figure whose evidence points at a file the catalogue no longer lists is a number with no
     * source, however arithmetically correct it is.
     */
    const catalogued = new Set(
      (
        JSON.parse(readFileSync(join(KNOWLEDGE, 'dataset.json'), 'utf8')) as {
          drawings: { drawingId: string }[];
        }
      ).drawings.map((drawing) => drawing.drawingId),
    );

    const dangling = derived.entries.flatMap((entry) =>
      (entry.support.sources as { drawingId: string }[])
        .map((source) => source.drawingId)
        .filter((drawingId) => !catalogued.has(drawingId)),
    );

    expect(dangling).toEqual([]);
  });
});
