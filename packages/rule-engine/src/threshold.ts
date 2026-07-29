import type { ClearanceSide, EquipmentObject } from '@mfd/object-library';

import type { ClearanceRule } from './schema';

/**
 * Threshold resolution.
 *
 * A clearance figure can come from two places, and both are legitimate:
 *
 * - **The equipment record** — what this machine needs, from its installation
 *   manual. "The AK98 needs 1200 mm in front."
 * - **The rule** — what must be satisfied here, from a hospital standard or local
 *   requirement. "Dialysis machines need 1500 mm in front, whatever the maker says."
 *
 * When both exist the stricter wins. Satisfying the manual while breaching the
 * hospital's own standard is still a breach, and a rule written for a class of
 * machines cannot carry per-model figures.
 */

export type ThresholdOrigin = 'rule' | 'equipment' | 'none';

export interface ResolvedThreshold {
  /** The figure actually applied, or null when neither source has one. */
  readonly appliedValue: number | null;
  readonly thresholdOrigin: ThresholdOrigin;
  /** The equipment record's figure, for reporting alongside the applied one. */
  readonly equipmentValue: number | null;
  readonly ruleValue: number | null;
}

export function resolveClearanceThreshold(
  rule: ClearanceRule,
  object: EquipmentObject,
): ResolvedThreshold {
  const side: ClearanceSide = rule.parameters.side;
  const equipmentValue = object.serviceClearance[side];
  const ruleValue = rule.threshold;

  if (ruleValue === null && equipmentValue === null) {
    return { appliedValue: null, thresholdOrigin: 'none', equipmentValue, ruleValue };
  }

  if (ruleValue === null) {
    return {
      appliedValue: equipmentValue,
      thresholdOrigin: 'equipment',
      equipmentValue,
      ruleValue,
    };
  }

  if (equipmentValue === null) {
    return { appliedValue: ruleValue, thresholdOrigin: 'rule', equipmentValue, ruleValue };
  }

  // Both present: the stricter requirement governs.
  return ruleValue >= equipmentValue
    ? { appliedValue: ruleValue, thresholdOrigin: 'rule', equipmentValue, ruleValue }
    : {
        appliedValue: equipmentValue,
        thresholdOrigin: 'equipment',
        equipmentValue,
        ruleValue,
      };
}
