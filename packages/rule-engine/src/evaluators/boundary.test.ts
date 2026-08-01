import { describe, expect, it } from 'vitest';

import type { Boundary } from '@mfd/document-model';

import {
  fixtureBoundary,
  fixtureCatalog,
  fixtureClearanceRule,
  fixtureCollisionRule,
  fixtureEquipmentRecord,
  fixtureLShapedRoom,
  fixturePlacement,
  fixtureRuleSet,
} from '../../fixtures/index';
import { evaluate, type SpatialContext } from '../evaluate';
import { renderReason } from '../messages';

/**
 * Boundary collision — equipment against the building.
 *
 * Machines are 900 × 750 mm with a `front-left` origin, so a placement at (x, y)
 * occupies x → x + 900 and y → y + 750.
 */

const VERIFIED_CATALOG = fixtureCatalog([fixtureEquipmentRecord({ dataStatus: 'verified' })]);
const DRAFT_CATALOG = fixtureCatalog([fixtureEquipmentRecord()]);

const BOUNDARY_RULE = fixtureRuleSet([
  fixtureCollisionRule({ ruleId: 'boundary_rule', scope: 'boundary', status: 'verified' }),
]);

function spatial(
  boundaries: readonly Boundary[],
  planStatus: SpatialContext['planStatus'] = 'calibrated',
): SpatialContext {
  return { boundaries, planStatus };
}

function check(
  placements: Parameters<typeof evaluate>[0]['placements'],
  boundaries: readonly Boundary[],
  options: { calibrated?: boolean; draft?: boolean } = {},
) {
  return evaluate({
    placements,
    catalog: options.draft === true ? DRAFT_CATALOG : VERIFIED_CATALOG,
    ruleSet: BOUNDARY_RULE,
    spatial: spatial(boundaries, options.calibrated === false ? 'uncalibrated' : 'calibrated'),
  });
}

const ROOM = fixtureBoundary(
  'room-1',
  'space_outline',
  { x: 0, y: 0 },
  10_000,
  8_000,
  'Treatment area A',
);

describe('room containment', () => {
  it('passes a machine wholly inside the room', () => {
    const report = check([fixturePlacement(1, { x: 2_000, y: 2_000 })], [ROOM]);

    expect(report.results).toHaveLength(1);
    expect(report.results[0]?.level).toBe('GREEN');
    expect(report.results[0]?.reason).toContain('Treatment area A');
  });

  it('flags a machine that extends past the wall, and says by how much', () => {
    // Placed at x = 9,600 with a 900 mm width: 500 mm past a wall at x = 10,000.
    const report = check([fixturePlacement(1, { x: 9_600, y: 2_000 })], [ROOM]);
    const result = report.results[0];

    expect(result?.level).toBe('RED');
    expect(result?.measured).toBe(500);
    expect(result?.reason).toContain('500 mm beyond');
  });

  it('flags a machine that is in no room at all', () => {
    // An engineer who has drawn the rooms and left a machine in the corridor needs
    // to see that, not a silent pass.
    const report = check([fixturePlacement(1, { x: 40_000, y: 40_000 })], [ROOM]);

    expect(report.results[0]?.level).toBe('RED');
    expect(report.results[0]?.reason).toContain('outside every room outline');
  });

  it('judges a machine against the room it is in, not against every room', () => {
    // A machine in room A is trivially outside room B. "Inside every room" is not
    // the question.
    const roomB = fixtureBoundary(
      'room-2',
      'space_outline',
      { x: 20_000, y: 0 },
      10_000,
      8_000,
      'Treatment area B',
    );
    const report = check([fixturePlacement(1, { x: 2_000, y: 2_000 })], [ROOM, roomB]);

    expect(report.results).toHaveLength(1);
    expect(report.results[0]?.level).toBe('GREEN');
  });

  it('names the room a straddling machine is mostly in', () => {
    const roomB = fixtureBoundary(
      'room-2',
      'space_outline',
      { x: 10_000, y: 0 },
      10_000,
      8_000,
      'Treatment area B',
    );
    // Centre at x = 10,050: just over the party wall, mostly in room B.
    const report = check([fixturePlacement(1, { x: 9_600, y: 2_000 })], [ROOM, roomB]);

    expect(report.results[0]?.level).toBe('RED');
    expect(report.results[0]?.reason).toContain('Treatment area B');
  });
});

