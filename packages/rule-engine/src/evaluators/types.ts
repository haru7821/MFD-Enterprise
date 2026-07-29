import type { Boundary, Placement } from '@mfd/document-model';
import type { Catalog, EquipmentObject } from '@mfd/object-library';

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
 * Boundary collision — implemented in Sprint 4 by `./boundary.ts`.
 *
 * The interface was declared in Sprint 3, before the walls existed, so that the shape
 * of this work was fixed while the rest of the engine was fresh. It bound to the
 * document model's `Boundary` on arrival without changing: the only edit was
 * replacing a structural stand-in for the polygon with the real record.
 */
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
