import { describe, expect, it } from 'vitest';

import {
  fixtureCatalog,
  fixtureClearanceRule,
  fixtureCollisionRule,
  fixtureEquipmentRecord,
  fixturePlacement,
  fixtureRuleSet,
} from '../fixtures/index';
import { evaluate } from './evaluate';
import { renderReason } from './messages';
import { decideLevel, weakestStatus } from './result';

const NO_CLEARANCE = { front: null, rear: null, left: null, right: null };

/** Machines are 900 wide x 750 deep, front-left origin, front edge facing +y. */
const machineAt = fixturePlacement;

describe('clearance evaluation', () => {
  it('passes when the gap meets the threshold', () => {
    const report = evaluate({
      placements: [machineAt(1, { x: 0, y: 0 }), machineAt(2, { x: 0, y: 2_000 })],
      catalog: fixtureCatalog([fixtureEquipmentRecord({ dataStatus: 'verified' })]),
      ruleSet: fixtureRuleSet([
        fixtureClearanceRule({ threshold: 1_200, status: 'verified' }),
      ]),
    });

    // Machine 1's front face sits at y = 750; machine 2 begins at y = 2000.
    const first = report.results.find((r) => r.placementIds[0] === 'placement-1');
    expect(first?.measured).toBe(1_250);
    expect(first?.level).toBe('GREEN');
  });

  it('fails when the gap is short of the threshold', () => {
    const report = evaluate({
      placements: [machineAt(1, { x: 0, y: 0 }), machineAt(2, { x: 0, y: 1_500 })],
      catalog: fixtureCatalog([fixtureEquipmentRecord({ dataStatus: 'verified' })]),
      ruleSet: fixtureRuleSet([
        fixtureClearanceRule({ threshold: 1_200, status: 'verified' }),
      ]),
    });

    const first = report.results.find((r) => r.placementIds[0] === 'placement-1');
    expect(first?.measured).toBe(750);
    expect(first?.level).toBe('RED');
    // The code is the assertion, because the code is the contract: RC-101 means
    // "insufficient service clearance" whatever either language's wording becomes.
    expect(first?.reasonCode).toBe('RC-101');
    expect(first?.reasonParams).toMatchObject({ measured: 750, required: 1_200 });
    // And both languages compose from it. Asserting only the English would let a broken
    // Korean template ship.
    expect(renderReason('en', 'RC-101', first?.reasonParams ?? {})).toContain('750 mm');
    expect(renderReason('ko', 'RC-101', first?.reasonParams ?? {})).toContain('전면');
  });

  it('reports YELLOW with "threshold unknown" when no figure exists', () => {
    const report = evaluate({
      placements: [machineAt(1, { x: 0, y: 0 })],
      catalog: fixtureCatalog([
        fixtureEquipmentRecord({ serviceClearance: NO_CLEARANCE }),
      ]),
      ruleSet: fixtureRuleSet([fixtureClearanceRule({ threshold: null })]),
    });

    expect(report.results[0]?.level).toBe('YELLOW');
    expect(report.results[0]?.reasonCode).toBe('RC-110');
    expect(report.results[0]?.thresholdOrigin).toBe('none');
  });

  it('records which source the applied threshold came from', () => {
    const report = evaluate({
      placements: [machineAt(1, { x: 0, y: 0 })],
      catalog: fixtureCatalog([
        fixtureEquipmentRecord({
          serviceClearance: { ...NO_CLEARANCE, front: 1_500 },
        }),
      ]),
      ruleSet: fixtureRuleSet([fixtureClearanceRule({ threshold: 1_200 })]),
    });

    expect(report.results[0]?.appliedValue).toBe(1_500);
    expect(report.results[0]?.thresholdOrigin).toBe('equipment');
  });

  it('ignores machines beside the face rather than in front of it', () => {
    const report = evaluate({
      placements: [machineAt(1, { x: 0, y: 0 }), machineAt(2, { x: 5_000, y: 0 })],
      catalog: fixtureCatalog([fixtureEquipmentRecord({ dataStatus: 'verified' })]),
      ruleSet: fixtureRuleSet([
        fixtureClearanceRule({ threshold: 1_200, status: 'verified' }),
      ]),
    });

    const first = report.results.find((r) => r.placementIds[0] === 'placement-1');
    expect(first?.measured).toBeNull();
    expect(first?.level).toBe('GREEN');
  });

  it('applies only to the equipment it selects', () => {
    const report = evaluate({
      placements: [machineAt(1, { x: 0, y: 0 })],
      catalog: fixtureCatalog([fixtureEquipmentRecord()]),
      ruleSet: fixtureRuleSet([
        fixtureClearanceRule({ equipmentIds: ['some_other_machine'] }),
      ]),
    });

    expect(report.results).toHaveLength(0);
  });

  it('measures a rotated, non-colliding neighbour against only the part of it in front of the face', () => {
    // A rotated 800x800 station at (-700, -900), rotated 10° (10_000 millidegrees), does not
    // collide with the subject at the origin — `polygonsOverlap` finds a separating axis among the
    // rotated rectangle's own edge normals. Its nearest corner sits at roughly (-51, 27): laterally
    // outside the rear face's own [0, 800] band, standing beside the face rather than in front of
    // it. The sixth Critical 0 review round's fix let that corner set the whole measurement anyway,
    // producing `measured: -27` and the sentence "FX 1 has -27 mm of rear clearance" (clamped to 0)
    // for a pair the collision rule does not call touching — the seventh review round found the true
    // whole-face-clipped gap is +263 mm, and the clamp was masking a measurement bug, not guarding
    // a real one. `@mfd/rule-engine`'s `gapAlongNormal` now clips to the face's own band first.
    const report = evaluate({
      placements: [
        machineAt(1, { x: 0, y: 0 }, 'fixture_machine', 0),
        machineAt(2, { x: -700, y: -900 }, 'fixture_machine', 10_000),
      ],
      catalog: fixtureCatalog([fixtureEquipmentRecord({ width: 800, depth: 800 })]),
      ruleSet: fixtureRuleSet([
        fixtureClearanceRule({ side: 'rear', threshold: 800, status: 'verified' }),
      ]),
    });

    const first = report.results.find((r) => r.placementIds[0] === 'placement-1');
    expect(first?.measured).toBe(263);
    expect(first?.level).toBe('RED');
    expect(first?.reasonCode).toBe('RC-101');
  });

  it('clamps a genuinely overlapping neighbour at zero rather than reporting a signed gap', () => {
    // Two 800x800 stations, directly overlapping (no rotation needed): the second sits at
    // (0, -100), so its footprint spans y ∈ [-100, 700] against the subject's own y ∈ [0, 800] —
    // squarely inside the subject's rear face, not beside it, so clipping to the face's band
    // changes nothing here. This is the case the clamp exists for: `evaluate` has no Gate 2 of its
    // own — it is the live validation engine, and it reports every category, including clearance,
    // for whatever the engineer has actually drawn, collision included. A collision rule fires on
    // this pair too, but independently: clearance is not gated behind it, so a signed, meaningless
    // "-700 mm of rear clearance" would otherwise reach a live finding while the engineer is still
    // mid-drag. Owner decision, unchanged by the seventh review round: clamp at zero.
    const report = evaluate({
      placements: [
        machineAt(1, { x: 0, y: 0 }, 'fixture_machine', 0),
        machineAt(2, { x: 0, y: -100 }, 'fixture_machine', 0),
      ],
      catalog: fixtureCatalog([fixtureEquipmentRecord({ width: 800, depth: 800 })]),
      ruleSet: fixtureRuleSet([
        fixtureClearanceRule({ side: 'rear', threshold: 800, status: 'verified' }),
      ]),
    });

    const first = report.results.find((r) => r.placementIds[0] === 'placement-1');
    expect(first?.measured).toBe(0);
    expect(first?.level).toBe('RED');
    expect(first?.reasonCode).toBe('RC-101');
  });
});

