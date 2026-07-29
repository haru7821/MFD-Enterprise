import { type Vec2 } from '@mfd/cad-engine';
import {
  type EquipmentObject,
  footprintCorners,
  localFootprintRect,
  localToModel,
  sideNormals,
} from '@mfd/object-library';

import { type EvaluationResult, decideLevel, weakestStatus } from '../result';
import { gapAlongNormal } from '../sat';
import type { ClearanceRule } from '../schema';
import { resolveClearanceThreshold } from '../threshold';
import type { EvaluationContext, ResolvedPlacement } from './types';

/**
 * Clearance evaluation.
 *
 * For each governed placement, measure the free distance in front of the named
 * face and compare it with the resolved threshold.
 *
 * The threshold is never written here — it comes from the rule or the equipment
 * record, and the result says which (`thresholdOrigin`).
 *
 * ## Side convention
 *
 * Left and right are taken from an operator standing at the front looking at the
 * machine, matching `@mfd/object-library`'s geometry.
 *
 * **This needs confirming against the AK98 installation manual.** A manual that
 * labels its sides from the service engineer's position behind the machine would
 * invert left and right, which would put both clearances on the wrong side of
 * every result. It cannot be settled from here — only the document settles it.
 */

/** The face of the footprint on a given side, in model space. */
function faceOf(
  object: EquipmentObject,
  transform: ResolvedPlacement['placement']['transform'],
  normalLocal: Vec2,
): { origin: Vec2; normal: Vec2; axis: Vec2; min: number; max: number } {
  const local = localFootprintRect(object);

  // A point on the face: the footprint centre pushed out to the face plane.
  const centre = { x: local.x + local.width / 2, y: local.y + local.height / 2 };
  const halfWidth = local.width / 2;
  const halfDepth = local.height / 2;
  const reach = Math.abs(normalLocal.x) * halfWidth + Math.abs(normalLocal.y) * halfDepth;

  const faceCentreLocal = {
    x: centre.x + normalLocal.x * reach,
    y: centre.y + normalLocal.y * reach,
  };

  const origin = localToModel(faceCentreLocal, transform);
  const centreModel = localToModel(centre, transform);

  // Rotate the local normal into model space by transforming a point and
  // subtracting the centre, so mirroring and rotation are both accounted for.
  const tip = localToModel(
    { x: centre.x + normalLocal.x, y: centre.y + normalLocal.y },
    transform,
  );
  const normal = { x: tip.x - centreModel.x, y: tip.y - centreModel.y };
  const normalLength = Math.hypot(normal.x, normal.y) || 1;
  const unitNormal = { x: normal.x / normalLength, y: normal.y / normalLength };

  // The face's own width axis is perpendicular to its normal.
  const axis = { x: -unitNormal.y, y: unitNormal.x };
  const corners = footprintCorners(object, transform);
  const projections = corners.map((corner) => corner.x * axis.x + corner.y * axis.y);

  return {
    origin,
    normal: unitNormal,
    axis,
    min: Math.min(...projections),
    max: Math.max(...projections),
  };
}

export function evaluateClearance(
  rule: ClearanceRule,
  subjects: readonly ResolvedPlacement[],
  context: EvaluationContext,
): EvaluationResult[] {
  const results: EvaluationResult[] = [];

  for (const subject of subjects) {
    const { placement, object } = subject;
    const resolved = resolveClearanceThreshold(rule, object);
    const dataStatus = weakestStatus(rule.status, object.dataStatus);

    const base = {
      ruleId: rule.ruleId,
      category: rule.category,
      placementIds: [placement.id],
      appliedValue: resolved.appliedValue,
      thresholdOrigin: resolved.thresholdOrigin,
      unit: rule.unit,
      dataStatus,
      source: rule.source,
    } as const;

    if (resolved.appliedValue === null) {
      // Neither the rule nor the manual gives a figure. No fourth status is
      // invented — "Review Required" is precisely what this is.
      results.push({
        ...base,
        level: 'YELLOW',
        measured: null,
        reason: `threshold unknown — neither the rule nor the ${object.model} record gives a ${rule.parameters.side} clearance`,
      });
      continue;
    }

    const normals = sideNormals(object);
    const face = faceOf(object, placement.transform, normals[rule.parameters.side]);

    let nearest: number | null = null;
    for (const other of context.placements) {
      if (other.id === placement.id) continue;

      const otherObject = context.catalog.get(other.equipmentObjectId);
      if (!otherObject) continue;

      const gap = gapAlongNormal(
        face,
        { axis: face.axis, min: face.min, max: face.max },
        footprintCorners(otherObject, other.transform),
      );
      if (gap === null) continue;
      if (nearest === null || gap < nearest) nearest = gap;
    }

    if (nearest === null) {
      results.push({
        ...base,
        level: decideLevel({ violated: false, severity: rule.severity, dataStatus }),
        measured: null,
        reason: `nothing within the ${rule.parameters.side} clearance zone of ${resolved.appliedValue} mm`,
      });
      continue;
    }

    const violated = nearest < resolved.appliedValue;
    results.push({
      ...base,
      level: decideLevel({ violated, severity: rule.severity, dataStatus }),
      measured: Math.round(nearest),
      reason: violated
        ? `${Math.round(nearest)} mm available, ${resolved.appliedValue} mm required at the ${rule.parameters.side}`
        : `${Math.round(nearest)} mm available, ${resolved.appliedValue} mm required at the ${rule.parameters.side}`,
    });
  }

  return results;
}
