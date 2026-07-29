import { footprintCorners } from '@mfd/object-library';

import { type EvaluationResult, decideLevel, weakestStatus } from '../result';
import { polygonsOverlap } from '../sat';
import type { CollisionRule } from '../schema';
import type { EvaluationContext, ResolvedPlacement } from './types';

/**
 * Equipment-to-equipment collision.
 *
 * Two machines may not occupy the same floor. Unlike a clearance check this needs
 * no threshold at all — overlap is a geometric fact — so a collision result is the
 * most trustworthy thing this engine produces. It still inherits the equipment's
 * `dataStatus`, because the footprints it compares come from the catalogue: an
 * overlap computed from placeholder dimensions is a provisional overlap.
 *
 * Boundary collision (walls, room outlines) is Sprint 4 — see
 * `BoundaryCollisionEvaluator` in ./types.ts.
 */
export function evaluateCollision(
  rule: CollisionRule,
  subjects: readonly ResolvedPlacement[],
  context: EvaluationContext,
): EvaluationResult[] {
  if (rule.parameters.scope !== 'equipment') {
    // Declared in the schema, not yet implemented. Reported rather than ignored:
    // a rule that silently does nothing looks like a rule that passes.
    return [
      {
        ruleId: rule.ruleId,
        category: rule.category,
        level: 'YELLOW',
        placementIds: [],
        measured: null,
        appliedValue: null,
        thresholdOrigin: 'none',
        unit: rule.unit,
        dataStatus: 'draft',
        reason: `collision scope "${rule.parameters.scope}" is not evaluated yet — room boundaries arrive in Sprint 4`,
        source: rule.source,
      },
    ];
  }

  const results: EvaluationResult[] = [];
  const governed = new Set(subjects.map((subject) => subject.placement.id));

  // Each unordered pair once: a collision between A and B is one finding, not two.
  for (let i = 0; i < context.placements.length; i += 1) {
    for (let j = i + 1; j < context.placements.length; j += 1) {
      const a = context.placements[i];
      const b = context.placements[j];
      if (!a || !b) continue;

      // At least one of the pair must be governed by this rule.
      if (!governed.has(a.id) && !governed.has(b.id)) continue;

      const objectA = context.catalog.get(a.equipmentObjectId);
      const objectB = context.catalog.get(b.equipmentObjectId);
      if (!objectA || !objectB) continue;

      const overlap = polygonsOverlap(
        footprintCorners(objectA, a.transform),
        footprintCorners(objectB, b.transform),
      );

      // Both footprints feed the overlap, so either being provisional makes the
      // finding provisional.
      const equipmentStatus =
        objectA.dataStatus === 'draft' || objectB.dataStatus === 'draft'
          ? 'draft'
          : 'verified';
      const dataStatus = weakestStatus(rule.status, equipmentStatus);

      results.push({
        ruleId: rule.ruleId,
        category: rule.category,
        level: decideLevel({
          violated: overlap.overlapping,
          severity: rule.severity,
          dataStatus,
        }),
        placementIds: [a.id, b.id],
        measured: overlap.overlapping ? Math.round(overlap.penetration) : null,
        appliedValue: null,
        thresholdOrigin: 'none',
        unit: rule.unit,
        dataStatus,
        reason: overlap.overlapping
          ? `${a.label} and ${b.label} overlap by ${Math.round(overlap.penetration)} mm`
          : `${a.label} and ${b.label} do not overlap`,
        source: rule.source,
      });
    }
  }

  return results;
}
