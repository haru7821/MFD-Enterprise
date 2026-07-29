import type { Catalog, EquipmentObject, Placement } from '@mfd/object-library';

import { evaluateClearance } from './evaluators/clearance';
import { evaluateCollision } from './evaluators/collision';
import type { ResolvedPlacement } from './evaluators/types';
import { type EvaluationReport, type EvaluationResult, summarise } from './result';
import { type Rule, isClearanceRule, isCollisionRule } from './schema';
import type { RuleSet } from './ruleSet';

/**
 * Evaluation entry point.
 *
 *   Placement → Rule Engine → Evaluation Result
 *
 * Pure: the same placements, catalogue and rule set always give the same report,
 * with no clock, no randomness and no I/O. That is what lets the browser run it for
 * live feedback while the server runs it as the authority for a signed report, and
 * lets the two be compared (architecture decision AD-3).
 */

export interface EvaluateInput {
  readonly placements: readonly Placement[];
  readonly catalog: Catalog;
  readonly ruleSet: RuleSet;
}

/** Does this rule govern this equipment record? */
export function ruleApplies(rule: Rule, object: EquipmentObject): boolean {
  const { equipmentIds, categories } = rule.appliesTo;

  if (equipmentIds !== null && equipmentIds.includes(object.id)) return true;
  if (categories !== null && categories.includes(object.category)) return true;
  return false;
}

export function evaluate({ placements, catalog, ruleSet }: EvaluateInput): EvaluationReport {
  const resolved: ResolvedPlacement[] = [];

  for (const placement of placements) {
    const object = catalog.get(placement.equipmentObjectId);
    // A placement pointing at a catalogue record that no longer exists is a data
    // problem, surfaced by the application rather than crashing the engine.
    if (object) resolved.push({ placement, object });
  }

  const context = { placements, catalog };
  const results: EvaluationResult[] = [];

  for (const rule of ruleSet.rules) {
    const subjects = resolved.filter((entry) => ruleApplies(rule, entry.object));
    if (subjects.length === 0) continue;

    if (isClearanceRule(rule)) {
      results.push(...evaluateClearance(rule, subjects, context));
    } else if (isCollisionRule(rule)) {
      results.push(...evaluateCollision(rule, subjects, context));
    }
  }

  // Worst first: a page of results is read from the top, and RED is what stops an
  // installation.
  const order = { RED: 0, YELLOW: 1, GREEN: 2 } as const;
  const sorted = [...results].sort((a, b) => order[a.level] - order[b.level]);

  return summarise(sorted, ruleSet.id, ruleSet.version);
}
