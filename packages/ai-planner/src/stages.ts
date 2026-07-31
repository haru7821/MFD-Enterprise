import type { PlanInput } from '@mfd/ai-contract';

import type { SequenceSet, SequenceStage } from './sequenceSet';

/**
 * Which stages this project actually has, and what happened to the ones it does not.
 *
 * A sequence set describes every stage a dialysis installation *can* have. A project has the
 * subset its own contents call for: no RO reference point means no loop to pressure test, and a
 * plan that listed the test anyway would be a plan with a step nobody can perform.
 *
 * ## Excluding a stage is not the same as deleting it
 *
 * Two things follow from dropping a stage, and both matter more than the dropping:
 *
 * 1. **Its dependents have to be rewired.** `service_connection` depends on `ro_pressure_test`,
 *    which depends on `services_rough_in`. Drop the test and the connection stage would name a
 *    prerequisite that is not in the plan — which the contract schema rejects, correctly. So a
 *    dependent inherits the excluded stage's own dependencies, transitively. The connection stage
 *    still comes after the rough-in; it just no longer waits for a test nobody is doing.
 *
 * 2. **Somebody has to be told.** A silently shorter plan reads as a simpler job. Every exclusion
 *    produces a blocker naming what was missing, so *"the pressure test is not in this plan"* is
 *    visible with its reason attached rather than being an absence nobody notices.
 *
 * The second is the one an engineer is actually served by. A plan that quietly omits the water
 * quality check because a reference point was never placed is worse than no plan.
 */

export interface ResolvedStages {
  /** Applicable stages, with dependencies rewired around anything excluded. */
  readonly included: readonly SequenceStage[];
  readonly excluded: readonly ExcludedStage[];
}

export interface ExcludedStage {
  readonly stage: SequenceStage;
  /** What the project lacked. A reference point kind, or `'placements'`. */
  readonly missing: string;
}

export function resolveStages(set: SequenceSet, input: PlanInput): ResolvedStages {
  const excluded: ExcludedStage[] = [];
  const keep = new Set<string>();

  for (const stage of set.stages) {
    const missing = missingFor(stage, input);
    if (missing === null) keep.add(stage.id);
    else excluded.push({ stage, missing });
  }

  const included = set.stages
    .filter((stage) => keep.has(stage.id))
    .map((stage) => ({ ...stage, dependsOn: rewire(stage.dependsOn, set, keep) }));

  return { included, excluded };
}

/**
 * What the project lacks for this stage, or null when it lacks nothing.
 *
 * The `appliesWhen` union is closed and exhaustive: a new condition in the data file cannot be
 * introduced without a matching case here, because the schema would reject the file first and this
 * switch would not compile second.
 */
function missingFor(stage: SequenceStage, input: PlanInput): string | null {
  switch (stage.appliesWhen.kind) {
    case 'always':
      return null;
    case 'has_placements':
      return input.placements.length > 0 ? null : 'placements';
    case 'has_reference_point': {
      const kind = stage.appliesWhen.referencePointKind;
      return input.referencePoints.some((point) => point.kind === kind) ? null : kind;
    }
  }
}

/**
 * Replace every excluded prerequisite with that prerequisite's own, transitively.
 *
 * Order is preserved and duplicates are collapsed, so the result is deterministic: the same
 * exclusion set always rewires to the same list, which is what makes two runs of the planner
 * produce byte-identical plans.
 */
function rewire(
  dependsOn: readonly string[],
  set: SequenceSet,
  keep: ReadonlySet<string>,
): string[] {
  const byId = new Map(set.stages.map((stage) => [stage.id, stage]));
  const out: string[] = [];
  const seen = new Set<string>();

  const walk = (ids: readonly string[]): void => {
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (keep.has(id)) {
        out.push(id);
        continue;
      }
      // Excluded: stand in its own prerequisites. Terminates because the set is acyclic, which the
      // schema checks at load.
      walk(byId.get(id)?.dependsOn ?? []);
    }
  };

  walk(dependsOn);
  return out;
}
