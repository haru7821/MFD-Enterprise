import type { Boundary, Placement } from '@mfd/document-model';
import type { Catalog, EquipmentObject } from '@mfd/object-library';

import { evaluateBoundaryCollision } from './evaluators/boundary';
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
 * Pure: the same placements, catalogue, spatial context and rule set always give the
 * same report, with no clock, no randomness and no I/O. That is what lets the browser
 * run it for live feedback while the server runs it as the authority for a signed
 * report, and lets the two be compared (architecture decision AD-3).
 */

/**
 * Whether the drawing this layout sits on can be measured against.
 *
 * | | Means |
 * | --- | --- |
 * | `none` | No drawing imported. The engineer works directly in millimetres, which is exact. |
 * | `calibrated` | A drawing with a coordinate mapping. Positions are real. |
 * | `uncalibrated` | A drawing with no mapping. Positions are pixels somebody eyeballed. |
 */
export type PlanStatus = 'none' | 'calibrated' | 'uncalibrated';

/** The spatial facts of one level. Omitted entirely when there is no plan and no rooms. */
export interface SpatialContext {
  readonly boundaries: readonly Boundary[];
  readonly planStatus: PlanStatus;
}

export interface EvaluateInput {
  readonly placements: readonly Placement[];
  readonly catalog: Catalog;
  readonly ruleSet: RuleSet;
  readonly spatial?: SpatialContext;
}

/** Does this rule govern this equipment record? */
export function ruleApplies(rule: Rule, object: EquipmentObject): boolean {
  const { equipmentIds, categories } = rule.appliesTo;

  if (equipmentIds !== null && equipmentIds.includes(object.id)) return true;
  if (categories !== null && categories.includes(object.category)) return true;
  return false;
}

/**
 * The calibration gate.
 *
 * An imported drawing with no coordinate mapping has no millimetres in it. Machines
 * placed against it sit where an engineer eyeballed them on screen, and while their
 * geometry relative to one another is still real, nothing about the *building* has
 * been checked. So no result can be GREEN.
 *
 * Two deliberate asymmetries:
 *
 * - **GREEN becomes YELLOW**, because a pass that has not been checked against the
 *   real room must not sign anything off (AD-6a).
 * - **RED stays RED.** A violation is never softened for weak provenance — that would
 *   make poor data hide problems, which is the wrong direction to fail in.
 *
 * `planStatus: 'none'` is not a weaker case than `'calibrated'`. An engineer laying a
 * room out in millimetres with no drawing behind it has exact geometry; it is the
 * half-imported plan that is dangerous, because it *looks* like a measured drawing.
 */
function applyCalibrationGate(
  results: readonly EvaluationResult[],
  planStatus: PlanStatus,
): EvaluationResult[] {
  if (planStatus !== 'uncalibrated') return [...results];

  return results.map((result) =>
    result.level === 'GREEN'
      ? {
          ...result,
          level: 'YELLOW' as const,
          reason: `${result.reason} — but the plan is not calibrated, so this has not been checked against the building`,
        }
      : result,
  );
}

export function evaluate({
  placements,
  catalog,
  ruleSet,
  spatial,
}: EvaluateInput): EvaluationReport {
  const resolved: ResolvedPlacement[] = [];

  for (const placement of placements) {
    const object = catalog.get(placement.equipmentObjectId);
    // A placement pointing at a catalogue record that no longer exists is a data
    // problem, surfaced by the application rather than crashing the engine.
    if (object) resolved.push({ placement, object });
  }

  const context = { placements, catalog };
  const boundaryContext = { ...context, boundaries: spatial?.boundaries ?? [] };
  const results: EvaluationResult[] = [];

  for (const rule of ruleSet.rules) {
    const subjects = resolved.filter((entry) => ruleApplies(rule, entry.object));
    if (subjects.length === 0) continue;

    if (isClearanceRule(rule)) {
      results.push(...evaluateClearance(rule, subjects, context));
    } else if (isCollisionRule(rule)) {
      results.push(
        ...(rule.parameters.scope === 'boundary'
          ? evaluateBoundaryCollision(rule, subjects, boundaryContext)
          : evaluateCollision(rule, subjects, context)),
      );
    }
  }

  const gated = applyCalibrationGate(results, spatial?.planStatus ?? 'none');

  // Worst first: a page of results is read from the top, and RED is what stops an
  // installation.
  const order = { RED: 0, YELLOW: 1, GREEN: 2 } as const;
  const sorted = gated.sort((a, b) => order[a.level] - order[b.level]);

  return summarise(sorted, ruleSet.id, ruleSet.version);
}
