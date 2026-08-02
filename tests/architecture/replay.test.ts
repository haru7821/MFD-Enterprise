import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { aggregate } from '../../packages/layout-knowledge/src/aggregate';
import type { Observation } from '../../packages/layout-knowledge/src/schema';
import { buildLedger, type LedgerRow } from '../../scripts/lib/corpusLedger';
import { parseCorpusValidation } from '../../packages/layout-knowledge/src/verification';
import { type RankInput, rankLayouts } from '../../packages/ai-local/src/rank';
import {
  fixtureCatalog,
  fixtureKnowledge,
  fixtureMachine,
  fixtureRoom,
  fixtureRoomBoundary,
  fixtureRuleSet,
} from '../../packages/ai-local/fixtures/index';
import { dialysisScoringModel } from '../../packages/ai-contract/scoring/index';
import { renderRationale } from '../../packages/ai-contract/src/rationale';

/**
 * The same evidence, presented in a different order, must produce the same answer.
 *
 * The static bans in `determinism.test.ts` stop a *known* source of nondeterminism entering the
 * code — `localeCompare`, a clock, a dice roll. They cannot see the one this project has actually
 * shipped twice: a `Map` whose iteration order is its insertion order, feeding a result nobody
 * re-sorted. `frequenciesOf`'s tie-break fell through to insertion order; so did the `unapplied`
 * array; so did the strategy list, by way of a candidate-id format.
 *
 * Each of those was found by reasoning about one function. This is the empirical counterpart:
 * shuffle the inputs and compare the outputs. Shuffling the input **is** shuffling `Map` insertion
 * order, because insertion follows the order the input arrives in — so this reaches every `Map` and
 * `Set` on the paths it exercises without naming any of them.
 *
 * ## What this file does **not** reach, measured rather than assumed
 *
 * Mutation testing while writing it found the limits, and they are worth stating because the file's
 * name promises more than any one test here delivers:
 *
 * - **Either knowledge sort alone can be deleted and every case still passes.** `ordered()` and
 *   `drawingsOf`'s sort are mutually redundant: `drawingsOf` is handed observations `ordered()` has
 *   already sorted, so each masks the loss of the other. Removing **both** fails three cases here
 *   and two in the package. The pair is what is load-bearing; neither sort is, alone.
 * - **Candidate generation order is out of reach from here.** `rankLayouts` takes a room, not a
 *   candidate list, so no caller-side shuffle perturbs it — deleting the sort in
 *   `generateCandidates` leaves every case below green. That path is covered instead by
 *   `rank.test.ts`'s Case C, which feeds `collapseByGeometry` a reversed feasible list directly.
 * - **`tally`'s tie-break is unreachable on real data** (211 / 80 / 15 are distinct counts), and is
 *   covered by a constructed tie in `corpusLedger.test.ts`.
 *
 * ## What is asserted invariant, and what is not
 *
 * Not everything may be order-invariant, and pretending otherwise would be its own overclaim. A
 * ledger's rows are written in catalogue order and that order is *meant* to survive; what must not
 * depend on it are the totals and the derived arrays. Each case below says which it is claiming.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * A deterministic shuffle — no `Math.random`.
 *
 * A random shuffle would make a failure unreproducible, which in a test about reproducibility would
 * be a poor joke. Three fixed permutations instead: reversed, rotated by a prime, and an
 * index-mixing walk that interleaves the halves. Between them an element moves from the front to
 * the back, from the back to the front, and past its neighbours.
 */
function permutations<T>(items: readonly T[]): { name: string; order: T[] }[] {
  const reversed = [...items].reverse();
  const rotation = 7 % Math.max(1, items.length);
  const rotated = [...items.slice(rotation), ...items.slice(0, rotation)];
  const interleaved: T[] = [];
  const half = Math.ceil(items.length / 2);
  for (let index = 0; index < half; index += 1) {
    interleaved.push(items[index]!);
    const mirror = items[index + half];
    if (mirror !== undefined) interleaved.push(mirror);
  }
  return [
    { name: 'reversed', order: reversed },
    { name: 'rotated', order: rotated },
    { name: 'interleaved', order: interleaved },
  ];
}

function observations(): Observation[] {
  const directory = join(REPO, 'knowledge', 'observations');
  return readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .flatMap(
      (name) =>
        (
          JSON.parse(readFileSync(join(directory, name), 'utf8')) as {
            observations: Observation[];
          }
        ).observations,
    );
}

describe('the knowledge base is a function of its observations, not of their order', () => {
  const all = observations();
  const sources = ['knowledge/observations'];

  it('has enough observations for a shuffle to mean anything', () => {
    expect(all.length).toBeGreaterThan(100);
  });

  it.each(permutations(observations()))(
    'produces byte-identical derived files when the observations arrive $name',
    ({ order }) => {
      /*
       * The whole artefact, serialised, not a summary of it. A comparison of medians would pass
       * while the `sources` arrays beneath them reordered — and those arrays are what a reviewer
       * diffs when a figure changes.
       */
      const baseline = JSON.stringify(aggregate(all, sources));
      const shuffled = JSON.stringify(aggregate(order, sources));

      expect(shuffled).toBe(baseline);
    },
  );

  it('is not vacuous — the permutations really do reorder the input', () => {
    /*
     * The assertion that stops the three cases above passing on three copies of the same array.
     * Every permutation must differ from the original, or it is testing nothing.
     */
    const original = JSON.stringify(all.map((entry) => entry.id));
    for (const { name, order } of permutations(all)) {
      expect(JSON.stringify(order.map((entry) => entry.id)), name).not.toBe(original);
    }
  });
});

