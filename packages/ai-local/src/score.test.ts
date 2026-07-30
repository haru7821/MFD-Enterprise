import { describe, expect, it } from 'vitest';

import type { ReferencePointSummary } from '@mfd/ai-contract';
import { SCORING_CRITERIA, scoreBreakdownSchema } from '@mfd/ai-contract';
import { dialysisScoringModel } from '@mfd/ai-contract/scoring';
import type { Placement } from '@mfd/document-model';

import {
  fixtureCatalog,
  fixtureClearanceRule,
  fixtureCollisionRule,
  fixtureColumn,
  fixtureMachine,
  fixtureRoom,
  fixtureRoomBoundary,
  fixtureRuleSet,
} from '../fixtures/index';
import { type ScoreInput, scoreLayout } from './score';

/**
 * The arithmetic, against **the shipped model** rather than a fixture one.
 *
 * That is deliberate: `standards/scoring/dialysis.json` carries the owner's approved weights, and a
 * test using its own invented weights would pass while the file the solver actually loads was
 * wrong.
 */

const machine = fixtureMachine();

function placement(id: string, x: number, y: number): Placement {
  return {
    id,
    equipmentObjectId: machine.id,
    equipmentObjectVersion: machine.version,
    label: id,
    transform: { position: { x, y }, rotation: 0, mirrored: false },
    spaceId: null,
  };
}

const ALL_POINTS: ReferencePointSummary[] = [
  { id: 'ro', kind: 'ro_supply', position: { x: 0, y: 0 } },
  { id: 'panel', kind: 'electrical_panel', position: { x: 8_000, y: 0 } },
  { id: 'drain', kind: 'drain', position: { x: 0, y: 6_000 } },
  { id: 'entry', kind: 'access_entry', position: { x: 4_000, y: 0 } },
  { id: 'staff', kind: 'staff_base', position: { x: 4_000, y: 6_000 } },
];

function score(overrides: Partial<ScoreInput> = {}) {
  return scoreLayout({
    placements: [placement('a', 1_000, 1_000), placement('b', 4_000, 1_000)],
    catalog: fixtureCatalog(),
    ruleSet: fixtureRuleSet(),
    boundaries: [fixtureRoomBoundary()],
    room: fixtureRoom(),
    obstructions: [],
    referencePoints: ALL_POINTS,
    object: machine,
    planStatus: 'calibrated',
    pitchPadding: 1_200,
    scoring: dialysisScoringModel,
    stationTarget: 2,
    ...overrides,
  });
}

describe('the breakdown', () => {
  it('satisfies the contract schema', () => {
    // The five invariants in `ai-contract` — the sum, the coverage, the measured-only rule, no
    // criterion both scored and unavailable, and never a bare total — checked against real output
    // rather than against a hand-built object.
    const result = scoreBreakdownSchema.safeParse(score());
    expect(result.success, JSON.stringify(result.error?.issues ?? [], null, 2)).toBe(true);
  });

  it('accounts for every criterion, as scored or as unavailable', () => {
    const breakdown = score();
    const seen = [
      ...breakdown.criteria.map((entry) => entry.criterion),
      ...breakdown.unavailable.map((entry) => entry.criterion),
    ];
    expect([...seen].sort()).toEqual([...SCORING_CRITERIA].sort());
  });

  it('sums the contributions to the total, exactly', () => {
    const breakdown = score();
    const sum = breakdown.criteria.reduce((total, entry) => total + entry.contribution, 0);
    expect(sum).toBeCloseTo(breakdown.total, 9);
  });

  it('names the model that produced it', () => {
    expect(score().scoringModel).toEqual({ id: 'dialysis_default', version: '1.0.0' });
  });

  it('reports station count as a constraint, never as a criterion', () => {
    const breakdown = score();
    expect(breakdown.constraints).toEqual([
      { constraint: 'station_count', measured: 2, unit: 'count', target: 2 },
    ]);
    expect(breakdown.criteria.map((entry) => String(entry.criterion))).not.toContain(
      'station_count',
    );
  });

  it('gives drain routing a contribution of exactly zero while still measuring it', () => {
    const drain = score().criteria.find((entry) => entry.criterion === 'drain_routing');
    expect(drain).toBeDefined();
    expect(drain?.measuredOnly).toBe(true);
    expect(drain?.contribution).toBe(0);
    expect(drain?.measured).toBeGreaterThan(0);
  });
});