describe('collision evaluation', () => {
  it('reports overlapping machines', () => {
    const report = evaluate({
      placements: [machineAt(1, { x: 0, y: 0 }), machineAt(2, { x: 400, y: 0 })],
      catalog: fixtureCatalog([fixtureEquipmentRecord()]),
      ruleSet: fixtureRuleSet([fixtureCollisionRule()]),
    });

    const collision = report.results.find((r) => r.category === 'collision');
    expect(collision?.level).toBe('RED');
    expect(collision?.measured).toBe(500);
  });

  it('anchors a finding on each machine involved', () => {
    // Equipment-centred: an engineer looking at either machine must see the
    // problem, so both report it with themselves as the subject.
    const report = evaluate({
      placements: [machineAt(1, { x: 0, y: 0 }), machineAt(2, { x: 400, y: 0 })],
      catalog: fixtureCatalog([fixtureEquipmentRecord()]),
      ruleSet: fixtureRuleSet([fixtureCollisionRule()]),
    });

    const collisions = report.results.filter((r) => r.category === 'collision');
    expect(collisions).toHaveLength(2);
    expect(collisions.map((r) => r.placementIds[0]).sort()).toEqual([
      'placement-1',
      'placement-2',
    ]);
    // placementIds[0] is the subject; [1] is the machine it collides with.
    expect(collisions.map((r) => r.placementIds[1]).sort()).toEqual([
      'placement-1',
      'placement-2',
    ]);
  });

  it('passes separated machines', () => {
    const report = evaluate({
      placements: [machineAt(1, { x: 0, y: 0 }), machineAt(2, { x: 2_000, y: 0 })],
      catalog: fixtureCatalog([fixtureEquipmentRecord({ dataStatus: 'verified' })]),
      ruleSet: fixtureRuleSet([fixtureCollisionRule({ status: 'verified' })]),
    });

    const collisions = report.results.filter((r) => r.category === 'collision');
    // One clear finding per machine, not one per pair.
    expect(collisions).toHaveLength(2);
    expect(collisions.every((r) => r.level === 'GREEN')).toBe(true);
    for (const result of collisions) {
      expect(result.placementIds).toHaveLength(1);
      expect(result.measured).toBeNull();
    }
  });

  it('says a boundary rule checked nothing rather than silently passing', () => {
    // Sprint 4 implements boundary scope. With no rooms drawn there is still nothing
    // to check, and saying so is the point: a rule that produced no result would be
    // indistinguishable from a rule everything passed.
    const report = evaluate({
      placements: [machineAt(1, { x: 0, y: 0 })],
      catalog: fixtureCatalog([fixtureEquipmentRecord()]),
      ruleSet: fixtureRuleSet([fixtureCollisionRule({ scope: 'boundary' })]),
    });

    expect(report.results[0]?.level).toBe('YELLOW');
    expect(report.results[0]?.reason).toContain('nothing was checked');
  });
});

