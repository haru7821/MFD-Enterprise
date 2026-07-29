import type { Catalog, EquipmentObject, Placement } from '@mfd/object-library';

import type { EvaluationResult } from '../result';
import type { Rule } from '../schema';

/**
 * What every evaluator sees.
 *
 * Deliberately the whole scene rather than one placement: a clearance check needs
 * to know what else is nearby, and a collision check needs pairs. The narrower
 * signature would have to be widened on the first real rule.
 */
export interface EvaluationContext {
  readonly placements: readonly Placement[];
  readonly catalog: Catalog;
}

/** A placement paired with its resolved catalogue record. */
export interface ResolvedPlacement {
  readonly placement: Placement;
  readonly object: EquipmentObject;
}

export interface Evaluator<TRule extends Rule = Rule> {
  readonly category: TRule['category'];
  evaluate(
    rule: TRule,
    subjects: readonly ResolvedPlacement[],
    context: EvaluationContext,
  ): EvaluationResult[];
}

/**
 * Boundary collision — declared, not implemented.
 *
 * Walls arrive with `Space` in Sprint 4. The interface exists now so the shape of
 * that work is fixed while the rest of the engine is fresh, and so a rule file
 * written with `scope: "boundary"` has something to bind to rather than being
 * invented later against whatever the evaluator happens to need.
 *
 * @see docs/roadmap/MVP_PLAN.md — Sprint 4, spatial model
 */
export interface Boundary {
  readonly id: string;
  /** Closed polygon in model millimetres. */
  readonly polygon: readonly { readonly x: number; readonly y: number }[];
}

export interface BoundaryEvaluationContext extends EvaluationContext {
  readonly boundaries: readonly Boundary[];
}

export interface BoundaryCollisionEvaluator {
  readonly category: 'collision';
  readonly scope: 'boundary';
  evaluate(
    rule: Rule,
    subjects: readonly ResolvedPlacement[],
    context: BoundaryEvaluationContext,
  ): EvaluationResult[];
}