describe('coverage', () => {
  it('is below 1 when the compliance margin cannot be measured', () => {
    /*
     * The real state of this product. Every rule in `standards/rules/` carries a null threshold
     * because the AK98 manual has not arrived (A-1), so the **largest single weight in the approved
     * model** — 40 % — cannot be computed at all.
     *
     * Reported rather than hidden: a total over the other 60 % reads exactly like a complete one.
     */
    const breakdown = score();
    const missing = breakdown.unavailable.map((entry) => entry.criterion);

    expect(missing).toContain('compliance_margin');
    expect(breakdown.unavailable.find((e) => e.criterion === 'compliance_margin')?.reasonCode).toBe(
      'SC-904',
    );
    expect(breakdown.coverage).toBeLessThan(1);
    expect(breakdown.coverage).toBeCloseTo(0.6, 6);
  });

  it('drops to 0.20 when no reference point is placed', () => {
    // Four weighted criteria need a point — 40 % — and compliance is unmeasurable besides. What
    // survives is maintenance access (15 %) and future expansion (5 %), the two weighted criteria
    // needing neither a point nor a threshold.
    const breakdown = score({ referencePoints: [] });

    expect(breakdown.coverage).toBeCloseTo(0.2, 6);
    for (const criterion of ['ro_piping_length', 'electrical_routing', 'walking_distance'] as const) {
      const entry = breakdown.unavailable.find((item) => item.criterion === criterion);
      expect(entry?.reasonCode, criterion).toBe('SC-901');
    }
  });

  it('never reports a distance of zero for a point that was not placed', () => {
    // The failure AD-18 exists for. Three of those criteria minimise, so a substituted zero is not
    // a neutral value — it is the *best possible* score for a measurement nobody took.
    const breakdown = score({ referencePoints: [] });
    const measuredCriteria = breakdown.criteria.map((entry) => entry.criterion);

    for (const criterion of ['ro_piping_length', 'electrical_routing', 'walking_distance'] as const) {
      expect(measuredCriteria).not.toContain(criterion);
    }
  });

  it('scores nothing, at zero coverage, on an empty room', () => {
    /*
     * The test that found a real bug, so it is worth saying what it caught.
     *
     * Future expansion is the only criterion needing neither a reference point nor a threshold, and
     * an empty room has the most expansion room of all — so a blank drawing scored **1.00**, over a
     * coverage of 0.05, and looked like a perfect layout. The emptiest-room failure, kept out of the
     * weighted sum by making station count a constraint, coming back through a criterion that
     * improves as the room empties.
     *
     * Total 0 and coverage 0 now say "nothing was scored" rather than "this scored badly" — a
     * distinction a bare 0.00 could not make either.
     */
    const breakdown = score({ placements: [], referencePoints: [], stationTarget: 0 });

    expect(breakdown.total).toBe(0);
    expect(breakdown.coverage).toBe(0);
    expect(breakdown.criteria).toHaveLength(0);
    expect(breakdown.unavailable).toHaveLength(SCORING_CRITERIA.length);
  });
});