describe('draft policy', () => {
  it('never produces GREEN from a draft rule', () => {
    const report = evaluate({
      placements: [machineAt(1, { x: 0, y: 0 })],
      catalog: fixtureCatalog([fixtureEquipmentRecord({ dataStatus: 'verified' })]),
      ruleSet: fixtureRuleSet([
        fixtureClearanceRule({ threshold: 1_200, status: 'draft' }),
      ]),
    });

    expect(report.results[0]?.level).toBe('YELLOW');
    expect(report.results[0]?.dataStatus).toBe('draft');
  });

  it('never produces GREEN when the threshold came from a draft equipment group', () => {
    // The rule sets no figure, so the clearance is read off the equipment record — and
    // that group is unsourced. This is the case the draft policy exists for, and it is
    // unchanged by per-group verification.
    const report = evaluate({
      placements: [machineAt(1, { x: 0, y: 0 })],
      catalog: fixtureCatalog([
        fixtureEquipmentRecord({
          dataStatus: 'draft',
          serviceClearance: { front: 1_200, rear: null, left: null, right: null },
        }),
      ]),
      ruleSet: fixtureRuleSet([fixtureClearanceRule({ threshold: null, status: 'verified' })]),
    });

    expect(report.results[0]?.thresholdOrigin).toBe('equipment');
    expect(report.results[0]?.dataStatus).toBe('draft');
    expect(report.results[0]?.level).toBe('YELLOW');
    // `thresholdOrigin: 'equipment'` plus `dataStatus: 'draft'` is what says which figure
    // to chase, and it says it in a form a report can render in either language.
    //
    // Until Sprint 5 the English sentence carried a clause naming the unsourced figure.
    // It was removed with reason codes: it restated these two fields, and a clause bolted
    // onto a template needs a second template per language per code. The pair above is
    // the machine-readable version of the same statement, which is what the bilingual
    // report needs anyway.
    expect(report.results[0]?.reasonCode).toBe('RC-103');
  });

  it('does reach GREEN when the draft group was never read', () => {
    // The change per-group verification makes. The rule carries its own verified
    // threshold, so the equipment's service clearance is not consulted — and an unsourced
    // clearance must not downgrade a finding that did not use it. Under record-level
    // status this was YELLOW, which told an engineer nothing and marked a sound
    // conclusion as provisional.
    const report = evaluate({
      placements: [machineAt(1, { x: 0, y: 0 })],
      catalog: fixtureCatalog([fixtureEquipmentRecord({ dataStatus: 'draft' })]),
      ruleSet: fixtureRuleSet([
        fixtureClearanceRule({ threshold: 1_200, status: 'verified' }),
      ]),
    });

    expect(report.results[0]?.thresholdOrigin).toBe('rule');
    expect(report.results[0]?.dataStatus).toBe('verified');
    expect(report.results[0]?.level).toBe('GREEN');
  });

  it('does not downgrade a collision finding for an unrelated draft group', () => {
    // An overlap check reads footprints and no manufacturer figure at all. "These two
    // do not overlap" is a fact about two rectangles; an unknown service clearance
    // elsewhere in the record cannot soften it.
    const report = evaluate({
      placements: [machineAt(1, { x: 0, y: 0 }), machineAt(2, { x: 5_000, y: 0 })],
      catalog: fixtureCatalog([fixtureEquipmentRecord({ dataStatus: 'draft' })]),
      ruleSet: fixtureRuleSet([fixtureCollisionRule({ status: 'verified' })]),
    });

    expect(report.results).toHaveLength(2);
    expect(report.results.every((result) => result.dataStatus === 'verified')).toBe(true);
    expect(report.results.every((result) => result.level === 'GREEN')).toBe(true);
  });

  it('still reports a violation at full severity when the data is draft', () => {
    // Provisional data must not hide a problem — that would be the wrong
    // direction to fail in.
    const report = evaluate({
      placements: [machineAt(1, { x: 0, y: 0 }), machineAt(2, { x: 0, y: 1_000 })],
      catalog: fixtureCatalog([fixtureEquipmentRecord({ dataStatus: 'draft' })]),
      ruleSet: fixtureRuleSet([
        fixtureClearanceRule({ threshold: 1_200, status: 'draft' }),
      ]),
    });

    const first = report.results.find((r) => r.placementIds[0] === 'placement-1');
    expect(first?.level).toBe('RED');
    expect(first?.dataStatus).toBe('draft');
  });

  it('reaches GREEN only when rule and equipment are both verified', () => {
    const report = evaluate({
      placements: [machineAt(1, { x: 0, y: 0 })],
      catalog: fixtureCatalog([fixtureEquipmentRecord({ dataStatus: 'verified' })]),
      ruleSet: fixtureRuleSet([
        fixtureClearanceRule({ threshold: 1_200, status: 'verified' }),
      ]),
    });

    expect(report.results[0]?.level).toBe('GREEN');
  });

  it('flags the report when any input is provisional', () => {
    const report = evaluate({
      placements: [machineAt(1, { x: 0, y: 0 })],
      catalog: fixtureCatalog([fixtureEquipmentRecord({ dataStatus: 'draft' })]),
      ruleSet: fixtureRuleSet([fixtureClearanceRule({ threshold: 1_200 })]),
    });

    expect(report.hasDraftInputs).toBe(true);
  });
});

