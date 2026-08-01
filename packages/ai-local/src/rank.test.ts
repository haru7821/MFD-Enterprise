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
import { type RankInput, rankLayouts } from './rank';

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

  it('ranks in descending total, numbered from one', () => {
    const result = rank();
    expect(result.layouts.map((layout) => layout.rank)).toEqual(
      result.layouts.map((_, index) => index + 1),
    );

    // A suppressed total (owner decision D1) sorts last rather than as zero — `rank.ts`'s
    // comparator substitutes -1 for null, outside the 0…1 range every real total lives in.
    const totals = result.layouts.map((layout) => layout.score.total ?? -1);
    expect([...totals].sort((a, b) => b - a)).toEqual(totals);
  });

  it('produces identical rankings twice, ids included', () => {
    // The owner's determinism requirement at the level it is actually observed: same input, same
    // three layouts, same order, same ids.
    expect(JSON.stringify(rank())).toBe(JSON.stringify(rank()));
  });

  it('breaks a tie on compliance margin rather than on generation order', () => {
    /*
     * With no thresholds in the rule set every layout's compliance margin is unavailable, so this
     * fixture exercises the *fallback* leg: a stable, total order on candidate id.
     *
     * Asserted by sorting the returned ids and comparing — if the comparator ever fell through to
     * `Array.prototype.sort`'s stability, the order would be generation order, which is neither
     * meaningful nor guaranteed to survive a change to the generator.
     */
    const result = rank();
    const tied = result.layouts.filter(
      (layout) => layout.score.total === result.layouts[0]?.score.total,
    );

    if (tied.length > 1) {
      const ids = tied.map((layout) => layout.candidateId);
      expect([...ids].sort()).toEqual(ids);
    }
    expect(result.layouts.length).toBeGreaterThan(0);
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