describe('the measurements themselves', () => {
  it('scales a per-station reference with the layout', () => {
    /*
     * 8,000 mm of RO pipe *per station*: a four-station layout is judged against 32 m, not 8 m.
     *
     * Without this a bigger layout would score worse on every routing criterion for the sole
     * reason of being bigger — reintroducing the emptiest-room bias through the back door, after
     * all the work done to keep station count out of the weighted sum.
     */
    const two = score();
    const four = score({
      placements: [
        placement('a', 1_000, 1_000),
        placement('b', 4_000, 1_000),
        placement('c', 1_000, 4_000),
        placement('d', 4_000, 4_000),
      ],
      stationTarget: 4,
    });

    const roTwo = two.criteria.find((e) => e.criterion === 'ro_piping_length');
    const roFour = four.criteria.find((e) => e.criterion === 'ro_piping_length');

    // The four-station layout runs more total pipe…
    expect(roFour?.measured).toBeGreaterThan(roTwo?.measured ?? 0);
    // …and is not punished for it, because the reference scaled too.
    expect(roFour?.normalised).toBeGreaterThan(0);
  });

  it('routes around an obstruction rather than through it', () => {
    const clear = score();
    // A column spanning the whole width between the origin and the machines forces a detour.
    // Spanning from the left wall, so **both** L routes are blocked and the search has to go the
    // long way round the right-hand end. An earlier version started at x = 500 and left the x = 0
    // vertical clear, so one L route was still available and no detour happened — the test passed
    // while proving nothing about obstruction avoidance.
    const wall = [
      { x: 0, y: 400 },
      { x: 7_500, y: 400 },
      { x: 7_500, y: 700 },
      { x: 0, y: 700 },
    ];
    const blocked = score({ obstructions: [wall] });

    const clearRun = clear.criteria.find((e) => e.criterion === 'ro_piping_length')?.measured ?? 0;
    const blockedRun =
      blocked.criteria.find((e) => e.criterion === 'ro_piping_length')?.measured ?? 0;

    expect(blockedRun).toBeGreaterThan(clearRun);
  });

  it('measures maintenance access with no reference point at all', () => {
    // The one weighted criterion that survives an empty document — 15 % of the model.
    const breakdown = score({ referencePoints: [] });
    const access = breakdown.criteria.find((entry) => entry.criterion === 'maintenance_access');

    expect(access).toBeDefined();
    expect(access?.measured).toBeGreaterThan(0);
  });

  it('counts how many more machines would fit', () => {
    const expansion = score().criteria.find((entry) => entry.criterion === 'future_expansion');
    expect(expansion?.measured).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(score())).toBe(JSON.stringify(score()));
  });
});

describe('compliance margin, where a threshold exists', () => {
  /*
   * These need a rule set with a real threshold, which the shipped one does not have (A-1). Without
   * one, `measureComplianceMargin` returns `unavailable` before reaching any arithmetic — so the
   * min-versus-mean choice below was **untestable on the default fixture**, and swapping `Math.min`
   * for a mean left all 51 tests green.
   */
  const withThreshold = fixtureRuleSet([
    fixtureClearanceRule({ side: 'front', threshold: 1_200 }),
    fixtureCollisionRule(),
    fixtureCollisionRule({ ruleId: 'fixture_boundary', scope: 'boundary' }),
  ]);

  it('measures a margin when there is something to compare against', () => {
    const breakdown = score({ ruleSet: withThreshold });
    const margin = breakdown.criteria.find((entry) => entry.criterion === 'compliance_margin');

    expect(margin).toBeDefined();
    expect(margin?.measured).toBeGreaterThan(0);
    expect(breakdown.coverage).toBeCloseTo(1, 6);
  });

  it('takes the worst face, not the average of them', () => {
    /*
     * A layout is only as good as its tightest clearance. An average would let a generous face hide
     * one a service engineer cannot actually work in — and on a weighted criterion carrying 40 %,
     * that is the difference between "this is buildable" and "this looks buildable".
     *
     * The two machines here sit at different distances from the wall, so the mean and the minimum
     * differ and the choice is observable.
     */
    const breakdown = score({
      ruleSet: withThreshold,
      placements: [placement('a', 1_000, 1_000), placement('b', 4_000, 5_000)],
    });
    const margin = breakdown.criteria.find((entry) => entry.criterion === 'compliance_margin');

    const perMachine = [
      placement('a', 1_000, 1_000),
      placement('b', 4_000, 5_000),
    ].map((single) => {
      const only = score({ ruleSet: withThreshold, placements: [single], stationTarget: 1 });
      return only.criteria.find((entry) => entry.criterion === 'compliance_margin')?.measured ?? 0;
    });

    expect(margin?.measured).toBeCloseTo(Math.min(...perMachine), 6);
    // And the minimum is genuinely below the mean here, so the assertion above discriminates.
    const mean = perMachine.reduce((sum, value) => sum + value, 0) / perMachine.length;
    expect(Math.min(...perMachine)).toBeLessThan(mean);
  });
});

