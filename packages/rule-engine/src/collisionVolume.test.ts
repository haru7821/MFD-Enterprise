import { describe, expect, it } from 'vitest';

import type { Placement } from '@mfd/object-library';

import {
  fixtureCatalog,
  fixtureClearanceRule,
  fixtureCollisionRule,
  fixtureEquipmentRecord,
  fixturePlacement,
  fixtureRuleSet,
} from '../fixtures/index';
import { evaluate } from './evaluate';

/**
 * Regression guard on findings volume.
 *
 * The pair-centred collision model produced one finding per pair — 1,225 of them
 * for fifty machines, almost all saying two machines do not overlap. It failed as
 * a report before it failed as a performance matter: an engineer opening the
 * findings panel saw twelve hundred rows of nothing wrong.
 *
 * These tests exist so the O(n²) shape cannot come back unnoticed. A change that
 * reintroduces it will not merely be slower — it will fail here, with a number.
 */

const CATALOG = fixtureCatalog([fixtureEquipmentRecord({ dataStatus: 'verified' })]);

const COLLISION_ONLY = fixtureRuleSet([fixtureCollisionRule({ status: 'verified' })]);

/** Collision plus the four clearance sides — what the real rule set looks like. */
const FULL_RULE_SET = fixtureRuleSet([
  fixtureClearanceRule({ ruleId: 'front_rule', side: 'front', threshold: 1_200, status: 'verified' }),
  fixtureClearanceRule({ ruleId: 'rear_rule', side: 'rear', threshold: 600, status: 'verified' }),
  fixtureClearanceRule({ ruleId: 'left_rule', side: 'left', threshold: 400, status: 'verified' }),
  fixtureClearanceRule({ ruleId: 'right_rule', side: 'right', threshold: 400, status: 'verified' }),
  fixtureCollisionRule({ status: 'verified' }),
]);

/** Fifty machines on a grid, none touching. Machines are 900 × 750 mm. */
function separatedFifty(): Placement[] {
  return Array.from({ length: 50 }, (_, index) =>
    fixturePlacement(index, {
      x: (index % 10) * 3_000,
      y: Math.floor(index / 10) * 3_000,
    }),
  );
}

function collisionResults(report: ReturnType<typeof evaluate>) {
  return report.results.filter((result) => result.category === 'collision');
}

describe('50 separated machines produce no collision noise', () => {
  const report = evaluate({
    placements: separatedFifty(),
    catalog: CATALOG,
    ruleSet: COLLISION_ONLY,
  });
  const collisions = collisionResults(report);

  it('produces one collision finding per machine, not one per pair', () => {
    // The pair model produced 1,225 here. Fifty machines, fifty findings.
    expect(collisions).toHaveLength(50);
    expect(collisions.length).toBeLessThan(100);
  });

  it('reports every one of them as clear', () => {
    expect(report.counts.RED).toBe(0);
    expect(collisions.every((result) => result.level === 'GREEN')).toBe(true);
  });

  it('names one machine per finding and measures nothing', () => {
    for (const result of collisions) {
      expect(result.placementIds).toHaveLength(1);
      expect(result.measured).toBeNull();
    }
  });

  it('covers every machine exactly once', () => {
    const subjects = collisions.map((result) => result.placementIds[0]);
    expect(new Set(subjects).size).toBe(50);
  });
});

describe('a single collision among fifty', () => {
  const placements = separatedFifty();
  // Move machine 7 on top of machine 6. Machines are 900 mm wide, spaced 3,000.
  const overlapping = placements.map((placement, index) =>
    index === 7
      ? {
          ...placement,
          transform: {
            ...placement.transform,
            position: { x: 6 * 3_000 + 400, y: 0 },
          },
        }
      : placement,
  );

  const report = evaluate({
    placements: overlapping,
    catalog: CATALOG,
    ruleSet: COLLISION_ONLY,
  });
  const collisions = collisionResults(report);
  const red = collisions.filter((result) => result.level === 'RED');

  it('reports RED on both machines involved', () => {
    // An engineer looking at either machine has to see the problem.
    expect(red).toHaveLength(2);
    expect(red.map((result) => result.placementIds[0]).sort()).toEqual([
      'placement-6',
      'placement-7',
    ]);
  });

  it('names the other machine on each finding', () => {
    const six = red.find((result) => result.placementIds[0] === 'placement-6');
    const seven = red.find((result) => result.placementIds[0] === 'placement-7');

    expect(six?.placementIds[1]).toBe('placement-7');
    expect(seven?.placementIds[1]).toBe('placement-6');
  });

  it('reports the penetration depth on both', () => {
    // 900 mm wide, offset 400 from its neighbour: 500 mm of overlap.
    for (const result of red) {
      expect(result.measured).toBe(500);
    }
  });

  it('leaves the other forty-eight clear', () => {
    expect(collisions.filter((result) => result.level === 'GREEN')).toHaveLength(48);
    expect(collisions).toHaveLength(50);
  });
});

describe('total findings volume stays proportional to the layout', () => {
  it('holds fifty machines under the target for the full rule set', () => {
    const report = evaluate({
      placements: separatedFifty(),
      catalog: CATALOG,
      ruleSet: FULL_RULE_SET,
    });

    // Four clearance findings per machine plus one collision finding: 250.
    // The pair model produced 1,425. The ceiling is deliberately close to the
    // expected figure — a loose one would let a regression slip back under it.
    expect(report.results).toHaveLength(250);
    expect(report.results.length).toBeLessThanOrEqual(300);
  });

  it('grows linearly rather than quadratically with machine count', () => {
    const countFor = (machines: number) =>
      evaluate({
        placements: Array.from({ length: machines }, (_, index) =>
          fixturePlacement(index, { x: (index % 10) * 3_000, y: Math.floor(index / 10) * 3_000 }),
        ),
        catalog: CATALOG,
        ruleSet: COLLISION_ONLY,
      }).results.length;

    const at25 = countFor(25);
    const at50 = countFor(50);
    const at100 = countFor(100);

    // Doubling the machines doubles the findings. Under the pair model these
    // ratios were near 4.
    expect(at50 / at25).toBeCloseTo(2, 5);
    expect(at100 / at50).toBeCloseTo(2, 5);
  });
});
