import { describe, expect, it } from 'vitest';

import type { ReferencePointSummary } from '@mfd/ai-contract';
import { scoreBreakdownSchema } from '@mfd/ai-contract';
import { dialysisScoringModel } from '@mfd/ai-contract/scoring';

import {
  fixtureCatalog,
  fixtureKnowledge,
  fixtureMachine,
  fixtureRoom,
  fixtureRoomBoundary,
  fixtureRuleSet,
} from '../fixtures/index';
import { type RankInput, denseRanks, rankLayouts } from './rank';

/**
 * The output contract.
 *
 * > Owner, Step 3 § 4: *"Return multiple ranked alternatives. Do not return only one solution.
 * > Minimum: top 3 candidate layouts. Each candidate must include total score, coverage %, per
 * > criterion breakdown, failed / excluded criteria, engineering explanation."*
 */

const machine = fixtureMachine();

const POINTS: ReferencePointSummary[] = [
  { id: 'ro', kind: 'ro_supply', position: { x: 0, y: 0 } },
  { id: 'panel', kind: 'electrical_panel', position: { x: 8_000, y: 0 } },
  { id: 'drain', kind: 'drain', position: { x: 0, y: 6_000 } },
  { id: 'entry', kind: 'access_entry', position: { x: 4_000, y: 0 } },
  { id: 'staff', kind: 'staff_base', position: { x: 4_000, y: 6_000 } },
];

function rank(overrides: Partial<RankInput> = {}) {
  return rankLayouts({
    room: fixtureRoom(),
    obstructions: [],
    boundaries: [fixtureRoomBoundary()],
    object: machine,
    catalog: fixtureCatalog(),
    ruleSet: fixtureRuleSet(),
    planStatus: 'calibrated',
    stationTarget: 4,
    pitchPadding: 1_200,
    knowledge: fixtureKnowledge(),
    existing: [],
    referencePoints: POINTS,
    scoring: dialysisScoringModel,
    ...overrides,
  });
}

describe('machines already on the drawing', () => {
  /*
   * > Owner decision: the gates judge the whole scene; the score measures only the equipment it was
   * > written for.
   *
   * The generate path is where `existing` is largest — `runSolver` passes every placement on the
   * level — and it was the path with the weaker guard. Every other case in this file passes
   * `existing: []`, so the split between "what is measured" and "what is in the way" was held only
   * by a test in `optimise.test.ts`, one call away.
   */
  const occupant = {
    id: 'already-here',
    equipmentObjectId: machine.id,
    equipmentObjectVersion: machine.version,
    label: 'already here',
    transform: { position: { x: 1_000, y: 1_000 }, rotation: 0, mirrored: false },
    spaceId: null,
  };

  it('counts only the candidate, however much else is on the drawing', () => {
    // `station_count` is the number Gate 1 enforced. A machine that was already there is not part
    // of the candidate and must not appear in its count, or the constraint reports a figure the
    // target was never about.
    const result = rank({ existing: [occupant], stationTarget: 3 });
    expect(result.layouts.length).toBeGreaterThan(0);

    for (const layout of result.layouts) {
      expect(layout.placements).toHaveLength(3);
      expect(layout.score.constraints[0]).toEqual({
        constraint: 'station_count',
        measured: 3,
        unit: 'count',
        target: 3,
      });
    }
  });

  it('does not offer the space they occupy as room to expand into', () => {
    // The other role. What the candidate is measured *against* includes them, because they are
    // standing there — a criterion that cannot see them reports space the room does not have.
    const withOccupants = rank({
      existing: [
        occupant,
        { ...occupant, id: 'b', transform: { ...occupant.transform, position: { x: 2_600, y: 1_000 } } },
        { ...occupant, id: 'c', transform: { ...occupant.transform, position: { x: 4_200, y: 1_000 } } },
      ],
      stationTarget: 3,
    });
    const alone = rank({ stationTarget: 3 });

    /*
     * Present, not defaulted. `?? 0` made this asymmetric: if the criterion ever went *unavailable*
     * in the occupied run it would read 0 and the comparison would pass while measuring nothing.
     */
    const expansionOf = (result: ReturnType<typeof rank>) => {
      const measurement = result.layouts[0]?.score.criteria.find(
        (entry) => entry.criterion === 'future_expansion',
      );
      expect(measurement?.measured).toBeTypeOf('number');
      return measurement?.measured as number;
    };

    expect(result0Defined(withOccupants), 'the occupied run produced no layout').toBe(true);
    expect(expansionOf(withOccupants)).toBeLessThan(expansionOf(alone));
  });
});

function result0Defined(result: ReturnType<typeof rankLayouts>): boolean {
  return result.layouts[0] !== undefined;
}

