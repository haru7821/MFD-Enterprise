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
import { type RankInput, collapseByGeometry, denseRanks, rankLayouts } from './rank';
import { generateFeasibleCandidates, geometryKey } from './generate';
import { renderRationale } from '@mfd/ai-contract';

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

/** The same inputs `rank()` uses, for the tests that need the pipeline rather than the ranking. */
function pipelineInput(): RankInput {
  return {
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
  };
}

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

  it('ranks in descending total, densely, over distinct geometries', () => {
    /*
     * **Rewritten twice, and the second rewrite is the interesting one.**
     *
     * It first asserted `[1, 2, 3]` — a rank per position. D13 made ranks dense and it became
     * `[1, 1, 2]` with the first two `tied`. Both were describing a fixture in which two of the
     * three "alternatives" were the **same layout**: `perimeter-4-033p4n9` and `rows-4-033p4n9`
     * have byte-identical placements.
     *
     * With geometry-equivalent candidates collapsed there are two proposals, and their totals
     * differ (0.283333333 against 0.280260417), so nothing here is tied at all. The tie this test
     * used to assert was never a tie — it was one layout counted twice.
     */
    const result = rank();
    const ranks = result.layouts.map((layout) => layout.rank);

    expect(ranks).toEqual([1, 2]);
    expect(result.layouts.map((layout) => layout.tied)).toEqual([false, false]);

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

  it('returns the surviving proposals in a defined order', () => {
    /*
     * **Third title for this test, and the previous two both described a duplicate.**
     *
     * It began as *"breaks a tie on compliance margin rather than on generation order"*, which it
     * never did — with no thresholds in the rule set the margin leg cannot run. It was renamed to
     * *"orders tied layouts internally by id"*, which was true only because two of the three
     * layouts were the same arrangement counted twice. With geometry-equivalent candidates
     * collapsed, this fixture has no tie, and a test that filtered for one asserted over a set of
     * size one while claiming to check ordering.
     *
     * What is left to check, and what was always the real property: the output has a defined order
     * that does not vary between runs. `compare` puts the higher total first; the id key is the
     * fallback and is not reached here.
     */
    const result = rank();

    expect(result.layouts.length).toBeGreaterThan(1);
    const totals = result.layouts.map((layout) => layout.score.total ?? -1);
    expect([...totals].sort((a, b) => b - a)).toEqual(totals);
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

describe('geometry-equivalent candidates collapse into one proposal', () => {
  /*
   * > Owner decision: *"Candidates with identical geometry evidence should collapse into one
   * > proposal … Tied means multiple distinct geometries have equivalent evidence, not multiple
   * > strategies generated the same geometry."*
   *
   * The defect, measured before the change: `rank()` returned three layouts over **two** distinct
   * geometries. `perimeter-4-033p4n9` and `rows-4-033p4n9` placed the same equipment at the same
   * positions with the same rotation and mirroring, and D13 had just labelled that pair *Tied* —
   * telling an engineer the evidence could not separate two alternatives when there was only one.
   */

  it('Case A — two strategies, one geometry: one proposal, and no artificial tie', () => {
    const result = rank();

    // Every proposal is a distinct arrangement. The key is the geometry, not the candidate id.
    const geometries = new Set(result.layouts.map((layout) => geometryKey(layout.placements)));
    expect(geometries.size).toBe(result.layouts.length);

    // The shipped fixture's convergence, asserted rather than assumed — if the generator stops
    // producing it, this fails and the case below stops being about anything.
    const converged = result.layouts.find((layout) => layout.strategies.length > 1);
    expect(converged, 'the fixture no longer contains a convergence case').toBeDefined();
    expect(converged?.strategies).toEqual(['perimeter', 'rows']);

    // And nothing is tied, because the two surviving geometries score differently. Before the
    // collapse this fixture reported two tied layouts that were one layout.
    expect(result.layouts.every((layout) => !layout.tied)).toBe(true);
  });

  it('Case A — the evidence of convergence is kept, not discarded', () => {
    /*
     * Collapsing must not lose the fact that two strategies agreed. `candidateId` names only the
     * survivor, so it carries `perimeter` alone; `strategies` is the honest list.
     */
    const converged = rank().layouts.find((layout) => layout.strategies.length > 1)!;

    expect(converged.candidateId).toContain('perimeter');
    expect(converged.strategies).toContain('rows');
  });

  it('Case B — two geometries with equal evidence stay, and may still be tied', () => {
    /*
     * The other half of the decision: *"Do not change ranking semantics for genuinely different
     * geometries."* Distinct arrangements are never merged, and a tie between them remains possible.
     *
     * Constructed at the `denseRanks` level because the shipped fixture's two surviving geometries
     * happen to score differently — asserting a tie through `rank()` would need a room invented to
     * produce one, and a fixture built to make a test pass is not evidence.
     */
    const result = rank();
    expect(result.layouts.length).toBeGreaterThan(1);
    expect(new Set(result.layouts.map((l) => geometryKey(l.placements))).size).toBe(
      result.layouts.length,
    );

    const score = (total: number | null, coverage: number) =>
      ({ total, coverage }) as unknown as Parameters<typeof denseRanks>[0][number];
    expect(denseRanks([score(0.5, 0.25), score(0.5, 0.25)])).toEqual([
      { rank: 1, tied: true },
      { rank: 1, tied: true },
    ]);
  });

  it('Case C — the survivor does not depend on the order the candidates arrive in', () => {
    /*
     * The claim that would be worthless untested: that `collapseByGeometry` picks by codepoint
     * order on the candidate id rather than by whichever member came first.
     *
     * Today the generator emits candidates already sorted, so first-seen and codepoint-first are
     * the same entry and no observation through `rankLayouts` could tell them apart. Hence the
     * shuffled input here, and hence the function being exported at all.
     */
    const feasible = generateFeasibleCandidates(pipelineInput()).feasible;
    expect(feasible.length).toBeGreaterThan(2);

    const forwards = collapseByGeometry(feasible);
    const backwards = collapseByGeometry([...feasible].reverse());

    expect(backwards.map((entry) => entry.entry.candidate.id)).toEqual(
      forwards.map((entry) => entry.entry.candidate.id),
    );
    expect(backwards.map((entry) => entry.strategies)).toEqual(
      forwards.map((entry) => entry.strategies),
    );

    // And it really did collapse something, or the equality above is between two singletons.
    expect(feasible.length).toBeGreaterThan(forwards.length);
  });

  it('Case C — geometry identity ignores placement order and placement ids', () => {
    /*
     * The key itself. Two candidates may list the same stations in a different sequence, and every
     * arrangement numbers its placements from one — neither is a fact about the room.
     */
    const [layout] = rank().layouts;
    const placements = layout!.placements;
    expect(placements.length).toBeGreaterThan(1);

    const shuffled = [...placements].reverse();
    expect(geometryKey(shuffled)).toBe(geometryKey(placements));

    const renamed = placements.map((placement, index) => ({
      ...placement,
      id: `renamed-${index}`,
    }));
    expect(geometryKey(renamed)).toBe(geometryKey(placements));

    // But a machine that actually moved is a different layout.
    const moved = placements.map((placement, index) =>
      index === 0
        ? {
            ...placement,
            transform: {
              ...placement.transform,
              position: {
                x: placement.transform.position.x + 1,
                y: placement.transform.position.y,
              },
            },
          }
        : placement,
    );
    expect(geometryKey(moved)).not.toBe(geometryKey(placements));
  });
});

describe('what actually decides the layout an engineer is shown first', () => {
  /*
   * **Measured again after geometry-equivalent candidates were collapsed, and the answer changed.**
   *
   * Before the collapse this file recorded that the top two layouts tied exactly on total, that
   * `compliance_margin` could not break the tie, and that `perimeter` was therefore shown first
   * because `'p' < 'r'` — alphabetical order standing in for engineering preference.
   *
   * Two of those three facts were about a duplicate. The "tie" was `perimeter-4-033p4n9` and
   * `rows-4-033p4n9`, which are the same arrangement, so the id key was not choosing between two
   * layouts — it was choosing which name to print on one. With them collapsed, the two surviving
   * geometries are separated by score:
   *
   * | proposal                | total       | margin |
   * | ----------------------- | ----------- | ------ |
   * | `perimeter-4-033p4n9`   | 0.283333333 | null   |
   * | `columns-4-0l767z9`     | 0.280260417 | null   |
   *
   * What remains true is the third fact: the margin key is dormant, and would be the first thing
   * to separate two genuinely different layouts that scored alike.
   */
  it('separates the surviving proposals by score, not by a tie-break', () => {
    const totals = rank().layouts.map((layout) => layout.score.total);

    expect(totals.length).toBe(2);
    expect(totals[0]).not.toBe(totals[1]);
    expect(totals[0]! > totals[1]!).toBe(true);
  });

  it('cannot use the compliance-margin tie-break, because nothing measures it yet', () => {
    /*
     * The second comparator key, asserted as unreachable rather than assumed to work. If A-1 ever
     * supplies thresholds this fails, and whoever supplies them finds out that the ranking's middle
     * key has been dormant since it was written.
     */
    for (const layout of rank().layouts) {
      const margin = layout.score.criteria.find((c) => c.criterion === 'compliance_margin');
      expect(margin?.normalised ?? null, 'compliance_margin became measurable').toBeNull();
    }
  });

  it('produces the same order on a second run', () => {
    /*
     * What the id key is actually for now: reproducibility, not preference. It orders the array
     * deterministically; it no longer decides which of two "alternatives" is better, because two
     * candidates that would need it to be separated are the same layout and have been collapsed.
     */
    const first = rank().layouts.map((layout) => layout.candidateId);
    const second = rank().layouts.map((layout) => layout.candidateId);

    expect(second).toEqual(first);
  });
});

describe('the explanation says how many strategies reached the layout', () => {
  /*
   * > Owner finding: *"AR-104 currently describes only the surviving candidate's strategy … This is
   * > not false, but it hides convergence evidence."*
   *
   * `collapseByGeometry` keeps the codepoint-first candidate, so `candidate.strategy` on the
   * fixture's converged proposal is `perimeter` and `rows` vanished from the sentence while
   * remaining in `strategies`. The explanation and the evidence model disagreed about the same
   * layout.
   */
  it('Case A — a single strategy keeps AR-104 and names it', () => {
    const single = rank().layouts.find((layout) => layout.strategies.length === 1);
    expect(single, 'the fixture has no single-strategy proposal').toBeDefined();

    const arrangement = single!.explanation.find(
      (item) => item.code === 'AR-104' || item.code === 'AR-105',
    );
    expect(arrangement?.code).toBe('AR-104');
    expect(renderRationale('en', arrangement!.code, arrangement!.params)).toContain('in columns');
  });

  it('Case B — a converged proposal names every contributing strategy', () => {
    const converged = rank().layouts.find((layout) => layout.strategies.length > 1);
    expect(converged, 'the fixture has no convergence case').toBeDefined();
    expect(converged!.strategies).toEqual(['perimeter', 'rows']);

    const arrangement = converged!.explanation.find(
      (item) => item.code === 'AR-104' || item.code === 'AR-105',
    )!;
    expect(arrangement.code).toBe('AR-105');

    const english = renderRationale('en', arrangement.code, arrangement.params);
    const korean = renderRationale('ko', arrangement.code, arrangement.params);

    // Both strategies, in both languages. Neither may be dropped.
    for (const fragment of ['perimeter', 'rows']) expect(english).toContain(fragment);
    for (const fragment of ['벽면 배열', '행 배열']) expect(korean).toContain(fragment);

    /*
     * And no wording that ranks them. The owner named these explicitly: a strategy did not *win*,
     * and none of them produced the layout alone.
     */
    for (const forbidden of ['best', 'winning', 'winner', 'primary', 'selected']) {
      expect(english.toLowerCase(), forbidden).not.toContain(forbidden);
    }

    // No placeholder survived — the same failure `renderRationale` deliberately makes visible.
    expect(english).not.toMatch(/\{\w+\}/);
    expect(korean).not.toMatch(/\{\w+\}/);
  });

  it('Case C — the wording does not depend on the order the strategies arrive in', () => {
    /*
     * Two independent order questions, and the second is the one a test could easily miss.
     *
     * `collapseByGeometry` sorts the strategy list, so a reversed candidate stream must produce the
     * same sentence. And `strategyList` itself must be a pure function of the order it is handed —
     * asserted through the public rendering rather than by inspecting the array, because the array
     * being sorted is not the same claim as the *sentence* being stable.
     */
    const feasible = generateFeasibleCandidates(pipelineInput()).feasible;
    const forwards = collapseByGeometry(feasible);
    const backwards = collapseByGeometry([...feasible].reverse());

    expect(backwards.map((entry) => entry.strategies)).toEqual(
      forwards.map((entry) => entry.strategies),
    );

    const converged = rank().layouts.find((layout) => layout.strategies.length > 1)!;
    const arrangement = converged.explanation.find((item) => item.code === 'AR-105')!;
    const rendered = renderRationale('en', arrangement.code, arrangement.params);

    // The same list handed over in the opposite order renders differently — which is precisely why
    // the sort in `collapseByGeometry` is load-bearing rather than cosmetic.
    const reversedParams = { ...arrangement.params, strategies: { ko: '행 배열, 벽면 배열', en: 'rows and perimeter' } };
    expect(renderRationale('en', 'AR-105', reversedParams)).not.toBe(rendered);
    expect(rendered).toContain('perimeter and rows');
  });
});
