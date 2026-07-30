import { type Vec2 } from '@mfd/cad-engine';
import {
  type EquipmentObject,
  fieldStatus,
  footprintCorners,
  localFootprintRect,
  localToModel,
  sideNormals,
} from '@mfd/object-library';

import { SIDE_WORDS } from '../messages';
import { type EvaluationResult, decideLevel, reasonOf, weakestStatus } from '../result';
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

    // Provenance follows the threshold that was actually applied.
    //
    // Until Sprint 5 the sentence also carried a clause naming the unsourced figure
    // ("— the AK98 service clearance is not yet sourced"). It is gone, for two reasons:
    // it restated `dataStatus`, which every consumer already reads and renders, and a
    // clause bolted onto a template would have needed a second template per language per
    // code. The report marks a provisional finding with its own bilingual label.
    //
    // When the figure came from the equipment record, the finding rests on that
    // record's service-clearance group and is only as good as it. When the figure came
    // from the rule, the record's clearances were not read at all — so an unknown
    // clearance must not make this finding provisional. The geometry comes from the
    // design footprint, which is an owner-defined planning property and carries no
    // verification of its own.
    const dataStatus =
      resolved.thresholdOrigin === 'equipment'
        ? weakestStatus(rule.status, fieldStatus(object, 'serviceClearance'))
        : weakestStatus(rule.status);

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

    // The side is a word we chose, so it travels as both languages. The machine's label
    // is a name the engineer chose and travels verbatim — see ../messages.ts.
    const side = SIDE_WORDS[rule.parameters.side];
    const label = placement.label;

    if (resolved.appliedValue === null) {
      // Neither the rule nor the manual gives a figure. No fourth status is
      // invented — "Review Required" is precisely what this is.
      results.push({
        ...base,
        level: 'YELLOW',
        measured: null,
        ...reasonOf('RC-110', { label, side }),
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
        ...reasonOf('RC-103', { label, side, required: resolved.appliedValue }),
      });
      continue;
    }

    const measured = Math.round(nearest);
    const violated = nearest < resolved.appliedValue;
    results.push({
      ...base,
      level: decideLevel({ violated, severity: rule.severity, dataStatus }),
      measured,
      ...reasonOf(violated ? 'RC-101' : 'RC-102', {
        label,
        side,
        measured,
        required: resolved.appliedValue,
      }),
    });
  }

  return results;
}