describe('the corpus ledger separates what may follow input order from what may not', () => {
  const ledger = parseCorpusValidation(
    JSON.parse(readFileSync(join(REPO, 'knowledge', 'validation', 'corpus.json'), 'utf8')),
    'corpus.json',
  );

  const rows: LedgerRow[] = ledger.drawings.map((row) => ({
    drawingId: row.drawingId,
    page: row.page,
    sha256: row.sha256,
    reached: row.reached,
    stoppedAt: row.stoppedAt,
    discrepancies: row.discrepancies,
  }));

  const meta = {
    datasetId: ledger.datasetId,
    validatedAt: ledger.validatedAt,
    observer: ledger.observer,
  };

  it.each(permutations(rows))('totals do not depend on the rows arriving $name', ({ order }) => {
    /*
     * **Totals, not the whole ledger.** `drawings` is written in the order the rows are handed over,
     * which is the catalogue's sorted order, and preserving it is intended: the artefact reads in
     * the same sequence as the dataset. What must not move is every number derived from the rows,
     * because a count that changed with presentation order would be a count of nothing in
     * particular.
     */
    const baseline = buildLedger(rows, [], meta);
    const shuffled = buildLedger(order, [], meta);

    expect(shuffled.totals).toEqual(baseline.totals);
    expect(shuffled.unapplied).toEqual(baseline.unapplied);
    expect(shuffled.drawings.length).toBe(baseline.drawings.length);
  });

  it('and the byStage tally is the same multiset however the rows arrive', () => {
    // `byStage` is sorted by count then key, so it is order-invariant as a *sequence*, not merely
    // as a bag. Asserted as a sequence, which is the stronger of the two.
    const baseline = buildLedger(rows, [], meta).totals.byStage;
    for (const { name, order } of permutations(rows)) {
      expect(buildLedger(order, [], meta).totals.byStage, name).toEqual(baseline);
    }
  });
});

describe('the solver answers the room, not the order its reference points arrive in', () => {
  /*
   * **Scoped by what it can actually perturb.** This block was first written as "not the order its
   * inputs arrive in", which claimed the whole solver; mutation testing showed it reaches one input.
   *
   * `rankLayouts` takes a room rather than a candidate list, and candidate generation is a pure
   * function of the room and the count — so deleting the id sort in `generateCandidates`, or the
   * re-sort in `collapseByGeometry`, leaves everything here green. Measured, both of them.
   *
   * What a caller *can* shuffle is the reference points, and they are worth shuffling: they feed
   * the routing criteria, which is where a `Map` from service to origin decides which distances get
   * measured, and from there the score, the ranking and every rationale composed out of them.
   *
   * Candidate order has its own coverage in `rank.test.ts` Case C, which hands
   * `collapseByGeometry` a reversed list directly rather than hoping a caller-side shuffle reaches
   * it.
   */
  const base = (): RankInput => ({
    room: fixtureRoom(),
    obstructions: [],
    boundaries: [fixtureRoomBoundary()],
    object: fixtureMachine(),
    catalog: fixtureCatalog(),
    ruleSet: fixtureRuleSet(),
    planStatus: 'calibrated',
    stationTarget: 4,
    pitchPadding: 1_200,
    knowledge: fixtureKnowledge(),
    existing: [],
    referencePoints: [
      { id: 'ro', kind: 'ro_supply', position: { x: 0, y: 0 } },
      { id: 'panel', kind: 'electrical_panel', position: { x: 8_000, y: 0 } },
      { id: 'drain', kind: 'drain', position: { x: 0, y: 6_000 } },
      { id: 'entry', kind: 'access_entry', position: { x: 4_000, y: 0 } },
      { id: 'staff', kind: 'staff_base', position: { x: 4_000, y: 6_000 } },
    ],
    scoring: dialysisScoringModel,
  });

  const baseline = rankLayouts(base());

  it('ranks the same layouts whatever order the reference points are given in', () => {
    for (const { name, order } of permutations(base().referencePoints)) {
      const shuffled = rankLayouts({ ...base(), referencePoints: order });
      expect(JSON.stringify(shuffled), name).toBe(JSON.stringify(baseline));
    }
  });

  it('renders the same explanation, code for code and parameter for parameter', () => {
    /*
     * The rationale is the sentence an engineer reads, and it is assembled from a strategy list, a
     * criterion comparison and three counts — each of which has, at some point in this project's
     * history, been ordered by something it should not have been.
     *
     * Compared as rendered prose in **both** languages rather than as codes: two runs could emit
     * the same code with the same parameters in a different order within the list and still read
     * differently on screen.
     */
    for (const { name, order } of permutations(base().referencePoints)) {
      const shuffled = rankLayouts({ ...base(), referencePoints: order });

      for (const [index, layout] of shuffled.layouts.entries()) {
        const expected = baseline.layouts[index]!;
        for (const language of ['ko', 'en'] as const) {
          expect(
            layout.explanation.map((item) => renderRationale(language, item.code, item.params)),
            `${name} · layout ${index} · ${language}`,
          ).toEqual(
            expected.explanation.map((item) => renderRationale(language, item.code, item.params)),
          );
        }
      }
    }
  });

  it('is not vacuous — the shuffled reference points really differ', () => {
    const original = JSON.stringify(base().referencePoints.map((point) => point.id));
    for (const { name, order } of permutations(base().referencePoints)) {
      expect(JSON.stringify(order.map((point) => point.id)), name).not.toBe(original);
    }
    // And the run produced something to compare.
    expect(baseline.layouts.length).toBeGreaterThan(0);
    expect(baseline.layouts[0]!.explanation.length).toBeGreaterThan(0);
  });
});
