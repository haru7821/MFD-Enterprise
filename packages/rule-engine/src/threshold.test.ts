import { describe, expect, it } from 'vitest';

import { parseEquipmentObject } from '@mfd/object-library';

import { fixtureClearanceRule, fixtureEquipmentRecord } from '../fixtures/index';
import { parseRule } from './ruleSet';
import { type ClearanceRule } from './schema';
import { resolveClearanceThreshold } from './threshold';

function rule(threshold: number | null, side: 'front' | 'rear' = 'front'): ClearanceRule {
  const parsed = parseRule(fixtureClearanceRule({ threshold, side }), 'r.json');
  if (parsed.category !== 'clearance') throw new Error('expected a clearance rule');
  return parsed;
}

function machine(clearance: {
  front: number | null;
  rear: number | null;
  left: number | null;
  right: number | null;
}) {
  return parseEquipmentObject(
    fixtureEquipmentRecord({ serviceClearance: clearance }),
    'e.json',
  );
}

const NO_CLEARANCE = { front: null, rear: null, left: null, right: null };

describe('threshold resolution', () => {
  it('uses the equipment figure when the rule sets none', () => {
    const resolved = resolveClearanceThreshold(
      rule(null),
      machine({ ...NO_CLEARANCE, front: 1_000 }),
    );

    expect(resolved.appliedValue).toBe(1_000);
    expect(resolved.thresholdOrigin).toBe('equipment');
  });

  it('uses the rule figure when the equipment record has none', () => {
    const resolved = resolveClearanceThreshold(rule(1_200), machine(NO_CLEARANCE));

    expect(resolved.appliedValue).toBe(1_200);
    expect(resolved.thresholdOrigin).toBe('rule');
  });

  it('applies the stricter figure when the rule is more demanding', () => {
    // A hospital standard exceeding the manual still governs.
    const resolved = resolveClearanceThreshold(
      rule(1_500),
      machine({ ...NO_CLEARANCE, front: 1_200 }),
    );

    expect(resolved.appliedValue).toBe(1_500);
    expect(resolved.thresholdOrigin).toBe('rule');
  });

  it('applies the stricter figure when the manual is more demanding', () => {
    // Satisfying a lenient house rule while breaching the manual is still a breach.
    const resolved = resolveClearanceThreshold(
      rule(800),
      machine({ ...NO_CLEARANCE, front: 1_200 }),
    );

    expect(resolved.appliedValue).toBe(1_200);
    expect(resolved.thresholdOrigin).toBe('equipment');
  });

  it('prefers the rule when both figures are equal, and says so', () => {
    const resolved = resolveClearanceThreshold(
      rule(1_200),
      machine({ ...NO_CLEARANCE, front: 1_200 }),
    );

    expect(resolved.appliedValue).toBe(1_200);
    expect(resolved.thresholdOrigin).toBe('rule');
  });

  it('reports both source figures whichever is applied', () => {
    const resolved = resolveClearanceThreshold(
      rule(1_500),
      machine({ ...NO_CLEARANCE, front: 1_200 }),
    );

    expect(resolved.ruleValue).toBe(1_500);
    expect(resolved.equipmentValue).toBe(1_200);
  });

  it('resolves to nothing when neither source has a figure', () => {
    const resolved = resolveClearanceThreshold(rule(null), machine(NO_CLEARANCE));

    expect(resolved.appliedValue).toBeNull();
    expect(resolved.thresholdOrigin).toBe('none');
  });

  it('reads the side the rule names, not the front by default', () => {
    const resolved = resolveClearanceThreshold(
      rule(null, 'rear'),
      machine({ ...NO_CLEARANCE, front: 1_200, rear: 400 }),
    );

    expect(resolved.appliedValue).toBe(400);
  });
});