describe('equipment against a wall', () => {
  /*
   * > Owner decision, VD-5 / A-4: *"A footprint touching the room boundary is considered contained.
   * > Only geometry extending outside the boundary is a containment failure … Clearance evaluation
   * > remains completely separate from containment evaluation."*
   *
   * Raised by the Hospital_044 verification, where equipment against a wall is not an edge case but
   * the arrangement the drawing shows — and every such machine reported RED for extending beyond a
   * room it was entirely inside. See docs/verification/HOSPITAL_044_VERIFICATION.md § 5.
   */

  it('passes a machine flush against a wall', () => {
    // y = 0 puts its south edge exactly on the room's south wall.
    const report = check([fixturePlacement(1, { x: 2_000, y: 0 })], [ROOM]);

    expect(report.results[0]?.level).toBe('GREEN');
    expect(report.counts.RED ?? 0).toBe(0);
  });

  it('passes a machine wedged into a corner, touching two walls', () => {
    const report = check([fixturePlacement(1, { x: 0, y: 0 })], [ROOM]);

    expect(report.results[0]?.level).toBe('GREEN');
  });

  it('passes a whole row of machines standing along a wall', () => {
    // The Hospital_044 shape: five stations in a line, every one of them on the wall. This is the
    // case that produced five REDs and a `not_acceptable` verdict for a sound layout.
    const row = [0, 1, 2, 3, 4].map((index) =>
      fixturePlacement(index + 1, { x: index * 2_000, y: 0 }),
    );
    const report = check(row, [ROOM]);

    expect(report.counts.RED ?? 0).toBe(0);
    expect(report.counts.GREEN).toBe(5);
  });

  it('still flags a machine one millimetre over the wall', () => {
    /*
     * The half of the decision that keeps it safe. Contact is contained; *crossing* is not, and one
     * millimetre of crossing is still crossing. Without this, the tests above would pass equally
     * against a containment check that had simply been switched off.
     */
    const report = check([fixturePlacement(1, { x: 2_000, y: -1 })], [ROOM]);

    expect(report.results[0]?.level).toBe('RED');
  });
});