describe('the ranked output', () => {
  it('returns alternatives rather than one answer', () => {
    const result = rank();
    expect(result.layouts.length).toBeGreaterThan(1);
    expect(result.layouts.length).toBeLessThanOrEqual(3);
  });

  it('gives every layout all five things the owner requires', () => {
    for (const layout of rank().layouts) {
      // 1 total, 2 coverage, 3 per-criterion breakdown, 4 excluded criteria, 5 explanation.
      expect(typeof layout.score.total).toBe('number');
      expect(typeof layout.score.coverage).toBe('number');
      expect(layout.score.criteria.length).toBeGreaterThan(0);
      expect(Array.isArray(layout.score.unavailable)).toBe(true);
      expect(layout.explanation.length).toBeGreaterThan(0);
      // And the breakdown is a valid one, not merely present.
      expect(scoreBreakdownSchema.safeParse(layout.score).success).toBe(true);
    }
  });

  it('ranks in descending total, densely, so a tie shares a number', () => {
    /*
     * > Owner decision: *"Do not present a tie as '#1'. If two or more candidates are
     * > indistinguishable under the available evidence, they are tied."*
     *
     * This asserted `[1, 2, 3]` — a rank per position — which is the behaviour the decision
     * replaced. On this fixture the answer is now `[1, 1, 2]`, because the first two layouts score
     * an identical 0.283333333 at identical coverage and nothing measurable separates them.
     */
    const result = rank();
    const ranks = result.layouts.map((layout) => layout.rank);

    expect(ranks).toEqual([1, 1, 2]);
    expect(result.layouts.map((layout) => layout.tied)).toEqual([true, true, false]);

    // A suppressed total (owner decision D1) sorts last rather than as zero — `rank.ts`'s
    // comparator substitutes -1 for null, outside the 0…1 range every real total lives in.
    const totals = result.layouts.map((layout) => layout.score.total ?? -1);
    expect([...totals].sort((a, b) => b - a)).toEqual(totals);
  });

  it('marks a tie only when both the total and the coverage match', () => {
    /*
     * The equality behind `tied`, stated. Two layouts are tied when the *evidence* cannot separate
     * them — equal total **and** equal coverage — not when they merely round to the same total.
     * `denseRanks` is exercised directly here so the rule can be read without a solver run.
     */
    const score = (total: number | null, coverage: number) =>
      ({ total, coverage }) as unknown as Parameters<typeof denseRanks>[0][number];

    expect(denseRanks([score(0.5, 0.25), score(0.5, 0.25), score(0.4, 0.25)])).toEqual([
      { rank: 1, tied: true },
      { rank: 1, tied: true },
      { rank: 2, tied: false },
    ]);

    // Same total, different coverage: two layouts backed by different amounts of evidence are not
    // indistinguishable, and must not be reported as tied.
    expect(denseRanks([score(0.5, 0.25), score(0.5, 0.3)])).toEqual([
      { rank: 1, tied: false },
      { rank: 2, tied: false },
    ]);

    // Two unmeasurable totals *are* indistinguishable — that is exactly the case where claiming an
    // order would assert something the engine could not measure.
    expect(denseRanks([score(null, 0.2), score(null, 0.2)])).toEqual([
      { rank: 1, tied: true },
      { rank: 1, tied: true },
    ]);
  });

  it('produces identical rankings twice, ids included', () => {
    // The owner's determinism requirement at the level it is actually observed: same input, same
    // three layouts, same order, same ids.
    expect(JSON.stringify(rank())).toBe(JSON.stringify(rank()));
  });

  it('orders tied layouts internally by id, without presenting that order as a judgement', () => {
    /*
     * **Renamed.** This was called *"breaks a tie on compliance margin rather than on generation
     * order"*, which describes something it has never done: with no thresholds in the rule set,
     * every compliance margin is unavailable, so the margin leg cannot run. The body always said
     * so; the title did not, and a title is what someone reads when deciding whether the case is
     * covered.
     *
     * What it does check is the internal order — the deterministic fallback on candidate id, which
     * the owner's decision explicitly permits and explicitly forbids presenting as significance.
     * The `tied` flag beside it is what carries the presentation.
     */
    const result = rank();
    const tied = result.layouts.filter(
      (layout) => layout.score.total === result.layouts[0]?.score.total,
    );

    // Declared, not assumed: the `if` this replaces made the assertion skippable, and a fixture
    // that stopped producing a tie would have quietly stopped testing anything.
    expect(tied.length).toBeGreaterThan(1);

    const ids = tied.map((layout) => layout.candidateId);
    expect([...ids].sort()).toEqual(ids);
    // And every one of them is reported as tied rather than as a ranking.
    expect(tied.every((layout) => layout.tied)).toBe(true);
  });

  it('explains itself in codes rather than prose', () => {
    // Bilingual by construction: a justification cannot be an English string with a Korean one
    // bolted on later, so the explanation is `AR-` codes each language composes from.
    for (const layout of rank().layouts) {
      for (const item of layout.explanation) {
        expect(item.code).toMatch(/^AR-\d{3}$/);
      }
    }
  });

  it('says how much of the model each score covers', () => {
    // Every rule threshold is null (A-1) and so compliance margin — 40 % — is unmeasurable. The
    // total is over the remaining 60 %, and the layouts have to say so.
    for (const layout of rank().layouts) {
      expect(layout.score.coverage).toBeLessThan(1);
      expect(layout.score.unavailable.map((entry) => entry.criterion)).toContain(
        'compliance_margin',
      );
    }
  });

  it('returns nothing, with the count it tried, when no layout is feasible', () => {
    const result = rank({ room: fixtureRoom(2_000, 2_000), stationTarget: 20 });
    expect(result.layouts).toEqual([]);
    expect(result.resolvedStationCount).toBe(20);
  });

  it('honours a caller that asks for more than three', () => {
    const result = rank({ limit: 10 });
    // The generator offers three strategies, so three is the ceiling here — the point is that the
    // limit is not hard-coded at three, which would make "minimum three" also a maximum.
    expect(result.layouts.length).toBeLessThanOrEqual(10);
    expect(result.layouts.length).toBe(rank().layouts.length);
  });
});

