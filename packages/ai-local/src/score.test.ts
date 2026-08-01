import { describe, expect, it } from 'vitest';

import type { ReferencePointSummary } from '@mfd/ai-contract';
import { SCORING_CRITERIA, scoreBreakdownSchema } from '@mfd/ai-contract';
import { dialysisScoringModel } from '@mfd/ai-contract/scoring';
import type { Placement } from '@mfd/document-model';

import {
  fixtureCatalog,
  fixtureKnowledge,
  withDeliveryAllowance,
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

function measurementOf(breakdown: ReturnType<typeof score>, criterion: string) {
  return breakdown.criteria.find((entry) => entry.criterion === criterion);
}

function score(overrides: Partial<ScoreInput> = {}) {
  const placements = [placement('a', 1_000, 1_000), placement('b', 4_000, 1_000)];
  return scoreLayout({
    placements,
    /*
     * The same list by default, which is the ordinary case: a drawing holding nothing but the
     * equipment being scored. Tests that need the two to differ — a machine of another kind in the
     * way — override both, and `occupants` is required rather than defaulted so that a caller has
     * to decide rather than inherit an answer.
     */
    occupants: placements,
    catalog: fixtureCatalog(),
    ruleSet: fixtureRuleSet(),
    boundaries: [fixtureRoomBoundary()],
    room: fixtureRoom(),
    obstructions: [],
    referencePoints: ALL_POINTS,
    object: machine,
    planStatus: 'calibrated',
    pitchPadding: 1_200,
    knowledge: fixtureKnowledge(),
    scoring: dialysisScoringModel,
    stationTarget: 2,
    ...overrides,
  });
}

describe('what is measured, and what is merely in the way', () => {
  /*
   * > Owner decision: the gates judge the whole scene; the score measures only the equipment it was
   * > written for.
   *
   * Two roles, and the standing review found what happens when one field plays both. Narrowing the
   * *measured* population to one kind silently narrowed the *geometry* with it, and criteria began
   * reporting a room as emptier than it is.
   *
   * Each test below breaks on its own criterion. `occupants` holds a machine standing where the
   * measured ones are not; `placements` never mentions it.
   */
  const inTheWay = placement('other', 2_500, 1_000);

  function withOccupant(overrides: Partial<ScoreInput> = {}) {
    const placements = [placement('a', 1_000, 1_000), placement('b', 4_000, 1_000)];
    return score({ placements, occupants: [...placements, inTheWay], ...overrides });
  }

  it('does not offer space another machine is standing in as room to expand into', () => {
    /*
     * The finding, in the form it was reported. A 6 × 4 m room already holding three machines fits
     * no more; measuring only the candidate said three more fit, and moved the total from 0.75 to
     * 0.9375. It is the one weighted criterion measurable with today's catalogue — every AK98
     * clearance is null, so the others report `SC-904` — so this was displayed and wrong.
     *
     * Positions are exactly the generator's own 3×2 grid slot centres, offset by the fixture
     * machine's own half-footprint (400, 400) to land the *front-left-anchored* placement on that
     * slot — a later fix made `occupantBounds` read the footprint's real (front-left) origin
     * instead of assuming a centre, and coordinates chosen for the old, wrong assumption no longer
     * describe the same room. Re-derived rather than kept: every top-row slot is free without the
     * occupied row and none are once it is there, verified by running the criterion, not eyeballed.
     */
    const room = fixtureRoom(6_000, 4_000);
    const boundaries = [fixtureRoomBoundary(6_000, 4_000)];
    const occupied = [placement('e1', 600, 600), placement('e2', 2_600, 600), placement('e3', 4_600, 600)];
    const candidate = [
      placement('c1', 600, 2_600),
      placement('c2', 2_600, 2_600),
      placement('c3', 4_600, 2_600),
    ];

    const blind = score({ placements: candidate, occupants: candidate, room, boundaries, stationTarget: 3 });
    const seeing = score({
      placements: candidate,
      occupants: [...occupied, ...candidate],
      room,
      boundaries,
      stationTarget: 3,
    });

    expect(measurementOf(blind, 'future_expansion')?.measured).toBe(3);
    expect(measurementOf(seeing, 'future_expansion')?.measured).toBe(0);
    // And the count it reports is still the equipment being measured, not the room's population.
    expect(seeing.constraints[0]?.measured).toBe(candidate.length);
  });

  /*
   * A rule with a real threshold and an observed delivery allowance. Without both,
   * `compliance_margin` returns `SC-904` and `installation_feasibility` returns `SC-905` before
   * reaching any geometry at all — so a test of what blocks them, written on the default fixture,
   * would assert nothing. The first attempt at these did exactly that.
   */
  const measurable = {
    ruleSet: fixtureRuleSet([
      fixtureClearanceRule({ side: 'front', threshold: 1_200 }),
      fixtureCollisionRule(),
      fixtureCollisionRule({ ruleId: 'fixture_boundary', scope: 'boundary' }),
    ]),
    knowledge: withDeliveryAllowance([140, 150, 160]),
  };

  /** Machines sealing both service faces of `a`, and nothing else. */
  const SEALED = [placement('front', 1_000, 2_000), placement('rear', 1_000, 0)];

  it('sizes each occupant from its own catalogue entry, not from the object being measured', () => {
    /*
     * The second correction in `future_expansion`, which the standing review showed no test could
     * catch: the fixture catalogue held **one** record, so every "machine of another kind" was
     * another station at the same footprint and sizing them all from `object.planningFootprint` was
     * indistinguishable from sizing them properly.
     *
     * A bed is 1,000 x 2,100 against the station's 800 x 800 — the shipped catalogue's real spread.
     * A narrow, one-column room (2,000 mm wide, three 2,000 mm pitch slots deep) makes the
     * difference exact rather than approximate: the bed, in the same spot, spans two of the three
     * slots at its true depth and blocks a third station reaching the last one; measured as an
     * 800 mm square it fits inside one slot and leaves the other free.
     *
     * Re-derived rather than kept, for the same reason as the test above: the position was chosen
     * for a centre-anchored footprint, and `occupantBounds` now reads the real, front-left-anchored
     * one.
     */
    const room = fixtureRoom(2_000, 6_000);
    const boundaries = [fixtureRoomBoundary(2_000, 6_000)];
    const stations = [placement('s1', 600, 600)];
    const bed = { ...placement('bed', 500, 2_950), equipmentObjectId: 'fixture_bed' };

    const asItIs = score({
      placements: stations,
      occupants: [...stations, bed],
      room,
      boundaries,
      stationTarget: 1,
    });
    // The same drawing, same position, with the bed measured as a station-sized square instead —
    // the mistake being guarded.
    const asAStation = score({
      placements: stations,
      occupants: [...stations, placement('bed', 500, 2_950)],
      room,
      boundaries,
      stationTarget: 1,
    });

    expect(measurementOf(asItIs, 'future_expansion')?.measured).toBe(0);
    expect(measurementOf(asAStation, 'future_expansion')?.measured).toBe(1);
  });

  it('refuses to measure a room holding equipment the catalogue does not describe', () => {
    /*
     * > Owner: *"Unknown must remain Unknown. Never interpolate. Never estimate. Never replace
     * > missing data with assumptions."*
     *
     * Two helpers used to answer this differently and silently — one substituted the measured
     * object's footprint, inventing a dimension; the other dropped the placement, so it blocked
     * nothing and the room measured emptier than it is. Both are assumptions. `SC-906` is not.
     */
    const stations = [placement('a', 1_000, 1_000), placement('b', 4_000, 1_000)];
    const stranger = { ...placement('mystery', 2_500, 1_000), equipmentObjectId: 'not_in_catalogue' };

    const breakdown = score({ ...measurable, placements: stations, occupants: [...stations, stranger] });
    const codes = breakdown.unavailable.map((entry) => entry.reasonCode);

    for (const criterion of [
      'compliance_margin',
      'installation_feasibility',
      'maintenance_access',
      'future_expansion',
    ]) {
      expect(breakdown.unavailable.find((entry) => entry.criterion === criterion)?.reasonCode).toBe(
        'SC-906',
      );
    }
    expect(codes).not.toContain('SC-902');
  });

  it('counts a machine of another kind as blocking maintenance access', () => {
    /*
     * Reachable means at least one service face is clear, so blocking one is not enough — `a` is
     * boxed front and rear, `b` is left alone, and the fraction has to fall from 1 to 0.5. An
     * assertion of "no greater than" would have passed on a criterion that ignored `occupants`
     * entirely, which is how the first version of this test was worthless.
     */
    const placements = [placement('a', 1_000, 1_000), placement('b', 4_000, 1_000)];

    expect(measurementOf(score({ placements, occupants: placements }), 'maintenance_access')?.measured).toBe(1);
    expect(
      measurementOf(
        score({ placements, occupants: [...placements, ...SEALED] }),
        'maintenance_access',
      )?.measured,
    ).toBe(0.5);
  });

  it('measures compliance margin against everything in the room', () => {
    // The headroom probe walks outward from each machine until it hits something. A machine of
    // another kind standing in that path shortens the reach, and a probe that cannot see it reports
    // headroom the room does not have.
    const placements = [placement('a', 1_000, 1_000), placement('b', 4_000, 1_000)];

    const clear = measurementOf(score({ ...measurable, placements, occupants: placements }), 'compliance_margin');
    const boxed = measurementOf(
      score({ ...measurable, placements, occupants: [...placements, ...SEALED] }),
      'compliance_margin',
    );

    expect(clear?.measured).toBeDefined();
    expect(boxed?.measured).toBeDefined();
    expect(boxed?.measured).toBeLessThan(clear?.measured ?? 0);
  });

  it('routes the delivery crate around everything in the room', () => {
    /*
     * The crate has to get from the access point to each machine. Everything installed is in its
     * way — including equipment of other kinds, which is installed too. A route computed against
     * one kind is a route through the other.
     */
    // `a` fills the room's corner, 0–800 in both axes — a placement's position is the fixture
    // catalogue's `front-left` origin corner, not its centre, so (0, 0) is what puts it there. Three
    // more machines, footprints touching, close the only two sides it is not walled on. The first
    // attempt left a 900 mm gap between them and the crate simply drove through it — which is the
    // criterion working, and the test not. (A second attempt used a centre-anchored (400, 400) for
    // `a`, which was the same mistake `occupantBounds` itself has since been corrected out of.)
    const corner = [placement('a', 0, 0)];
    const sealing = [placement('w', 0, 800), placement('x', 800, 0), placement('y', 800, 800)];

    const open = measurementOf(
      score({ ...measurable, placements: corner, occupants: corner, stationTarget: 1 }),
      'installation_feasibility',
    );
    const sealed = measurementOf(
      score({ ...measurable, placements: corner, occupants: [...corner, ...sealing], stationTarget: 1 }),
      'installation_feasibility',
    );

    expect(open?.measured).toBe(1);
    expect(sealed?.measured).toBeLessThan(1);
  });

  it('keeps the measured population to the equipment being scored', () => {
    // The other half. `occupants` is geometry; it must never become a station in the count, or the
    // constraint reports a number the target was never about.
    expect(withOccupant().constraints[0]).toEqual({
      constraint: 'station_count',
      measured: 2,
      unit: 'count',
      target: 2,
    });
  });
});

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
    /*
     * 0.40, not 0.60. Two of the eight criteria are now unmeasurable rather than one: compliance
     * margin at 40 % because no rule carries a threshold (A-1), and installation feasibility at
     * 20 % because the delivery crate allowance used to be a constant written into the solver and
     * now comes from observed drawings, of which there are none.
     *
     * That drop is the owner's layout-knowledge decision showing up in a number. The 150 mm it
     * replaced was not evidence, and a coverage figure that counted it was overstating what this
     * product could currently establish.
     */
    expect(breakdown.coverage).toBeCloseTo(0.4, 6);
    expect(breakdown.unavailable.find((e) => e.criterion === 'installation_feasibility')?.reasonCode)
      .toBe('SC-905');
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
    // Full coverage needs both gaps filled: a rule with a real threshold, and a delivery allowance
    // observed in enough drawings to count as practice. Supplying only the first would leave this
    // test asserting 0.80 and quietly describing the knowledge gap rather than the margin.
    const breakdown = score({
      ruleSet: withThreshold,
      knowledge: withDeliveryAllowance([140, 150, 160]),
    });
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

describe('maintenance access counts obstructions and the room edge, not only equipment', () => {
  /*
   * > Owner decision, following the standing review: obstructions and the room boundary block a
   * > service face, the same as equipment does.
   *
   * Room 6 x 4 m. The fixture machine's clearances are front 1,200 mm, rear 800 mm, footprint
   * 800 x 800 — so at (1,500, 1,200) with no rotation the front face spans y 1,600-2,800 and the
   * rear face spans y 0-800, both x 1,100-1,900.
   */
  const room = fixtureRoom(6_000, 4_000);
  const boundaries = [fixtureRoomBoundary(6_000, 4_000)];
  const machine = [placement('a', 1_500, 1_200)];

  it('counts an obstruction in a clearance zone as blocking that face', () => {
    // A column sitting in the front face's footprint. The rear face is still clear, so the machine
    // is still reachable — the obstruction has to remove the *last* clear face to change the count.
    const frontBlocked = score({
      placements: machine,
      occupants: machine,
      room,
      boundaries,
      obstructions: [fixtureColumn({ x: 1_200, y: 1_800 }, 400).vertices],
    });
    expect(measurementOf(frontBlocked, 'maintenance_access')?.measured).toBe(1);

    // Both faces blocked: front by one column, rear by another.
    const bothBlocked = score({
      placements: machine,
      occupants: machine,
      room,
      boundaries,
      obstructions: [
        fixtureColumn({ x: 1_200, y: 1_800 }, 400).vertices,
        fixtureColumn({ x: 1_200, y: 200 }, 400).vertices,
      ],
    });
    expect(measurementOf(bothBlocked, 'maintenance_access')?.measured).toBe(0);
  });

  it('treats a face flush with the wall as inside, matching VD-5', () => {
    /*
     * > Owner decision, VD-5: *"A footprint touching the room boundary is considered contained...
     * > treat boundary contact as topological contact, not as a crossing."*
     *
     * The machine above (1,500, 1,200) puts its rear face's near edge exactly at y = 0 — the
     * room's own wall. The front face is blocked by an obstruction here, so the flush rear face is
     * the only one left to decide the outcome — reachable only if flush counts as inside, which is
     * the property under test rather than a side effect of a face that was clear anyway.
     */
    const flush = score({
      placements: machine,
      occupants: machine,
      room,
      boundaries,
      obstructions: [fixtureColumn({ x: 1_200, y: 1_800 }, 400).vertices],
    });
    expect(measurementOf(flush, 'maintenance_access')?.measured).toBe(1);
  });

  it('counts a face standing outside the room as unreachable', () => {
    // The same machine, 700 mm from the room's near wall: the rear face (800 mm deep) now runs
    // past y = 0, out of the room, and only the front face remains reachable — until the room
    // narrows enough to take that one too.
    const nearWall = [placement('a', 1_500, 700)];

    const oneFaceOut = score({ placements: nearWall, occupants: nearWall, room, boundaries });
    expect(measurementOf(oneFaceOut, 'maintenance_access')?.measured).toBe(1);

    // Front face now runs to y = 2,300; a room 2,200 mm deep clips it too.
    const shallow = fixtureRoom(6_000, 2_200);
    const shallowBoundaries = [fixtureRoomBoundary(6_000, 2_200)];
    const bothFacesOut = score({
      placements: nearWall,
      occupants: nearWall,
      room: shallow,
      boundaries: shallowBoundaries,
    });
    expect(measurementOf(bothFacesOut, 'maintenance_access')?.measured).toBe(0);
  });
});

describe('equipment geometry rotates with its placement', () => {
  /*
   * > Owner decision, following the standing review: **A** — rotate the footprint with the
   * > placement's rotation.
   *
   * Two separate gaps, both closed the same way: an occupant's own footprint, and the measured
   * object's own service-face zone, are both built in a local frame and only then rotated into
   * model space (`rotatedRectBounds`) — rather than assuming the world axes and the object's axes
   * always line up.
   */

  it("sizes an occupant's footprint by its actual orientation, not its unrotated one", () => {
    /*
     * The gap the review measured directly: a bed (1,000 x 2,100) turned 90° reported the same
     * `walking_distance` as upright, though its true extent blocks the route differently. Two
     * different orientations of the same physical object, at the same `transform.position`, now
     * measure differently — verified against `routedDistance` before writing this.
     *
     * A placement's position is the object's `front-left` corner, and rotation turns the object
     * about *that corner* — the same pivot the real editor uses (`rotatePlacementCommand` changes
     * only `rotation`, never `position`). A 2,100 mm-long bed swung about one end moves almost
     * entirely from one side of a line to the other, so there is no position that keeps both
     * orientations straddling the route symmetrically; the honest test is that the two orientations
     * block it by different amounts, not that one is straightforwardly "wider."
     */
    const points: ReferencePointSummary[] = [
      { id: 'ro', kind: 'ro_supply', position: { x: 0, y: 0 } },
      { id: 'staff', kind: 'staff_base', position: { x: 4_000, y: 6_000 } },
    ];
    const target = placement('target', 4_000, 500);
    const bed = (rotation: number) => ({
      ...placement('bed', 4_000, 3_000),
      equipmentObjectId: 'fixture_bed',
      transform: { position: { x: 4_000, y: 3_000 }, rotation, mirrored: false },
    });

    const upright = score({
      placements: [target],
      occupants: [target, bed(0)],
      referencePoints: points,
    });
    const turned = score({
      placements: [target],
      occupants: [target, bed(90_000)],
      referencePoints: points,
    });

    const walking = (b: ReturnType<typeof score>) =>
      b.criteria.find((entry) => entry.criterion === 'walking_distance')?.measured;

    expect(walking(upright)).toBe(5_750);
    expect(walking(turned)).toBe(5_250);
    // Both still block the route relative to clear, which is the property under test — same object,
    // same place, and the count changes only because the orientation did.
    expect(walking(upright)).not.toBe(walking(turned));
  });

  it("checks a service face where the machine's own rotation actually put it", () => {
    /*
     * The other gap: not another machine's footprint, but the *measured* machine's own front/rear
     * zone, which used to be built directly in world axes — always "front is +Y" — regardless of
     * `transform.rotation`. A station turned 90° has its front face to the **west**, not the south,
     * and an obstruction sitting south of it no longer has anything to do with whether the station
     * is reachable.
     *
     * Both obstructions below sit inside the *unrotated* front (south) and rear (north) zones and
     * nowhere near the *rotated* ones (west and east) — computed by hand from `localToModel`, not
     * eyeballed.
     */
    const room = fixtureRoom(8_000, 8_000);
    const boundaries = [fixtureRoomBoundary(8_000, 8_000)];
    const station = (rotation: number) => [
      { ...placement('a', 3_000, 3_000), transform: { position: { x: 3_000, y: 3_000 }, rotation, mirrored: false } },
    ];
    const obstructionsBothSides = [
      [
        { x: 2_700, y: 3_450 }, { x: 3_300, y: 3_450 },
        { x: 3_300, y: 4_550 }, { x: 2_700, y: 4_550 },
      ],
      [
        { x: 2_700, y: 1_900 }, { x: 3_300, y: 1_900 },
        { x: 3_300, y: 2_500 }, { x: 2_700, y: 2_500 },
      ],
    ];

    const upright = station(0);
    const turned = station(90_000);

    const blockedBothFaces = score({
      placements: upright,
      occupants: upright,
      room,
      boundaries,
      obstructions: obstructionsBothSides,
    });
    const clearedByRotation = score({
      placements: turned,
      occupants: turned,
      room,
      boundaries,
      obstructions: obstructionsBothSides,
    });

    expect(measurementOf(blockedBothFaces, 'maintenance_access')?.measured).toBe(0);
    expect(measurementOf(clearedByRotation, 'maintenance_access')?.measured).toBe(1);
  });

  it("starts the compliance-margin probe from the rotated object's own face, not a model-space guess", () => {
    /*
     * A third assumption in this file, found by the second review of this decision:
     * `freeDistanceOnSide` rotated the *normal* correctly, then picked which half-extent (width or
     * depth) to start the probe from by comparing the **rotated** direction's x/y magnitudes —
     * which agrees with the *local* axis only at multiples of 90° by coincidence, not by
     * construction, and is a coin-flip at 45°.
     *
     * The bed (1,000 x 2,100, `frontEdge: south`) turned 90° has its front normal rotated to due
     * west. The correct reach is `depth/2 = 1,050` — the local normal (0, 1) has no x-component, so
     * it is a north/south side regardless of which way it now points in the world. The old
     * comparison looked at the *rotated* direction, (-1, 0), saw it was "more x than y", and picked
     * `width/2 = 500` instead — starting the probe 550 mm short of the bed's actual face.
     *
     * An obstruction sits due west of both possible starting points, so the same obstacle produces
     * two different measured margins depending on which one the probe actually started from —
     * verified through the full criterion, not asserted from the formula alone. Both figures were
     * confirmed by deliberately reintroducing the old comparison and reading back the result.
     */
    const bed = fixtureCatalog().get('fixture_bed');
    if (!bed) throw new Error('fixture catalogue did not contain fixture_bed');

    const ruleSet = fixtureRuleSet([
      fixtureClearanceRule({ side: 'front', threshold: 1_200, categories: ['treatment_bed'] }),
      fixtureCollisionRule(),
      fixtureCollisionRule({ ruleId: 'fixture_boundary', scope: 'boundary' }),
    ]);
    const turnedBed: Placement = {
      id: 'bed',
      equipmentObjectId: bed.id,
      equipmentObjectVersion: bed.version,
      label: 'bed',
      transform: { position: { x: 3_000, y: 3_000 }, rotation: 90_000, mirrored: false },
      spaceId: null,
    };
    // Due west of both the correct start (1,950, 3,000) and the buggy one (2,500, 3,000).
    const obstruction = [
      { x: 1_250, y: 2_900 },
      { x: 1_350, y: 2_900 },
      { x: 1_350, y: 3_100 },
      { x: 1_250, y: 3_100 },
    ];

    const breakdown = scoreLayout({
      placements: [turnedBed],
      occupants: [turnedBed],
      catalog: fixtureCatalog(),
      ruleSet,
      boundaries: [fixtureRoomBoundary(8_000, 8_000)],
      room: fixtureRoom(8_000, 8_000),
      obstructions: [obstruction],
      referencePoints: [],
      object: bed,
      planStatus: 'calibrated',
      pitchPadding: 1_200,
      knowledge: withDeliveryAllowance([140, 150, 160]),
      scoring: dialysisScoringModel,
      stationTarget: 1,
    });

    // 600 mm free (probe stops at the obstruction's east edge, 50 mm steps) over the 1,200 mm
    // requirement. The buggy start would have measured 1,150 mm free (a 0.9583 ratio) instead.
    expect(measurementOf(breakdown, 'compliance_margin')?.measured).toBe(0.5);
  });
});

describe('walking distance routes around equipment; the service runs do not', () => {
  /*
   * > Owner decision, following the standing review: `walking_distance` routes around equipment,
   * > the three service runs do not — they are carried in a ceiling or floor void.
   */
  it('routes a walk around a machine standing in the way; a pipe run ignores it', () => {
    /*
     * `ro_supply` and `staff_base` are **co-located**, both routing to the same target along the
     * same straight line the blocker sits on. That is deliberate: the first version of this test
     * put the RO origin somewhere the blocker was nowhere near either L-shaped route, so its
     * "unmoved" assertion held no matter what the criterion did with occupants — it would have
     * passed just as well against a service run that also dodged equipment. Verified directly:
     * routing this same from/to/blocker through `routedDistance` gives 5,500 mm clear and
     * 6,250 mm if the blocker is treated as an obstacle, so a service run that leaked occupant
     * avoidance would move this number and this test would catch it.
     *
     * `blocker` sits at (3,600, 2,600), not (4,000, 3,000): a placement's position is the fixture
     * catalogue's `front-left` corner, not its centre, so this is what puts an 800 mm station's
     * footprint at the same [3,600, 4,400] x [2,600, 3,400] box a centre-anchored (4,000, 3,000)
     * used to describe — re-derived once `occupantBounds` was corrected to read the real origin.
     */
    const points: ReferencePointSummary[] = [
      { id: 'ro', kind: 'ro_supply', position: { x: 4_000, y: 6_000 } },
      { id: 'staff', kind: 'staff_base', position: { x: 4_000, y: 6_000 } },
    ];
    const inTheWay = placement('blocker', 3_600, 2_600);
    const target = placement('target', 4_000, 500);

    const clear = score({ placements: [target], occupants: [target], referencePoints: points });
    const blocked = score({
      placements: [target],
      occupants: [target, inTheWay],
      referencePoints: points,
    });

    const walking = (b: ReturnType<typeof score>) =>
      b.criteria.find((entry) => entry.criterion === 'walking_distance')?.measured;
    const ro = (b: ReturnType<typeof score>) =>
      b.criteria.find((entry) => entry.criterion === 'ro_piping_length')?.measured;

    expect(walking(clear)).toBe(5_500);
    // 6,250 is 25 lattice cells at the router's 250 mm pitch (routing.ts's CELL) — pinned as
    // change-detection for this scenario, not a geometric constant. A future change to the
    // lattice pitch is expected to move this number; a regression in occupant avoidance is not.
    expect(walking(blocked)).toBe(6_250);
    // Same origin, same target, same blocker — and the pipe run does not move.
    expect(ro(blocked)).toBe(ro(clear));
    expect(ro(clear)).toBe(5_500);
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