describe('containment and clearance are separate questions', () => {
  /*
   * > Owner decision, VD-5 / A-4: *"Clearance evaluation remains completely separate from
   * > containment evaluation."*
   *
   * **Narrowed by owner decision D3**, which is worth stating precisely because the earlier version
   * of this comment claimed more than A-4 does. A-4 separates clearance from *containment*. It does
   * not make walls invisible: `boundary.ts` treats only `space_outline` as a container, and D3 —
   * *"treat walls as real obstructions"* — made clearance measure `wall` and `obstruction` the way
   * `@mfd/ai-local`'s `measureMaintenanceAccess` already did.
   *
   * So the invariant these hold is now about the **room outline** specifically, and there is a
   * behavioural test below proving the other half: a wall in a face's clearance zone produces the
   * same finding as an equal-footprint machine in the same place.
   */
  const BOTH_RULES = fixtureRuleSet([
    fixtureCollisionRule({ ruleId: 'boundary_rule', scope: 'boundary', status: 'verified' }),
    fixtureClearanceRule({ ruleId: 'front_clearance', status: 'verified', threshold: 1_200 }),
  ]);

  function evaluateWith(boundaries: readonly Boundary[]) {
    // Two machines 1,000 mm apart along y — inside the clearance threshold, so the clearance rule
    // has something to say. Both stand flush on the room's south wall.
    return evaluate({
      placements: [
        fixturePlacement(1, { x: 2_000, y: 0 }),
        fixturePlacement(2, { x: 2_000, y: 1_750 }),
      ],
      catalog: VERIFIED_CATALOG,
      ruleSet: BOTH_RULES,
      spatial: spatial(boundaries),
    });
  }

  const clearanceOf = (report: ReturnType<typeof evaluateWith>) =>
    report.results
      .filter((result) => result.ruleId === 'front_clearance')
      .map((result) => ({ level: result.level, code: result.reasonCode, measured: result.measured }));

  it('leaves every clearance finding identical whether a ROOM OUTLINE is drawn or not', () => {
    // A-4, still held: tracing the room an engineer works in must not change what can be serviced.
    expect(clearanceOf(evaluateWith([ROOM]))).toEqual(clearanceOf(evaluateWith([])));
  });

  it('measures a wall in the clearance zone exactly as it measures a machine there', () => {
    /*
     * Owner decision D3, as behaviour rather than as source text.
     *
     * The audit's case: a 1,200 mm front clearance with something 100 mm in front of the face. Made
     * of equipment it reported `RED measured=100`; made of a *wall* it reported `GREEN`, because
     * `evaluateClearance` could not see boundaries at all. Here the same obstruction is built both
     * ways and the two findings must agree.
     */
    const subject = fixturePlacement(1, { x: 2_000, y: 0 });
    // The fixture machine is 900 x 750, front-left, front edge +y — so its front face sits at
    // y = 750 and a blocker starting at y = 850 leaves exactly 100 mm.
    const blockerBounds = { minX: 2_000, maxX: 2_900, minY: 850, maxY: 1_000 };

    const asMachine = evaluate({
      placements: [subject, fixturePlacement(2, { x: 2_000, y: 850 })],
      catalog: VERIFIED_CATALOG,
      ruleSet: BOTH_RULES,
      spatial: spatial([]),
    }).results.filter(
      (result) => result.ruleId === 'front_clearance' && result.placementIds[0] === subject.id,
    );

    const asWall = evaluate({
      placements: [subject],
      catalog: VERIFIED_CATALOG,
      ruleSet: BOTH_RULES,
      spatial: spatial([
        {
          id: 'wall-1',
          kind: 'wall',
          label: 'Partition',
          obstructionType: null,
          vertices: [
            { x: blockerBounds.minX, y: blockerBounds.minY },
            { x: blockerBounds.maxX, y: blockerBounds.minY },
            { x: blockerBounds.maxX, y: blockerBounds.maxY },
            { x: blockerBounds.minX, y: blockerBounds.maxY },
          ],
        },
      ]),
    }).results.filter((result) => result.ruleId === 'front_clearance');

    expect(asMachine[0]?.measured).toBe(100);
    expect(asWall).toHaveLength(1);
    expect(asWall[0]?.measured).toBe(100);
    expect(asWall[0]?.level).toBe(asMachine[0]?.level);
  });

  it('abstains rather than measuring a non-convex wall in front of the face', () => {
    /*
     * Owner decision D3's own fallback — *"if the implementation cannot yet measure wall clearance
     * correctly, abstain"* — and the rule-engine twin of the owner's existing `SC-907`.
     *
     * `gapAlongNormal` takes one global minimum across its lateral clip, which is the nearest
     * *connected* material only when the polygon is convex. An L-shaped partition can put a
     * disconnected far arm in the same band as a near one, and the function cannot tell them apart.
     * So the face reports `RC-905` with no number rather than a number nobody should trust.
     *
     * Found missing by mutation: deleting the convexity check left all 231 tests green.
     */
    const subject = fixturePlacement(1, { x: 2_000, y: 0 });
    const report = evaluate({
      placements: [subject],
      catalog: VERIFIED_CATALOG,
      ruleSet: BOTH_RULES,
      spatial: spatial([
        {
          id: 'wall-L',
          kind: 'wall',
          label: 'Riser wrap',
          obstructionType: null,
          // Reflex vertex at (2,450, 1,000): a near arm across the band and a far arm behind it.
          vertices: [
            { x: 2_000, y: 850 },
            { x: 2_900, y: 850 },
            { x: 2_900, y: 1_000 },
            { x: 2_450, y: 1_000 },
            { x: 2_450, y: 1_600 },
            { x: 2_000, y: 1_600 },
          ],
        },
      ]),
    });

    const clearance = report.results.filter((result) => result.ruleId === 'front_clearance');
    expect(clearance).toHaveLength(1);
    expect(clearance[0]?.reasonCode).toBe('RC-905');
    expect(clearance[0]?.measured).toBeNull();
    // Abstention, not a pass and not a violation.
    expect(clearance[0]?.level).not.toBe('GREEN');
  });

  it('answers containment without consulting the clearance threshold', () => {
    // Both machines are on the wall and neither is outside the room. That the pair is too close to
    // *each other* is a different finding, from a different rule, and it does not make either of
    // them leave the room.
    const report = evaluateWith([ROOM]);
    const containment = report.results.filter((result) => result.ruleId === 'boundary_rule');

    expect(containment).toHaveLength(2);
    expect(containment.every((result) => result.level === 'GREEN')).toBe(true);
  });
});

