import { describe, expect, it } from 'vitest';

import type { ReferencePointSummary } from '@mfd/ai-contract';
import { SCORING_CRITERIA, scoreBreakdownSchema } from '@mfd/ai-contract';
import { dialysisScoringModel } from '@mfd/ai-contract/scoring';
import { createCatalog } from '@mfd/object-library';
import { catalog as shippedCatalog } from '@mfd/object-library/catalog';
import { dialysisRuleSet } from '@mfd/rule-engine/rules';
import { dialysisKnowledge } from '@mfd/layout-knowledge/base';
import type { Vec2 } from '@mfd/cad-engine';
import { createBoundary } from '@mfd/document-model';
import type { Placement } from '@mfd/document-model';
import { evaluate } from '@mfd/rule-engine';

import {
  fixtureCatalog,
  fixtureMachineRecord,
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

  it("routes to a placement's true centre, not its corner — proven by a pure rotation", () => {
    /*
     * Found by the third CTO review of this arc: nothing guarded `measureInstallationFeasibility`'s
     * switch from `transform.position` to `footprintCentre` — reverting it back to the corner left
     * every existing test passing. Two machines share the exact same corner, (0, 0), and differ only
     * in rotation: `upright` (0°) has its true centre at (400, 400); `turned` (180°) has its centre
     * at (-400, -400), the same footprint swept to the opposite side of that shared corner by a pure
     * rotation — the property AD-21 exists to make visible.
     *
     * A corner-anchored router would send the delivery crate to the same point, (0, 0), for both —
     * the obstruction below sits squarely over (400, 400) and nowhere near (-400, -400), nor near
     * (0, 0) itself, so a corner-anchored run measures both reachable, `deliverable` = 2 out of 2 (a
     * fact checked directly by reverting `footprintCentre` back to `transform.position` and
     * re-running this test, not asserted from the geometry alone). A centre-anchored router reports
     * exactly one of the two reachable instead: `deliverable` = 1.
     */
    const upright: Placement = {
      id: 'upright',
      equipmentObjectId: machine.id,
      equipmentObjectVersion: machine.version,
      label: 'upright',
      transform: { position: { x: 0, y: 0 }, rotation: 0, mirrored: false },
      spaceId: null,
    };
    const turned: Placement = {
      id: 'turned',
      equipmentObjectId: machine.id,
      equipmentObjectVersion: machine.version,
      label: 'turned',
      transform: { position: { x: 0, y: 0 }, rotation: 180_000, mirrored: false },
      spaceId: null,
    };
    const points: ReferencePointSummary[] = [
      { id: 'entry', kind: 'access_entry', position: { x: -3_000, y: -3_000 } },
    ];
    // Encloses (400, 400) — `upright`'s true centre — and stops well short of (-400, -400),
    // `turned`'s.
    const obstruction = [
      { x: -100, y: -100 },
      { x: 1_000, y: -100 },
      { x: 1_000, y: 1_000 },
      { x: -100, y: 1_000 },
    ];
    const room = [
      { x: -5_000, y: -5_000 },
      { x: 5_000, y: -5_000 },
      { x: 5_000, y: 5_000 },
      { x: -5_000, y: 5_000 },
    ];

    const result = measurementOf(
      score({
        ...measurable,
        placements: [upright, turned],
        occupants: [upright, turned],
        referencePoints: points,
        obstructions: [obstruction],
        room,
        stationTarget: 2,
      }),
      'installation_feasibility',
    );

    expect(result?.measured).toBe(0.5);
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
    /*
     * Owner decision D1 suppresses the total below `minimumCoverage`, so this fixture has to be
     * one that clears the floor for the sum to have anything to equal. Asserted rather than
     * assumed: if the fixture ever drops below it, this fails here rather than silently passing a
     * `toBeCloseTo(null)`.
     */
    expect(breakdown.total).not.toBeNull();
    expect(sum).toBeCloseTo(breakdown.total ?? 0, 9);
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
     * Owner decision D1 sharpened this further. It used to assert `total === 0`, which was the
     * best available statement at the time but still a *number*, and a reader compares numbers.
     * The total is now **null** — below the model's `minimumCoverage` there is nothing to offer —
     * so "nothing was scored" is said outright rather than encoded as a zero.
     */
    const breakdown = score({ placements: [], referencePoints: [], stationTarget: 0 });

    expect(breakdown.total).toBeNull();
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
    // Re-derived when routing switched targets from `target`'s corner to its true centre — Owner
    // decision, AD-21 routing/report anchor follow-up. The property under test is unaffected: both
    // orientations still block the route relative to clear, by different amounts, because the bed's
    // true extent differs between them, not because the target moved.
    expect(walking(turned)).toBe(5_500);
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

  it("starts the compliance-margin probe from the rotated object's own clearance zone, not its footprint", () => {
    /*
     * A fourth assumption in this file, found by the Critical 0 coordinate-contract review:
     * `freeDistanceOnSide` derived its reach from `transform.position` and a half-extent, and
     * `transform.position` is the footprint's **corner** for every shipped, `front-left` record —
     * so the probe started a half-footprint short of the object's actual face. An obstruction
     * placed genuinely inside the clearance zone is the case the old code got wrong without
     * throwing or producing an obviously-impossible number: it simply measured a shorter clearance
     * zone than the one `clearanceZones` (and the renderer, and the gate) agree the object has.
     *
     * The bed (1,000 x 2,100, `front-left`, `frontEdge: south`) turned 90° at (3,000, 3,000) has a
     * front clearance zone of x ∈ [-300, 900], y ∈ [3,000, 4,000] — `clearanceZones` itself, not a
     * hand re-derivation. The obstruction below sits squarely inside that zone, 450 mm in from the
     * face at (900, 3,500): the probe travels 450 mm before it is blocked, for a 0.375 ratio against
     * the 1,200 mm requirement. Confirmed by running the full criterion, not asserted from the
     * formula alone.
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
    // Squarely inside the front clearance zone (x ∈ [-300, 900], y ∈ [3,000, 4,000]), not the
    // footprint (x ∈ [900, 3,000], y ∈ [3,000, 4,000]) the old, corner-anchored probe would have
    // started inside of.
    const obstruction = [
      { x: 350, y: 3_400 },
      { x: 450, y: 3_400 },
      { x: 450, y: 3_600 },
      { x: 350, y: 3_600 },
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

    expect(measurementOf(breakdown, 'compliance_margin')?.measured).toBe(0.375);
  });

  it("measures the whole service face, not only the point opposite its centre — owner decision, Critical 0 review", () => {
    /*
     * The Critical 0 review's third finding: `freeDistanceOnSide` walked one ray from the face's own
     * midpoint, so an obstruction anywhere else in the declared clearance zone — off to one side of
     * centre — was invisible to it and scored full marks. Verified live: this exact scenario measured
     * `3.0` (the ceiling) before the fix.
     *
     * > Owner decision: measure the minimum across the whole face, matching `@mfd/rule-engine`'s own
     * > clearance evaluator (`gapAlongNormal`) rather than the centreline.
     *
     * The bed (unrotated, front-left, `frontEdge: south`) at (3,000, 3,000) has a rear zone
     * (rear = north, the `-y` face) of x ∈ [3,000, 4,000], y ∈ [2,200, 3,000] — 800 mm required. The
     * face midpoint is (3,500, 3,000); a ray from there alone passes well clear of the obstruction
     * below, which sits at the zone's *east* end, 100 mm off the rear face — 700 mm short of the
     * 800 mm requirement, a 0.125 ratio, not the 1.0-or-better a centreline-only probe would report.
     */
    const bed = fixtureCatalog().get('fixture_bed');
    if (!bed) throw new Error('fixture catalogue did not contain fixture_bed');

    const ruleSet = fixtureRuleSet([
      fixtureClearanceRule({ side: 'rear', threshold: 800, categories: ['treatment_bed'] }),
      fixtureCollisionRule(),
      fixtureCollisionRule({ ruleId: 'fixture_boundary', scope: 'boundary' }),
    ]);
    const unrotatedBed: Placement = {
      id: 'bed',
      equipmentObjectId: bed.id,
      equipmentObjectVersion: bed.version,
      label: 'bed',
      transform: { position: { x: 3_000, y: 3_000 }, rotation: 0, mirrored: false },
      spaceId: null,
    };
    // Squarely inside the rear zone (x ∈ [3,000, 4,000], y ∈ [2,200, 3,000]), at its east end —
    // nowhere near the face's own midpoint at (3,500, 3,000).
    const obstruction = [
      { x: 3_800, y: 2_700 },
      { x: 3_950, y: 2_700 },
      { x: 3_950, y: 2_900 },
      { x: 3_800, y: 2_900 },
    ];

    const breakdown = scoreLayout({
      placements: [unrotatedBed],
      occupants: [unrotatedBed],
      catalog: fixtureCatalog(),
      ruleSet,
      boundaries: [fixtureRoomBoundary(10_000, 10_000)],
      room: fixtureRoom(10_000, 10_000),
      obstructions: [obstruction],
      referencePoints: [],
      object: bed,
      planStatus: 'calibrated',
      pitchPadding: 1_200,
      knowledge: withDeliveryAllowance([140, 150, 160]),
      scoring: dialysisScoringModel,
      stationTarget: 1,
    });

    expect(measurementOf(breakdown, 'compliance_margin')?.measured).toBe(0.125);
  });

  it('measures a straddling obstruction against only the part of it in front of the face — fifth review round, corrected by the seventh', () => {
    /*
     * Found by the fifth CTO review of this arc: `@mfd/rule-engine`'s `gapAlongNormal` reported a
     * *negative* gap for the quad below — `polygonsOverlap` calls it non-overlapping while
     * `gapAlongNormal` returned -500 for the same pair, clamped to 0 by this function.
     *
     * The seventh review round found that reproduction was measuring against the wrong part of the
     * quad: its corner nearest the face sits at (740, -340) — laterally outside the rear face's own
     * [0, 800] band (the quad runs from x = 700 to x = 1,140, only the first 100 mm of which is in
     * front of the face at all). Clipped to the band first, the true whole-face gap is +100 mm — a
     * 0.125 ratio, not the 0 the unclipped measurement produced. `gapAlongNormal` now clips to the
     * face's own band before measuring; see its own doc comment.
     *
     * The eighth review round found the first version of this fix's own regression test asserted a
     * number the code did not produce (+50 mm, not the true +100 mm): `fixtureRoom`/
     * `fixtureRoomBoundary` put the room's own rear wall exactly on the station's rear face (both at
     * y = 0), so `nearestRoomEdgeAcrossFace`'s probe — stepping outward in `PROBE_STEP_MM` = 50 mm
     * increments — left the room after a single step and reported 50, smaller than the obstruction's
     * true 100 mm and so the one `consider` actually kept. The assertion passed, but for the room
     * edge's accidental proximity, not for the clip fix this test exists to pin. The room here is
     * pushed well clear of the rear face (500 mm, more than the `PROBE_CEILING_MULTIPLE` × 800 mm
     * ceiling could reach) so the obstruction is what the assertion actually measures.
     *
     * The station (unrotated, front-left) sits at (0, 0); its rear face is at y = 0, outward -y.
     * The quad runs diagonally from (700, -300) to (1140, 460) — inside the face's lateral band
     * (x ∈ [0, 800]) only where y < 0 (ahead of the plane), outside it everywhere y ≥ 0, so it never
     * enters the footprint's own [0, 800] × [0, 800] box. `polygonsOverlap` agrees: not colliding.
     */
    const machine = fixtureMachine();
    const placement: Placement = {
      id: 'p',
      equipmentObjectId: machine.id,
      equipmentObjectVersion: machine.version,
      label: 'p',
      transform: { position: { x: 0, y: 0 }, rotation: 0, mirrored: false },
      spaceId: null,
    };
    const ruleSet = fixtureRuleSet([
      fixtureClearanceRule({ side: 'rear', threshold: 800 }),
      fixtureCollisionRule(),
      fixtureCollisionRule({ ruleId: 'fixture_boundary', scope: 'boundary' }),
    ]);
    const straddling = [
      { x: 700, y: -300 },
      { x: 1_100, y: 500 },
      { x: 1_140, y: 460 },
      { x: 740, y: -340 },
    ];
    // A room reaching well past the rear face on every side — nowhere near enough for
    // `nearestRoomEdgeAcrossFace` to find an edge within the probe's ceiling.
    const room: Vec2[] = [
      { x: -5_000, y: -5_000 },
      { x: 10_000, y: -5_000 },
      { x: 10_000, y: 10_000 },
      { x: -5_000, y: 10_000 },
    ];
    const roomBoundary = createBoundary('boundary-room', 'space_outline', room, 'Ward');

    const breakdown = scoreLayout({
      placements: [placement],
      occupants: [placement],
      catalog: fixtureCatalog(),
      ruleSet,
      boundaries: [roomBoundary],
      room,
      obstructions: [straddling],
      referencePoints: [],
      object: machine,
      planStatus: 'calibrated',
      pitchPadding: 1_200,
      knowledge: withDeliveryAllowance([140, 150, 160]),
      scoring: dialysisScoringModel,
      stationTarget: 1,
    });

    expect(measurementOf(breakdown, 'compliance_margin')?.measured).toBe(0.125);
  });

  it('clamps a genuinely overlapping obstruction at zero — the clamp itself, exercised directly', () => {
    /*
     * Seventh review round: after the clip fix, a negative `gapAlongNormal` result within a plain
     * rectangular face's own band is, for this codebase, indistinguishable from an actual overlap
     * with the footprint being measured against (checked directly — two million randomised,
     * band-constrained, straddling polygons, zero non-colliding) — and `compliance_margin` is only
     * ever reached through `scoreLayout`, which every real caller gates behind Gate 2 first. This
     * fixture is not a layout `optimiseLayout`/`rankLayouts` would ever hand to `scoreLayout`; like
     * the test above, it calls `scoreLayout` directly to exercise the clamp itself, not to claim it
     * is reachable through the app today. See `freeDistanceOnSide`'s doc comment for why the clamp
     * stays regardless.
     *
     * The obstruction is a plain box overlapping the station's own rear-zone footprint outright —
     * x ∈ [200, 600] (well inside the rear face's [0, 800] band, so clipping changes nothing here),
     * y ∈ [-100, 100] (straddling the rear face at y = 0).
     */
    const machine = fixtureMachine();
    const placement: Placement = {
      id: 'p',
      equipmentObjectId: machine.id,
      equipmentObjectVersion: machine.version,
      label: 'p',
      transform: { position: { x: 0, y: 0 }, rotation: 0, mirrored: false },
      spaceId: null,
    };
    const ruleSet = fixtureRuleSet([
      fixtureClearanceRule({ side: 'rear', threshold: 800 }),
      fixtureCollisionRule(),
      fixtureCollisionRule({ ruleId: 'fixture_boundary', scope: 'boundary' }),
    ]);
    const overlapping = [
      { x: 200, y: -100 },
      { x: 600, y: -100 },
      { x: 600, y: 100 },
      { x: 200, y: 100 },
    ];

    const breakdown = scoreLayout({
      placements: [placement],
      occupants: [placement],
      catalog: fixtureCatalog(),
      ruleSet,
      boundaries: [fixtureRoomBoundary(10_000, 10_000)],
      room: fixtureRoom(10_000, 10_000),
      obstructions: [overlapping],
      referencePoints: [],
      object: machine,
      planStatus: 'calibrated',
      pitchPadding: 1_200,
      knowledge: withDeliveryAllowance([140, 150, 160]),
      scoring: dialysisScoringModel,
      stationTarget: 1,
    });

    expect(measurementOf(breakdown, 'compliance_margin')?.measured).toBe(0);
  });

  it('reports compliance_margin unavailable rather than a wrong number against a non-convex obstruction — ninth review round', () => {
    /*
     * The eighth review round's staple/riser reproduction, made a permanent regression by the
     * owner's decision on how to handle it (option 1 of three presented): a genuinely
     * non-overlapping, non-convex obstruction wraps around the station's left side — one arm
     * 100 mm in front of the rear face (y ∈ [-200, -100], nearest edge at y = -100), the other
     * re-emerging 100 mm beyond the front face (y ∈ [900, 1,000]), joined by a connecting run down
     * the left side entirely outside the station's own footprint (x < 0) and entirely outside the
     * rear face's own lateral band ([0, 800]) — never touching or overlapping the station.
     *
     * `gapAlongNormal` clips this to the band and takes the single global minimum projection, which
     * comes from the far arm (reached only by wrapping around the left side), not the near one:
     * before the fix this reported roughly -1,000 mm (clamped to 0 by `freeDistanceOnSide`),
     * reading as a rear face with no clearance at all for one that actually clears by a genuine
     * 100 mm. The fix is not a better number — `isConvexPolygon` rejects this shape, so the face is
     * reported unmeasurable (`SC-907`) rather than measured wrong.
     */
    const staple: Vec2[] = [
      { x: 700, y: -200 },
      { x: -200, y: -200 },
      { x: -200, y: 1_000 },
      { x: 700, y: 1_000 },
      { x: 700, y: 900 },
      { x: -100, y: 900 },
      { x: -100, y: -100 },
      { x: 700, y: -100 },
    ];

    const machine = fixtureMachine();
    const placement: Placement = {
      id: 'p',
      equipmentObjectId: machine.id,
      equipmentObjectVersion: machine.version,
      label: 'p',
      transform: { position: { x: 0, y: 0 }, rotation: 0, mirrored: false },
      spaceId: null,
    };
    const ruleSet = fixtureRuleSet([
      fixtureClearanceRule({ side: 'rear', threshold: 800 }),
      fixtureCollisionRule(),
      fixtureCollisionRule({ ruleId: 'fixture_boundary', scope: 'boundary' }),
    ]);

    const breakdown = scoreLayout({
      placements: [placement],
      occupants: [placement],
      catalog: fixtureCatalog(),
      ruleSet,
      boundaries: [fixtureRoomBoundary(10_000, 10_000)],
      room: fixtureRoom(10_000, 10_000),
      obstructions: [staple],
      referencePoints: [],
      object: machine,
      planStatus: 'calibrated',
      pitchPadding: 1_200,
      knowledge: withDeliveryAllowance([140, 150, 160]),
      scoring: dialysisScoringModel,
      stationTarget: 1,
    });

    expect(measurementOf(breakdown, 'compliance_margin')).toBeUndefined();
    expect(
      breakdown.unavailable.find((entry) => entry.criterion === 'compliance_margin')?.reasonCode,
    ).toBe('SC-907');
  });

  it('does not void compliance_margin for a non-convex obstruction nowhere near the governed face', () => {
    /*
     * The tenth review round's finding on the fix above: the first version voided a face against
     * *any* non-convex obstruction inside its lateral band, including one entirely on the far side
     * of the machine — behind the rear face's own plane, where `gapAlongNormal` itself would
     * already report null and measure nothing. An L-shape sitting at y ∈ [2,000, 2,800], 2 m clear
     * of the 800x800 station's front face at y = 800, is exactly that: non-convex, but not in front
     * of the rear face (y = 0, outward -y) by any test. It must cost the criterion nothing.
     */
    const distantLShape: Vec2[] = [
      { x: 0, y: 2_000 },
      { x: 800, y: 2_000 },
      { x: 800, y: 2_400 },
      { x: 400, y: 2_400 },
      { x: 400, y: 2_800 },
      { x: 0, y: 2_800 },
    ];

    const machine = fixtureMachine();
    const placement: Placement = {
      id: 'p',
      equipmentObjectId: machine.id,
      equipmentObjectVersion: machine.version,
      label: 'p',
      transform: { position: { x: 0, y: 0 }, rotation: 0, mirrored: false },
      spaceId: null,
    };
    const ruleSet = fixtureRuleSet([
      fixtureClearanceRule({ side: 'rear', threshold: 800 }),
      fixtureCollisionRule(),
      fixtureCollisionRule({ ruleId: 'fixture_boundary', scope: 'boundary' }),
    ]);

    const layoutInput = {
      placements: [placement],
      occupants: [placement],
      catalog: fixtureCatalog(),
      ruleSet,
      boundaries: [fixtureRoomBoundary(10_000, 10_000)],
      room: fixtureRoom(10_000, 10_000),
      referencePoints: [],
      object: machine,
      planStatus: 'calibrated' as const,
      pitchPadding: 1_200,
      knowledge: withDeliveryAllowance([140, 150, 160]),
      scoring: dialysisScoringModel,
      stationTarget: 1,
    };

    const withObstruction = scoreLayout({ ...layoutInput, obstructions: [distantLShape] });
    const withoutObstruction = scoreLayout({ ...layoutInput, obstructions: [] });

    expect(
      withObstruction.unavailable.find((entry) => entry.criterion === 'compliance_margin'),
    ).toBeUndefined();
    expect(measurementOf(withObstruction, 'compliance_margin')?.measured).toBe(
      measurementOf(withoutObstruction, 'compliance_margin')?.measured,
    );
  });

  it('voids compliance_margin entirely when only one of two governed faces is blocked — tenth review round, owner decision', () => {
    /*
     * The tenth review round's second finding: the first version of the fix dropped a blocked
     * face from the ratio pool and reported the minimum of whatever else measured, which made a
     * non-convex obstruction cost *nothing* whenever any other governed face happened to be
     * clear — confirmed directly, a station scored identically with and without the obstruction
     * so long as one other face was free. The owner's decision: any blocked face voids the whole
     * criterion, matching `SC-906`'s "refuse rather than measure around the unknown".
     *
     * Two clearance rules on the same station: rear (threshold 800) and front (threshold 1,200).
     * A small L-shape sits at y ∈ [-300, -100], x ∈ [0, 400] — entirely in front of the rear face
     * (y = 0, outward -y) and entirely behind the front face's own plane (y = 800, outward +y), so
     * it blocks the rear measurement alone; the front face has nothing in front of it at all.
     */
    const rearOnlyObstruction: Vec2[] = [
      { x: 0, y: -300 },
      { x: 400, y: -300 },
      { x: 400, y: -200 },
      { x: 200, y: -200 },
      { x: 200, y: -100 },
      { x: 0, y: -100 },
    ];

    const machine = fixtureMachine();
    const placement: Placement = {
      id: 'p',
      equipmentObjectId: machine.id,
      equipmentObjectVersion: machine.version,
      label: 'p',
      transform: { position: { x: 0, y: 0 }, rotation: 0, mirrored: false },
      spaceId: null,
    };
    const ruleSet = fixtureRuleSet([
      fixtureClearanceRule({ ruleId: 'fixture_rear_clearance', side: 'rear', threshold: 800 }),
      fixtureClearanceRule({ ruleId: 'fixture_front_clearance', side: 'front', threshold: 1_200 }),
      fixtureCollisionRule(),
      fixtureCollisionRule({ ruleId: 'fixture_boundary', scope: 'boundary' }),
    ]);

    const breakdown = scoreLayout({
      placements: [placement],
      occupants: [placement],
      catalog: fixtureCatalog(),
      ruleSet,
      boundaries: [fixtureRoomBoundary(10_000, 10_000)],
      room: fixtureRoom(10_000, 10_000),
      obstructions: [rearOnlyObstruction],
      referencePoints: [],
      object: machine,
      planStatus: 'calibrated',
      pitchPadding: 1_200,
      knowledge: withDeliveryAllowance([140, 150, 160]),
      scoring: dialysisScoringModel,
      stationTarget: 1,
    });

    expect(measurementOf(breakdown, 'compliance_margin')).toBeUndefined();
    expect(
      breakdown.unavailable.find((entry) => entry.criterion === 'compliance_margin')?.reasonCode,
    ).toBe('SC-907');
  });

  it.each([
    {
      side: 'rear' as const,
      threshold: 800,
      // 100 mm into the 800 mm rear zone: the probe starts at the rear face's midpoint
      // (3500, 3000) and walks in −y; blocked at the obstruction's near edge, 100 mm out.
      obstruction: [
        { x: 3_300, y: 2_700 },
        { x: 3_600, y: 2_700 },
        { x: 3_600, y: 2_900 },
        { x: 3_300, y: 2_900 },
      ],
    },
    {
      side: 'left' as const,
      threshold: 400,
      // The probe starts at the left face (3000, 4050) and walks in −x; blocked 50 mm out.
      obstruction: [
        { x: 2_850, y: 4_000 },
        { x: 2_950, y: 4_000 },
        { x: 2_950, y: 4_100 },
        { x: 2_850, y: 4_100 },
      ],
    },
    {
      side: 'right' as const,
      threshold: 400,
      // The probe starts at the right face (4000, 4050) and walks in +x; blocked 50 mm out.
      obstruction: [
        { x: 4_050, y: 4_000 },
        { x: 4_150, y: 4_000 },
        { x: 4_150, y: 4_100 },
        { x: 4_050, y: 4_100 },
      ],
    },
  ])(
    'measures the $side face, not just the one side the previous fix happened to get right',
    ({ side, threshold, obstruction }) => {
      /*
       * The Critical 0 review (round 5) found that the prior fix — deriving a clearance probe's
       * anchor from a `ClearanceZone` polygon's corner order — was correct for `front` alone.
       * `front` is the one side where the zone's offset runs along the same local axis (y) that
       * `rectCorners` happens to pair its first two corners on; for `rear`, `left` and `right` the
       * "first two corners" claim is false, and the probe silently walked the wrong way — parallel
       * to the face, or into the machine's own footprint. Live through `scoreLayout`, an
       * obstruction squarely inside a real clearance zone measured full marks instead of a real,
       * low margin. `front` alone passing was not evidence the fix worked; it was the one case
       * that couldn't tell the difference.
       *
       * `faceGeometry` (`@mfd/object-library`) replaces the corner-order guess with the side's own
       * outward normal, so this is measured the same way on every side. All three obstructions
       * here sit genuinely inside their zone, at an unrotated placement — the rotated case is
       * `front`'s test above, and the underlying geometry is verified across five rotations and
       * both mirror states in `geometry.test.ts`; this only has to confirm the wiring.
       */
      const bed = fixtureCatalog().get('fixture_bed');
      if (!bed) throw new Error('fixture catalogue did not contain fixture_bed');

      const ruleSet = fixtureRuleSet([
        fixtureClearanceRule({ side, threshold, categories: ['treatment_bed'] }),
        fixtureCollisionRule(),
        fixtureCollisionRule({ ruleId: 'fixture_boundary', scope: 'boundary' }),
      ]);
      const placement: Placement = {
        id: 'bed',
        equipmentObjectId: bed.id,
        equipmentObjectVersion: bed.version,
        label: 'bed',
        transform: { position: { x: 3_000, y: 3_000 }, rotation: 0, mirrored: false },
        spaceId: null,
      };

      const breakdown = scoreLayout({
        placements: [placement],
        occupants: [placement],
        catalog: fixtureCatalog(),
        ruleSet,
        boundaries: [fixtureRoomBoundary(10_000, 10_000)],
        room: fixtureRoom(10_000, 10_000),
        obstructions: [obstruction],
        referencePoints: [],
        object: bed,
        planStatus: 'calibrated',
        pitchPadding: 1_200,
        knowledge: withDeliveryAllowance([140, 150, 160]),
        scoring: dialysisScoringModel,
        stationTarget: 1,
      });

      expect(measurementOf(breakdown, 'compliance_margin')?.measured).toBe(0.125);
    },
  );

  it("agrees with the rule engine's own measured gap on the same geometry", () => {
    /*
     * The Critical 0 review's second blocking finding: two machines, one placement each, no
     * obstruction — just a bed 100 mm inside another bed's left clearance zone. The rule engine
     * (`@mfd/rule-engine`'s clearance evaluator, unrelated code, unrelated author) and this file's
     * `compliance_margin` both claim to measure "how much clearance is actually there," from the
     * same two footprints. Before the fix, they did not agree: the rule engine correctly reported
     * a 100 mm gap; `freeDistanceOnSide`, walking the wrong way on `left`, reported none at all.
     * AD-21 exists so this cannot happen — one placement, the same answer everywhere — so this
     * checks the two against each other directly, not each against a hand-picked number.
     */
    const bed = fixtureCatalog().get('fixture_bed');
    if (!bed) throw new Error('fixture catalogue did not contain fixture_bed');

    const a: Placement = {
      id: 'bed-a',
      equipmentObjectId: bed.id,
      equipmentObjectVersion: bed.version,
      label: 'Bed A',
      transform: { position: { x: 3_000, y: 3_000 }, rotation: 0, mirrored: false },
      spaceId: null,
    };
    const b: Placement = {
      id: 'bed-b',
      equipmentObjectId: bed.id,
      equipmentObjectVersion: bed.version,
      label: 'Bed B',
      transform: { position: { x: 1_900, y: 3_000 }, rotation: 0, mirrored: false },
      spaceId: null,
    };
    const ruleSet = fixtureRuleSet([
      fixtureClearanceRule({ side: 'left', threshold: 400, categories: ['treatment_bed'] }),
    ]);
    const boundaries = [fixtureRoomBoundary(10_000, 10_000)];

    const report = evaluate({
      placements: [a, b],
      catalog: fixtureCatalog(),
      ruleSet,
      spatial: { boundaries, planStatus: 'calibrated' },
    });
    const finding = report.results.find(
      (result) => result.placementIds[0] === 'bed-a' && result.measured !== null,
    );
    if (!finding || finding.measured === null) {
      throw new Error('expected the rule engine to measure a left-clearance gap on bed A');
    }

    const breakdown = scoreLayout({
      placements: [a],
      occupants: [a, b],
      catalog: fixtureCatalog(),
      ruleSet,
      boundaries,
      room: fixtureRoom(10_000, 10_000),
      obstructions: [],
      referencePoints: [],
      object: bed,
      planStatus: 'calibrated',
      pitchPadding: 1_200,
      knowledge: withDeliveryAllowance([140, 150, 160]),
      scoring: dialysisScoringModel,
      stationTarget: 1,
    });

    expect(measurementOf(breakdown, 'compliance_margin')?.measured).toBe(finding.measured / 400);
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
    // Re-derived when routing switched targets from `target`'s corner to its true centre — Owner
    // decision, AD-21 routing/report anchor follow-up. Pinned as change-detection for this scenario,
    // not a geometric constant: a future change to the router's lattice pitch (routing.ts's CELL) is
    // expected to move this number; a regression in occupant avoidance is not.
    expect(walking(blocked)).toBe(5_750);
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

/**
 * Owner decision D1: *"Do NOT renormalize away unavailable criteria. If coverage is below the
 * required threshold, suppress the total ranking. … Unknown must never become perfect."*
 *
 * The audit's measurement, encoded. Dividing by the *available* weight meant deleting evidence
 * raised the score — identical placements with only the reference-point set varied gave 0.7208 at
 * coverage 0.40, 0.8983 at 0.25, and **1.0000** at 0.20.
 */
describe('D1 — evidence cannot be renormalised away', () => {
  it('never rises when a reference point is taken away', () => {
    const all = score();
    const fewer = score({ referencePoints: ALL_POINTS.slice(0, 2) });
    const none = score({ referencePoints: [] });

    // Coverage must fall — the premise. If it does not, this is measuring nothing.
    expect(fewer.coverage).toBeLessThan(all.coverage);
    expect(none.coverage).toBeLessThan(fewer.coverage);

    // And the contribution sum must fall with it, never rise. Under renormalisation it rose.
    const sum = (breakdown: ReturnType<typeof score>) =>
      breakdown.criteria.reduce((running, entry) => running + entry.contribution, 0);

    expect(sum(fewer)).toBeLessThanOrEqual(sum(all));
    expect(sum(none)).toBeLessThanOrEqual(sum(fewer));
  });

  it('cannot reach 1.00 on a layout that was barely measured', () => {
    // The headline failure: coverage 0.20 scored a perfect 1.0000.
    const none = score({ referencePoints: [] });
    const sum = none.criteria.reduce((running, entry) => running + entry.contribution, 0);

    expect(none.coverage).toBeLessThan(0.5);
    expect(sum).toBeLessThan(0.5);
  });

  it('divides by the whole model, so contributions are comparable across candidates', () => {
    /*
     * The property that makes a fixed divisor worth having: a criterion's contribution depends only
     * on the criterion, not on how many *other* criteria happened to be measurable. Under
     * renormalisation the same measurement contributed more when its neighbours went missing.
     */
    const all = score();
    const fewer = score({ referencePoints: ALL_POINTS.slice(0, 2) });

    const contributionOf = (breakdown: ReturnType<typeof score>, criterion: string) =>
      breakdown.criteria.find((entry) => entry.criterion === criterion)?.contribution;

    const shared = all.criteria
      .map((entry) => entry.criterion)
      .filter((criterion) => fewer.criteria.some((entry) => entry.criterion === criterion));

    expect(shared.length).toBeGreaterThan(0);
    for (const criterion of shared) {
      expect(contributionOf(fewer, criterion)).toBeCloseTo(contributionOf(all, criterion) ?? 0, 9);
    }
  });

  it('offers no total at all below the model’s coverage floor', () => {
    const suppressed = score({ scoring: { ...dialysisScoringModel, minimumCoverage: 1 } });
    expect(suppressed.total).toBeNull();
    // ...and still reports everything the decision asks to be shown instead.
    expect(suppressed.coverage).toBeGreaterThan(0);
    expect(suppressed.criteria.length + suppressed.unavailable.length).toBe(
      SCORING_CRITERIA.length,
    );
  });

  it('offers a total once the floor is met', () => {
    const offered = score({ scoring: { ...dialysisScoringModel, minimumCoverage: 0 } });
    expect(offered.total).not.toBeNull();
  });
});

/**
 * The coverage floor, pinned against the **shipped** model *and* the **shipped** catalogue.
 *
 * Every other test in this file uses `fixtureScoringModel`, which sets `minimumCoverage: 0` so
 * partial fixtures still produce a total. That leaves the shipped value guarded by nothing: the
 * review measured that moving it from 0.25 to 0.20 left all 1,184 tests green.
 *
 * It is also the file where a wrong number was written down. The first justification for 0.25 said
 * an unreferenced drawing scored 0.20 — measured against the *fixture* catalogue, whose machine has
 * service clearances and so keeps `maintenance_access` measurable. AK98's are null
 * (`vantive_ak98.json`), so the real figure is 0.05. Two worlds mixed into one justification, and
 * the standards file carried it. These assertions exist so the numbers in that file are checked by
 * the build rather than by whoever last read it.
 */
describe('the shipped coverage floor', () => {
  const ak98 = shippedCatalog.get('vantive_ak98');

  function shippedScore(referencePoints: readonly ReferencePointSummary[]) {
    if (!ak98) throw new Error('vantive_ak98 is not in the shipped catalogue');
    const placements = [1, 2, 3].map((n) => ({
      id: `s${n}`,
      equipmentObjectId: 'vantive_ak98',
      equipmentObjectVersion: ak98.version,
      label: `s${n}`,
      transform: { position: { x: 1_500 * n, y: 2_000 }, rotation: 0, mirrored: false },
      spaceId: null,
    }));

    return scoreLayout({
      placements,
      occupants: placements,
      catalog: shippedCatalog,
      ruleSet: dialysisRuleSet,
      boundaries: [],
      room: [
        { x: 0, y: 0 },
        { x: 10_000, y: 0 },
        { x: 10_000, y: 8_000 },
        { x: 0, y: 8_000 },
      ],
      obstructions: [],
      referencePoints,
      object: ak98,
      planStatus: 'calibrated',
      pitchPadding: 900,
      knowledge: dialysisKnowledge,
      scoring: dialysisScoringModel,
      stationTarget: 3,
    });
  }

  it('reaches its ceiling of 0.25 with every reference point placed, and offers a total there', () => {
    const breakdown = shippedScore(ALL_POINTS);
    expect(breakdown.coverage).toBeCloseTo(0.25, 9);
    expect(breakdown.total).not.toBeNull();
  });

  it('scores an unreferenced drawing at 0.05, not 0.20, and offers no total', () => {
    // The corrected figure. 0.20 was the fixture catalogue's answer, not this one.
    const breakdown = shippedScore([]);
    expect(breakdown.coverage).toBeCloseTo(0.05, 9);
    expect(breakdown.total).toBeNull();
  });

  it('suppresses the total when any reference point that matters is missing', () => {
    /*
     * Only three kinds move coverage — `ro_supply` 0.10, `electrical_panel` 0.05, `staff_base`
     * 0.05 — because `drain_routing` carries weight 0 and `installation_feasibility` reports
     * `SC-905` whether `access_entry` is placed or not. Dropping any one of the three therefore
     * falls below the floor, which is the whole behaviour the value 0.25 buys.
     */
    for (const kind of ['ro_supply', 'electrical_panel', 'staff_base'] as const) {
      const breakdown = shippedScore(ALL_POINTS.filter((point) => point.kind !== kind));
      expect(breakdown.coverage, kind).toBeLessThan(0.25);
      expect(breakdown.total, kind).toBeNull();
    }
  });

  it('fails if the shipped floor moves in either direction', () => {
    /*
     * The guard the review found missing. Written against the model as loaded rather than against a
     * literal repeated from it, so lowering the floor to admit a less-measured layout — or raising
     * it and suspending ranking — has to be a deliberate edit that comes here and says so.
     */
    expect(dialysisScoringModel.minimumCoverage).toBeCloseTo(0.25, 9);

    const ceiling = shippedScore(ALL_POINTS);
    const oneMissing = shippedScore(ALL_POINTS.filter((point) => point.kind !== 'electrical_panel'));

    // The floor sits in the gap between "everything obtainable" and "one thing short of it".
    expect(dialysisScoringModel.minimumCoverage).toBeLessThanOrEqual(ceiling.coverage);
    expect(dialysisScoringModel.minimumCoverage).toBeGreaterThan(oneMissing.coverage);
  });
});

/**
 * Owner decision D4: *"Do not use an AABB approximation. Until exact polygon measurement exists,
 * report: Unavailable. Never silently approximate engineering measurements."*
 *
 * `measureComplianceMargin` measured headroom to `boundsOf(room)`. A bounding box is the room only
 * when the room is an axis-aligned rectangle, and the audit measured what that costs: on an L-shaped
 * room a face 300 mm from the arm wall — true ratio 0.2917 — reported **2.7917**, a 9.6x
 * over-report, on the criterion carrying 40 % of the model.
 */
describe('D4 — compliance_margin abstains rather than measuring a bounding box', () => {
  /** An L: the north-east quadrant is not room. Its bounding box is the full square. */
  const L_ROOM = [
    { x: 0, y: 0 },
    { x: 4_000, y: 0 },
    { x: 4_000, y: 3_000 },
    { x: 8_000, y: 3_000 },
    { x: 8_000, y: 8_000 },
    { x: 0, y: 8_000 },
  ];

  /** Convex, and still not its own bounding box — the case a convexity test would have let through. */
  const ROTATED = [
    { x: 4_000, y: 0 },
    { x: 8_000, y: 4_000 },
    { x: 4_000, y: 8_000 },
    { x: 0, y: 4_000 },
  ];

  function marginOf(room: readonly { x: number; y: number }[]) {
    const breakdown = score({ room });
    return breakdown.unavailable.find((entry) => entry.criterion === 'compliance_margin');
  }

  it('reports SC-908 on a concave room', () => {
    expect(marginOf(L_ROOM)?.reasonCode).toBe('SC-908');
  });

  it('reports SC-908 on a convex room that is still not a rectangle', () => {
    // Rectangularity, not convexity, is the condition under which a bounding box is the room. A
    // rotated rectangle is convex and its box is strictly larger, so a convexity test would have
    // approved exactly the same approximation on any room traced off a drawing not square to the page.
    expect(marginOf(ROTATED)?.reasonCode).toBe('SC-908');
  });

  it('does not abstain on the rectangular room the other tests use', () => {
    /*
     * The control. `compliance_margin` is unavailable on the shipped catalogue anyway — every rule
     * carries a null threshold until the AK98 manual arrives, so it reports SC-904 — and this
     * asserts the *reason* is that, not the new refusal. Without it this suite would pass equally
     * well if D4 refused every room.
     */
    const reason = marginOf(fixtureRoom())?.reasonCode;
    expect(reason).not.toBe('SC-908');
  });
});

/**
 * Owner decision **D8**: D4's rule, extended from `compliance_margin` to `maintenance_access`.
 *
 * The same substitution of a bounding box for the room, pointing the other way. D4's version
 * over-reported headroom by measuring to a box edge outside the room; this one credits a service
 * face lying in the **notch** of an L — outside the room, inside its box — as somewhere a
 * technician can stand.
 *
 * ## Why these tests need their own object
 *
 * The guard cannot fire with the shipped catalogue. Both catalogue objects declare every
 * `serviceClearance` side `null` pending the AK98 manual (A-1), `clearanceZones` skips null sides,
 * so `faces` is empty and the criterion abstains with `SC-904` first — on every real project. The
 * fixture machine declares front 1,200 and rear 800, which is what makes the geometry reachable at
 * all here. A guard nobody has watched fire is not delivered, and this repository has shipped three
 * of them.
 */
describe('D8 — maintenance_access abstains rather than measuring a bounding box', () => {
  /** The same L as D4's: the north-east quadrant is not room, and the box is the full square. */
  const L_ROOM = [
    { x: 0, y: 0 },
    { x: 4_000, y: 0 },
    { x: 4_000, y: 3_000 },
    { x: 8_000, y: 3_000 },
    { x: 8_000, y: 8_000 },
    { x: 0, y: 8_000 },
  ];

  const ROTATED = [
    { x: 4_000, y: 0 },
    { x: 8_000, y: 4_000 },
    { x: 4_000, y: 8_000 },
    { x: 0, y: 4_000 },
  ];

  function accessOn(room: readonly Vec2[]) {
    const breakdown = score({ room });
    return {
      measured: measurementOf(breakdown, 'maintenance_access'),
      reason: breakdown.unavailable.find((entry) => entry.criterion === 'maintenance_access'),
    };
  }

  it('reports SC-908 on a concave room', () => {
    expect(accessOn(L_ROOM).reason?.reasonCode).toBe('SC-908');
  });

  it('reports SC-908 on a convex room that is still not a rectangle', () => {
    // Rectangularity, not convexity — a rotated rectangle's box is strictly larger than it is, so a
    // convexity test would approve the same approximation on any room traced off a skewed drawing.
    expect(accessOn(ROTATED).reason?.reasonCode).toBe('SC-908');
  });

  it('measures the rectangular room the other tests use', () => {
    /*
     * The control, and stronger than D4's could be: the fixture object *does* declare clearances,
     * so this criterion produces a number rather than a different abstention. Without it the suite
     * would pass equally well if D8 refused every room.
     */
    const { measured, reason } = accessOn(fixtureRoom());
    expect(reason).toBeUndefined();
    expect(measured?.measured).not.toBeNull();
  });

  it('reports the missing clearance first, because that is the one an engineer can act on', () => {
    /*
     * **The GM made this ordering a condition of D8**, and it is the whole reason the guard sits
     * after the zone check rather than at the top of the function.
     *
     * With the shipped catalogue there is no declared service clearance, so both conditions hold at
     * once on a non-rectangular room. `SC-904` says *supply the AK98 manual* — A-1, work somebody
     * can do. `SC-908` says *your room is not rectangular*, which nobody can act on: they cannot
     * reshape the building. Putting the room guard first would displace the only message that leads
     * anywhere with one that leads nowhere.
     */
    const record = fixtureMachineRecord();
    const blind = createCatalog([
      {
        fileName: 'fixture_station.json',
        raw: {
          ...record,
          serviceClearance: {
            front: null,
            rear: null,
            left: null,
            right: null,
            verification: (record.serviceClearance as { verification: unknown }).verification,
          },
        },
      },
    ]);
    const object = blind.get('fixture_station');
    if (!object) throw new Error('the no-clearance catalogue did not contain its own machine');

    const breakdown = score({ room: L_ROOM, catalog: blind, object });
    const reason = breakdown.unavailable.find(
      (entry) => entry.criterion === 'maintenance_access',
    )?.reasonCode;

    expect(reason).toBe('SC-904');
    expect(reason).not.toBe('SC-908');
  });
});
