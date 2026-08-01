import type { Boundary, Placement } from '@mfd/document-model';
import type { Catalog, EquipmentObject } from '@mfd/object-library';

import { evaluateBoundaryCollision } from './evaluators/boundary';
import { evaluateClearance } from './evaluators/clearance';
import { evaluateCollision } from './evaluators/collision';
import type { ResolvedPlacement } from './evaluators/types';
import { reasonKind } from './messages';
import { type EvaluationReport, type EvaluationResult, reasonOf, summarise } from './result';
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

  // A caveat code rather than a sentence appended to `reason`. The report is bilingual, so
  // "— but the plan is not calibrated" cannot be concatenated onto English prose and still
  // exist in Korean; it has to be a code each language composes. See ./messages.ts.
  return results.map((result) =>
    result.level === 'GREEN'
      ? { ...result, level: 'YELLOW' as const, caveatCode: 'RC-911' as const }
      : result,
  );
}

/**
 * One finding per placement the catalogue cannot answer for.
 *
 * > Owner decision D5: *"If one placement cannot be evaluated, the level cannot receive a PASS.
 * > Report: Inconclusive and identify the unevaluable placement."*
 *
 * These used to be dropped — `if (object) resolved.push(...)` and nothing else — so a level holding
 * a machine nobody had the dimensions of produced a report that never mentioned it. `RC-903` is
 * `kind: 'unevaluable'`, which is what carries it into `counts`, into `applyGates`'
 * `unevaluableCount` (it matches on the `RC-9` prefix) and into the report's verdict, none of which
 * needed changing to see it.
 *
 * `ruleId` is empty and `ruleSetId` is not: this is not a rule failing, it is the engine saying it
 * had nothing to apply a rule to.
 */
function unevaluableFor(unresolved: readonly Placement[]): EvaluationResult[] {
  return unresolved.map((placement) => ({
    ruleId: '',
    category: 'equipment_data' as const,
    level: 'YELLOW' as const,
    severity: 'mandatory' as const,
    placementIds: [placement.id],
    measured: null,
    unit: 'mm' as const,
    appliedValue: null,
    thresholdOrigin: 'none' as const,
    dataStatus: 'draft' as const,
    /*
     * No document, because there is none. `estimate` is the weakest source type the vocabulary
     * has, and `lastUpdated` is the placement's own record-less state rather than a date —
     * an empty string, which the report prints as absent rather than as a day somebody worked.
     */
    source: {
      document: null,
      revision: null,
      section: null,
      type: 'estimate' as const,
      lastUpdated: '',
    },
    ...reasonOf('RC-903', {
      label: placement.label,
      equipmentObjectId: placement.equipmentObjectId,
    }),
  }));
}

/**
 * A pass is not a pass when the measurement left something out.
 *
 * Owner decision D5 read together with the standing rule the same decisions restate — *"unknown is
 * preferable to false GREEN"*, *"do not report 'clear' simply because [something] was excluded"*.
 *
 * The audit measured the sentences this prevents. Two machines 100 mm apart, one of them
 * uncatalogued: `GREEN RC-202 "FX 1 does not overlap any other equipment"` and
 * `GREEN RC-103 "Nothing stands within FX 1's 1,200 mm front clearance."` Both are positively
 * false — the engine had dropped the neighbour three times over and then reported the survivor
 * clear.
 *
 * Only passes are rewritten, and only from rules that measure against neighbours. A **violation**
 * stands: finding a real overlap does not become less true because a third machine is unmeasurable.
 */
function applyIncompleteSceneGate(
  results: readonly EvaluationResult[],
  unresolved: readonly Placement[],
  neighbourRuleIds: ReadonlySet<string>,
  placements: readonly Placement[],
): EvaluationResult[] {
  if (unresolved.length === 0) return [...results];

  const labelOf = new Map(placements.map((placement) => [placement.id, placement.label]));

  return results.map((result) => {
    if (!neighbourRuleIds.has(result.ruleId)) return result;
    if (reasonKind(result.reasonCode) !== 'pass') return result;

    const subject = result.placementIds[0];
    return {
      ...result,
      level: 'YELLOW' as const,
      measured: null,
      ...reasonOf('RC-904', {
        label: (subject === undefined ? undefined : labelOf.get(subject)) ?? subject ?? '',
        count: unresolved.length,
      }),
    };
  });
}

export function evaluate({
  placements,
  catalog,
  ruleSet,
  spatial,
}: EvaluateInput): EvaluationReport {
  const resolved: ResolvedPlacement[] = [];
  const unresolved: Placement[] = [];

  for (const placement of placements) {
    const object = catalog.get(placement.equipmentObjectId);
    // A placement pointing at a catalogue record that no longer exists is a data
    // problem, surfaced by the application rather than crashing the engine.
    if (object) resolved.push({ placement, object });
    else unresolved.push(placement);
  }

  // One scene, read by every evaluator — see `EvaluationContext.boundaries` and owner decision D3.
  const context = { placements, catalog, boundaries: spatial?.boundaries ?? [] };
  const results: EvaluationResult[] = [];

  /*
   * Which rules measure a machine **against its neighbours**.
   *
   * Clearance and equipment-to-equipment collision both answer "what else is near this?", so a
   * scene missing an object of unknown size cannot support a pass from either. Boundary-scoped
   * collision is deliberately absent: containment and obstruction overlap do not depend on any
   * other machine, and the independence of the three evaluators is enforced by test.
   */
  const neighbourRuleIds = new Set<string>();

  for (const rule of ruleSet.rules) {
    const subjects = resolved.filter((entry) => ruleApplies(rule, entry.object));
    if (subjects.length === 0) continue;

    if (isClearanceRule(rule)) {
      neighbourRuleIds.add(rule.ruleId);
      results.push(...evaluateClearance(rule, subjects, context));
    } else if (isCollisionRule(rule)) {
      if (rule.parameters.scope !== 'boundary') neighbourRuleIds.add(rule.ruleId);
      results.push(
        ...(rule.parameters.scope === 'boundary'
          ? evaluateBoundaryCollision(rule, subjects, context)
          : evaluateCollision(rule, subjects, context)),
      );
    }
  }

  const scened = applyIncompleteSceneGate(results, unresolved, neighbourRuleIds, placements);
  const gated = applyCalibrationGate(
    [...unevaluableFor(unresolved), ...scened],
    spatial?.planStatus ?? 'none',
  );

  // Worst first: a page of results is read from the top, and RED is what stops an
  // installation.
  const order = { RED: 0, YELLOW: 1, GREEN: 2 } as const;
  const sorted = gated.sort((a, b) => order[a.level] - order[b.level]);

  return summarise(sorted, ruleSet.id, ruleSet.version);
}
