import { describe, expect, it } from 'vitest';

import type { Vec2 } from '@mfd/cad-engine';
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
import type { EvaluationResult } from './result';

/**
 * Invariance tests.
 *
 * A layout's verdict is a fact about the machines' arrangement, not about where
 * that arrangement happens to sit on the drawing or which way it is turned. Move
 * the whole layout a kilometre north, or spin it 37 degrees, and every result must
 * be identical.
 *
 * These catch a class of bug that per-case tests miss entirely: a coordinate error
 * that happens to be harmless at the origin, or a face normal that is only correct
 * at zero rotation. Both would pass every test in evaluate.test.ts.
 */

const CATALOG = fixtureCatalog([fixtureEquipmentRecord({ dataStatus: 'verified' })]);
const RULE_SET = fixtureRuleSet([
  fixtureClearanceRule({ ruleId: 'front_rule', side: 'front', threshold: 1_200, status: 'verified' }),
  fixtureClearanceRule({ ruleId: 'rear_rule', side: 'rear', threshold: 600, status: 'verified' }),
  fixtureClearanceRule({ ruleId: 'left_rule', side: 'left', threshold: 400, status: 'verified' }),
  fixtureClearanceRule({ ruleId: 'right_rule', side: 'right', threshold: 400, status: 'verified' }),
  fixtureCollisionRule({ status: 'verified' }),
]);

/** A layout with a mix of comfortable and tight spacing, so results are varied. */
const LAYOUT: readonly Placement[] = [
  fixturePlacement(1, { x: 0, y: 0 }),
  fixturePlacement(2, { x: 0, y: 1_600 }),
  fixturePlacement(3, { x: 1_100, y: 0 }),
  fixturePlacement(4, { x: 4_000, y: 4_000 }, 'fixture_machine', 45_000),
];

function rotatePoint(point: Vec2, degrees: number): Vec2 {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}

/** Rotate every placement about the model origin, keeping the layout rigid. */
function rotateLayout(placements: readonly Placement[], degrees: number): Placement[] {
  return placements.map((placement) => ({
    ...placement,
    transform: {
      ...placement.transform,
      position: rotatePoint(placement.transform.position, degrees),
      rotation: placement.transform.rotation + degrees * 1_000,
    },
  }));
}

function translateLayout(placements: readonly Placement[], delta: Vec2): Placement[] {
  return placements.map((placement) => ({
    ...placement,
    transform: {
      ...placement.transform,
      position: {
        x: placement.transform.position.x + delta.x,
        y: placement.transform.position.y + delta.y,
      },
    },
  }));
}

/** Compare on the parts that must not move; `measured` is rounded, so allow 1 mm. */
function comparable(results: readonly EvaluationResult[]) {
  return [...results]
    .map((result) => ({
      ruleId: result.ruleId,
      level: result.level,
      placementIds: [...result.placementIds].sort(),
      appliedValue: result.appliedValue,
      thresholdOrigin: result.thresholdOrigin,
      dataStatus: result.dataStatus,
    }))
    .sort((a, b) =>
      `${a.ruleId}${a.placementIds.join()}`.localeCompare(`${b.ruleId}${b.placementIds.join()}`),
    );
}

function measurements(results: readonly EvaluationResult[]): (number | null)[] {
  return [...results]
    .sort((a, b) =>
      `${a.ruleId}${[...a.placementIds].sort().join()}`.localeCompare(
        `${b.ruleId}${[...b.placementIds].sort().join()}`,
      ),
    )
    .map((result) => result.measured);
}

const baseline = evaluate({ placements: LAYOUT, catalog: CATALOG, ruleSet: RULE_SET });

describe('the baseline layout', () => {
  it('produces a mix of levels, so the invariants have something to preserve', () => {
    expect(baseline.results.length).toBeGreaterThan(4);
    expect(new Set(baseline.results.map((result) => result.level)).size).toBeGreaterThan(1);
  });
});

describe('rotation invariance', () => {
  it.each([7, 30, 45, 90, 137, 180, 271, 359])(
    'gives identical verdicts when the layout is rotated %i degrees',
    (degrees) => {
      const rotated = evaluate({
        placements: rotateLayout(LAYOUT, degrees),
        catalog: CATALOG,
        ruleSet: RULE_SET,
      });

      expect(comparable(rotated.results)).toEqual(comparable(baseline.results));
    },
  );

  it('preserves measured distances through rotation', () => {
    const rotated = evaluate({
      placements: rotateLayout(LAYOUT, 137),
      catalog: CATALOG,
      ruleSet: RULE_SET,
    });

    const before = measurements(baseline.results);
    const after = measurements(rotated.results);

    expect(after).toHaveLength(before.length);
    before.forEach((value, index) => {
      const other = after[index];
      if (value === null || other === undefined || other === null) {
        expect(other ?? null).toBe(value);
        return;
      }
      // Rounding to whole millimetres allows a 1 mm drift through the transform.
      expect(Math.abs(other - value)).toBeLessThanOrEqual(1);
    });
  });
});

describe('translation invariance', () => {
  it.each([
    { x: 1_000_000, y: 0 },
    { x: 0, y: -750_000 },
    { x: -412_345, y: 987_654 },
  ])('gives identical verdicts when the layout moves by %o', (delta) => {
    const moved = evaluate({
      placements: translateLayout(LAYOUT, delta),
      catalog: CATALOG,
      ruleSet: RULE_SET,
    });

    expect(comparable(moved.results)).toEqual(comparable(baseline.results));
    expect(measurements(moved.results)).toEqual(measurements(baseline.results));
  });
});

describe('rotation and translation together', () => {
  it('gives identical verdicts', () => {
    const moved = evaluate({
      placements: translateLayout(rotateLayout(LAYOUT, 63), { x: 250_000, y: -125_000 }),
      catalog: CATALOG,
      ruleSet: RULE_SET,
    });

    expect(comparable(moved.results)).toEqual(comparable(baseline.results));
  });
});