describe('concave rooms', () => {
  const L_ROOM = fixtureLShapedRoom();

  it('passes a machine in the arm of an L-shaped room', () => {
    const report = check([fixturePlacement(1, { x: 1_000, y: 6_000 })], [L_ROOM]);
    expect(report.results[0]?.level).toBe('GREEN');
  });

  it('fails a machine standing in the notch of an L', () => {
    // The case the separating axis test gets wrong: this footprint is inside the
    // room's convex hull and outside the room. SAT would call it a pass, which is a
    // false GREEN on exactly the geometry an engineer is most likely to get wrong.
    const report = check([fixturePlacement(1, { x: 8_000, y: 6_000 })], [L_ROOM]);

    expect(report.results[0]?.level).toBe('RED');
    expect(report.results[0]?.reason).toContain('outside every room outline');
  });

  it('fails a machine reaching around the inner corner', () => {
    // Corner of the L is at (6000, 4000). A machine spanning it is partly out.
    const report = check([fixturePlacement(1, { x: 5_600, y: 3_800 })], [L_ROOM]);
    expect(report.results[0]?.level).toBe('RED');
  });
});

describe('obstructions', () => {
  const COLUMN = fixtureBoundary(
    'column-1',
    'obstruction',
    { x: 4_000, y: 4_000 },
    600,
    600,
    'Column C4',
  );

  it('passes a machine clear of the column', () => {
    const report = check([fixturePlacement(1, { x: 1_000, y: 1_000 })], [ROOM, COLUMN]);

    expect(report.results).toHaveLength(1);
    expect(report.results[0]?.level).toBe('GREEN');
    expect(report.results[0]?.reason).toContain('clears every obstruction');
  });

  it('flags a machine standing on the column, and says how far into it', () => {
    // Machine spans x 3,800 → 4,700, y 4,000 → 4,750. The column spans 4,000 → 4,600
    // both ways. No *machine* corner lands inside the column — the column's corners
    // land inside the machine, which is why the depth is measured both ways.
    const report = check([fixturePlacement(1, { x: 3_800, y: 4_000 })], [ROOM, COLUMN]);
    const result = report.results.find((entry) => entry.reason.includes('Column C4'));

    expect(result?.level).toBe('RED');
    // Deepest is the column's (4000, 4600) corner: 150 mm from the machine's near
    // long edge at y = 4,750.
    expect(result?.measured).toBe(150);
    expect(result?.reason).toContain('overlaps Column C4 by 150 mm');
  });

  it('detects a machine that entirely covers a small obstruction', () => {
    // No edge crossing at all — a pure containment case an intersection-only test
    // would report as clear.
    const riser = fixtureBoundary('riser', 'obstruction', { x: 2_100, y: 2_100 }, 200, 200, 'Riser');
    const report = check([fixturePlacement(1, { x: 2_000, y: 2_000 })], [ROOM, riser]);

    expect(report.results.some((entry) => entry.level === 'RED')).toBe(true);
  });

  it('reports no depth when no corner lands inside a thin partition', () => {
    // A machine spanning a 100 mm partition crosses its edges without any corner in
    // it. There is a real overlap and no well-defined depth; reporting zero would
    // read as "just touching".
    const partition = fixtureBoundary(
      'partition',
      'wall',
      { x: 2_400, y: 0 },
      100,
      8_000,
      'Partition',
    );
    const report = check([fixturePlacement(1, { x: 2_000, y: 2_000 })], [ROOM, partition]);
    const result = report.results.find((entry) => entry.reason.includes('Partition'));

    expect(result?.level).toBe('RED');
    expect(result?.measured).toBeNull();
  });

  it('checks obstructions even when no room has been drawn', () => {
    const report = check([fixturePlacement(1, { x: 1_000, y: 1_000 })], [COLUMN]);
    expect(report.results[0]?.level).toBe('GREEN');
    expect(report.results[0]?.reason).toContain('clears every obstruction');
  });
});

describe('nothing to check', () => {
  it('says so rather than producing no result', () => {
    // A rule that silently produced nothing would be indistinguishable from a rule
    // everything passes.
    const report = check([fixturePlacement(1, { x: 0, y: 0 })], []);

    expect(report.results).toHaveLength(1);
    expect(report.results[0]?.level).toBe('YELLOW');
    expect(report.results[0]?.reason).toContain('nothing was checked');
  });
});