describe('a measured-only criterion cannot acquire influence', () => {
  it('contributes nothing even when the data file gives it a weight', () => {
    /*
     * The half-an-edit case the flag exists for: somebody weights `drain_routing` in
     * `standards/scoring/` and leaves `measuredOnly: true` behind.
     *
     * Untestable against the shipped model, where the weight is already 0 — so removing the guard
     * changed nothing and all 51 tests stayed green. This constructs the disagreement.
     */
    const contradictory = {
      ...dialysisScoringModel,
      criteria: {
        ...dialysisScoringModel.criteria,
        drain_routing: { ...dialysisScoringModel.criteria.drain_routing, weight: 0.3 },
      },
    };

    /*
     * The drain point is moved next to the machines on purpose. At its usual corner the routed run
     * exceeds the reference, so `normalised` clamps to 0 — and 0 × any weight is 0, which made the
     * first version of this test pass with the guard removed. A criterion has to have a non-zero
     * normalised value before "its weight is ignored" is observable at all.
     */
    const breakdown = score({
      scoring: contradictory,
      referencePoints: [
        ...ALL_POINTS.filter((point) => point.kind !== 'drain'),
        { id: 'drain-near', kind: 'drain', position: { x: 1_000, y: 500 } },
      ],
    });
    const drain = breakdown.criteria.find((entry) => entry.criterion === 'drain_routing');

    expect(drain?.normalised).toBeGreaterThan(0);
    expect(drain?.weight).toBe(0.3);
    expect(drain?.measuredOnly).toBe(true);
    expect(drain?.contribution).toBe(0);
    // And the schema agrees, so this cannot reach a renderer either.
    expect(scoreBreakdownSchema.safeParse(breakdown).success).toBe(true);
  });
});

describe('what the scoring engine refuses to do', () => {
  it('cannot be reached by a layout that violates a rule — that is Gate 2, not a low score', () => {
    /*
     * Scoring a violating layout *directly* still produces a number, and that is fine: this
     * function's contract is "score what you are given". The guarantee lives one level up, where
     * the pipeline never hands it such a layout.
     *
     * Asserted here anyway, because the tempting "fix" — making `scoreLayout` return zero for a
     * violating layout — would be exactly the compensation the owner ruled out. A zero is a score,
     * and a score can be outvoted.
     */
    const overlapping = score({
      placements: [placement('a', 1_000, 1_000), placement('b', 1_100, 1_000)],
    });

    expect(overlapping.total).toBeGreaterThanOrEqual(0);
    expect(scoreBreakdownSchema.safeParse(overlapping).success).toBe(true);
  });

  it('throws rather than guessing when a reference key is missing', () => {
    const broken = {
      ...dialysisScoringModel,
      criteria: {
        ...dialysisScoringModel.criteria,
        maintenance_access: {
          ...dialysisScoringModel.criteria.maintenance_access,
          reference: { wrongKey: 1 },
        },
      },
    };

    expect(() => score({ scoring: broken })).toThrow(/fractionTarget/);
  });
});

describe('the column fixture routes correctly', () => {
  it('still finds a way past a column', () => {
    const breakdown = score({
      obstructions: [fixtureColumn().vertices],
      boundaries: [fixtureRoomBoundary(), fixtureColumn()],
    });
    const ro = breakdown.criteria.find((entry) => entry.criterion === 'ro_piping_length');
    expect(ro?.measured).toBeGreaterThan(0);
  });
});