describe('what actually decides the layout an engineer is shown first', () => {
  /*
   * **Measured, not described** — and the answer is uncomfortable enough to be worth a test.
   *
   * `compare` has three keys: total score, compliance margin, then candidate id. Deleting either of
   * the last two left all 1,269 tests green, which sent me looking at what they see.
   *
   * On the shipped fixture the ranked output is:
   *
   * | candidate            | total       | margin |
   * | -------------------- | ----------- | ------ |
   * | `perimeter-4-…`      | 0.283333333 | null   |
   * | `rows-4-…`           | 0.283333333 | null   |
   * | `columns-4-…`        | 0.280260417 | null   |
   *
   * The top two tie **exactly** on total. `compliance_margin` is unavailable on all three — every
   * rule in `standards/rules/` carries a null threshold until A-1 arrives, so `marginOf` returns -1
   * for every candidate and the second key cannot separate anything. What ranks `perimeter` above
   * `rows` is therefore the third key, on the candidate id: `'p' < 'r'`.
   *
   * So the layout presented first is chosen by **alphabetical strategy name** whenever the totals
   * tie, which with a four-station room they do. The id key is not decoration — it is the tie-break
   * that decides the headline answer, and it is doing that job in place of an engineering criterion
   * that cannot be measured yet.
   *
   * Whether a tie should be presented as a ranked #1 at all is a product question and is with the
   * GM. These tests only stop it being a surprise.
   *
   * ## What the mutations actually showed, including where they did not fire
   *
   * - **Key 3 reversed** → these tests fail. Its *direction* is pinned.
   * - **Key 3 deleted** (`return 0`) → still green. `candidates.ts` already emits candidates sorted
   *   by id and `Array.sort` is stable, so the key is redundant *given* that upstream order. It is
   *   belt-and-braces on an invariant another module maintains, and it is kept for that reason —
   *   not because a test can show it changing an outcome. `rankLayouts` takes an input, not a
   *   candidate list, so there is no honest way to inject a different generation order from here.
   * - **Key 2 deleted**, and `marginOf`'s `-1` fallback changed to `0` → both still green. Neither
   *   can matter while every margin is unavailable. They are dormant rather than dead: the second
   *   test below fails the day A-1 supplies a threshold, which is what makes the dormancy visible
   *   instead of silent.
   */
  it('produces an exact tie on total, so a tie-break really is deciding the order', () => {
    const totals = rank().layouts.map((layout) => layout.score.total);

    expect(totals.length).toBeGreaterThan(1);
    expect(totals[0]).toBe(totals[1]);
  });

  it('cannot use the compliance-margin tie-break, because nothing measures it yet', () => {
    /*
     * The second key, asserted as unreachable rather than assumed to work. If A-1 ever supplies
     * thresholds this fails, and whoever supplies them comes here and finds out that the ranking's
     * middle key has been dormant.
     */
    for (const layout of rank().layouts) {
      const margin = layout.score.criteria.find((c) => c.criterion === 'compliance_margin');
      expect(margin?.normalised ?? null, 'compliance_margin became measurable').toBeNull();
    }
  });

  it('breaks the tie on candidate id, deterministically and by name alone', () => {
    // The honest statement of what the order means today. Two runs agree, and they agree because
    // of a string comparison — not because one layout is better than the other.
    const first = rank().layouts.map((layout) => layout.candidateId);
    const second = rank().layouts.map((layout) => layout.candidateId);

    expect(second).toEqual(first);
    expect(first[0]! < first[1]!, `${first[0]} should precede ${first[1]} by id`).toBe(true);
  });
});
