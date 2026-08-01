import { faceGeometry, fieldStatus, footprintCorners } from '@mfd/object-library';

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

    const face = faceGeometry(object, placement.transform, rule.parameters.side);

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
