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
    expect(first?.reason).toContain('750 mm available');
    expect(first?.reason).toContain('1200 mm required');
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
    expect(report.results[0]?.reason).toContain('threshold unknown');
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

  it('never produces GREEN from draft equipment', () => {
    const report = evaluate({
      placements: [machineAt(1, { x: 0, y: 0 })],
      catalog: fixtureCatalog([fixtureEquipmentRecord({ dataStatus: 'draft' })]),
      ruleSet: fixtureRuleSet([
        fixtureClearanceRule({ threshold: 1_200, status: 'verified' }),
      ]),
    });

    expect(report.results[0]?.level).toBe('YELLOW');
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

    expect(report.results[0]?.source.document).toBe('Fixture Manual');
    expect(report.results[0]?.source.revision).toBe('Rev. 1');
  });
});