describe('level decision', () => {
  it('honours an advisory severity', () => {
    expect(
      decideLevel({ violated: true, severity: 'YELLOW', dataStatus: 'verified' }),
    ).toBe('YELLOW');
  });

  it('never invents a fourth status for an unevaluable rule', () => {
    expect(
      decideLevel({ violated: null, severity: 'RED', dataStatus: 'verified' }),
    ).toBe('YELLOW');
  });
});

describe('weakestStatus', () => {
  it('is draft when either input is draft', () => {
    expect(weakestStatus('draft', 'verified')).toBe('draft');
    expect(weakestStatus('verified', 'draft')).toBe('draft');
    expect(weakestStatus('verified', 'verified')).toBe('verified');
  });
});

describe('the report', () => {
  it('counts each level and puts the worst first', () => {
    const report = evaluate({
      placements: [machineAt(1, { x: 0, y: 0 }), machineAt(2, { x: 400, y: 0 })],
      catalog: fixtureCatalog([fixtureEquipmentRecord()]),
      ruleSet: fixtureRuleSet([
        fixtureClearanceRule({ threshold: 1_200 }),
        fixtureCollisionRule(),
      ]),
    });

    expect(report.counts.RED).toBeGreaterThan(0);
    expect(report.results[0]?.level).toBe('RED');
    expect(report.ruleSetId).toBe('fixture');
  });

  it('carries the rule source into every result', () => {
    const report = evaluate({
      placements: [machineAt(1, { x: 0, y: 0 })],
      catalog: fixtureCatalog([fixtureEquipmentRecord()]),
      ruleSet: fixtureRuleSet([
        fixtureClearanceRule({ threshold: 1_200, status: 'verified' }),
      ]),
    });

    expect(report.results[0]?.source.document).toBe('Fixture TS Installation Standard');
    expect(report.results[0]?.source.revision).toBe('Rev. 1');
  });
});