describe('draft policy', () => {
  it('is not downgraded by an unrelated draft group on the machine', () => {
    // A boundary check reads a design footprint and a traced boundary — no manufacturer
    // figure at all. So an unsourced service clearance cannot make "this machine is
    // inside the room" provisional; it is a fact about a polygon and a rectangle.
    //
    // Under record-level verification this was YELLOW, which marked a sound geometric
    // conclusion as provisional because a different part of the record was unknown.
    const report = check([fixturePlacement(1, { x: 2_000, y: 2_000 })], [ROOM], { draft: true });

    expect(report.results[0]?.dataStatus).toBe('verified');
    expect(report.results[0]?.level).toBe('GREEN');
  });

  it('cannot reach GREEN from a draft rule', () => {
    // AD-6a still holds where it applies: the rule itself is the input here, and a
    // provisional rule must not sign anything off.
    const draftRule = fixtureRuleSet([
      fixtureCollisionRule({ ruleId: 'boundary_rule', scope: 'boundary', status: 'draft' }),
    ]);
    const report = evaluate({
      placements: [fixturePlacement(1, { x: 2_000, y: 2_000 })],
      catalog: VERIFIED_CATALOG,
      ruleSet: draftRule,
      spatial: spatial([ROOM], 'calibrated'),
    });

    expect(report.results[0]?.level).toBe('YELLOW');
    expect(report.results[0]?.dataStatus).toBe('draft');
  });

  it('still reports a violation as RED on draft data', () => {
    // A breach is never softened for being provisional — that would make poor data
    // hide problems.
    const draftRule = fixtureRuleSet([
      fixtureCollisionRule({ ruleId: 'boundary_rule', scope: 'boundary', status: 'draft' }),
    ]);
    const report = evaluate({
      placements: [fixturePlacement(1, { x: 9_600, y: 2_000 })],
      catalog: DRAFT_CATALOG,
      ruleSet: draftRule,
      spatial: spatial([ROOM], 'calibrated'),
    });

    expect(report.results[0]?.level).toBe('RED');
    expect(report.results[0]?.dataStatus).toBe('draft');
  });
});

describe('the calibration gate', () => {
  it('downgrades a pass on an uncalibrated plan', () => {
    // Nothing about the building has been checked; the outline is pixels somebody
    // eyeballed.
    const report = check([fixturePlacement(1, { x: 2_000, y: 2_000 })], [ROOM], {
      calibrated: false,
    });

    expect(report.results[0]?.level).toBe('YELLOW');
    // The caveat is a code, not a clause appended to the sentence — the finding itself is
    // unchanged and still true. Both facts, separately, so both survive translation.
    expect(report.results[0]?.reasonCode).toBe('RC-321');
    expect(report.results[0]?.caveatCode).toBe('RC-911');
    expect(renderReason('ko', 'RC-911', {})).toContain('축척');
  });

  it('leaves a finding uncaveated when the plan is calibrated', () => {
    const report = check([fixturePlacement(1, { x: 2_000, y: 2_000 })], [ROOM], {
      calibrated: true,
    });

    expect(report.results[0]?.caveatCode).toBeNull();
  });

  it('leaves a violation RED on an uncalibrated plan', () => {
    const report = check([fixturePlacement(1, { x: 40_000, y: 40_000 })], [ROOM], {
      calibrated: false,
    });
    expect(report.results[0]?.level).toBe('RED');
  });

  it('leaves a calibrated plan alone', () => {
    const report = check([fixturePlacement(1, { x: 2_000, y: 2_000 })], [ROOM]);
    expect(report.results[0]?.level).toBe('GREEN');
    expect(report.results[0]?.reason).not.toContain('not calibrated');
  });

  it('treats "no plan at all" as exact rather than as unchecked', () => {
    // An engineer laying a room out in millimetres with no drawing behind it has
    // exact geometry. It is the half-imported plan that is dangerous, because it
    // looks like a measured drawing.
    const report = evaluate({
      placements: [fixturePlacement(1, { x: 2_000, y: 2_000 })],
      catalog: VERIFIED_CATALOG,
      ruleSet: BOUNDARY_RULE,
      spatial: spatial([ROOM], 'none'),
    });
    expect(report.results[0]?.level).toBe('GREEN');
  });
});

describe('findings volume', () => {
  it('produces one finding per machine when every machine is clear', () => {
    const placements = Array.from({ length: 20 }, (_, index) =>
      fixturePlacement(index, { x: (index % 5) * 1_500 + 200, y: Math.floor(index / 5) * 1_500 + 200 }),
    );
    const report = check(placements, [ROOM]);

    expect(report.results).toHaveLength(20);
    expect(report.counts.GREEN).toBe(20);
  });
});