/**
 * Owner decision D5: *"If one placement cannot be evaluated, the level cannot receive a PASS.
 * Report: Inconclusive and identify the unevaluable placement."*
 *
 * The audit's smallest case, verbatim: two machines 100 mm apart, one referencing a catalogue id
 * that does not exist. The engine dropped it three times over — `evaluate` never resolved it,
 * `evaluateCollision` left it out of the scene, `evaluateClearance` skipped it — and then reported
 * the survivor GREEN twice: *"FX 1 does not overlap any other equipment"* and *"Nothing stands
 * within FX 1's 1,200 mm front clearance."* Both sentences were positively false.
 */
describe('D5 — a placement the catalogue cannot answer for', () => {
  const ghost = { ...machineAt(2, { x: 0, y: 850 }), equipmentObjectId: 'ghost_machine' };

  function reportWithGhost() {
    return evaluate({
      placements: [machineAt(1, { x: 0, y: 0 }), ghost],
      catalog: fixtureCatalog([fixtureEquipmentRecord({ dataStatus: 'verified' })]),
      ruleSet: fixtureRuleSet([
        fixtureClearanceRule({ threshold: 1_200, status: 'verified' }),
        fixtureCollisionRule({ status: 'verified' }),
      ]),
    });
  }

  it('names the unevaluable placement instead of dropping it', () => {
    const report = reportWithGhost();
    const named = report.results.filter((result) => result.reasonCode === 'RC-903');

    expect(named).toHaveLength(1);
    expect(named[0]?.placementIds).toEqual([ghost.id]);
    // The id an engineer has to go and fix is in the sentence, not only in the data.
    expect(renderReason('en', 'RC-903', named[0]?.reasonParams ?? {})).toContain('ghost_machine');
  });

  it('reports no pass for the machine it could not measure against', () => {
    const report = reportWithGhost();

    // Nothing may claim the scene was clear. Before this decision both of these were GREEN.
    expect(report.counts.GREEN).toBe(0);
    for (const result of report.results) {
      expect(result.reasonCode).not.toBe('RC-202');
      expect(result.reasonCode).not.toBe('RC-103');
    }
    expect(report.results.some((result) => result.reasonCode === 'RC-904')).toBe(true);
  });

  it('leaves the level unable to pass, and says so as unevaluable', () => {
    const report = reportWithGhost();
    // `kind: 'unevaluable'` is what carries this into the report's verdict.
    expect(report.results.every((result) => result.level !== 'GREEN')).toBe(true);
  });

  it('still passes cleanly when every placement resolves', () => {
    // The control. Without the ghost the same geometry is a genuine pass, so the assertions above
    // are about the missing record and not about the fixture being unsatisfiable.
    const report = evaluate({
      placements: [machineAt(1, { x: 0, y: 0 }), machineAt(2, { x: 0, y: 2_000 })],
      catalog: fixtureCatalog([fixtureEquipmentRecord({ dataStatus: 'verified' })]),
      ruleSet: fixtureRuleSet([
        fixtureClearanceRule({ threshold: 1_200, status: 'verified' }),
        fixtureCollisionRule({ status: 'verified' }),
      ]),
    });

    expect(report.counts.GREEN).toBeGreaterThan(0);
    expect(report.results.some((result) => result.reasonCode === 'RC-903')).toBe(false);
    expect(report.results.some((result) => result.reasonCode === 'RC-904')).toBe(false);
  });
});
