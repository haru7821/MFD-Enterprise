import { faceGeometry, fieldStatus, footprintCorners } from '@mfd/object-library';

import { SIDE_WORDS } from '../messages';
import { type EvaluationResult, decideLevel, reasonOf, weakestStatus } from '../result';
import { gapAlongNormal, isConvexPolygon } from '../sat';
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
    const band = { axis: face.axis, min: face.min, max: face.max };

    let nearest: number | null = null;

    /*
     * Walls and obstructions, measured the same way equipment is.
     *
     * > Owner decision D3: *"Treat walls as real obstructions. If the implementation cannot yet
     * > measure wall clearance correctly, abstain. Do not report 'clear' simply because walls were
     * > excluded. Unknown is preferable to false GREEN."*
     *
     * This loop did not exist. Clearance saw `context.placements` and nothing else, so a wall
     * 100 mm in front of a face produced `GREEN` — *"Nothing stands within FX 1's 1,200 mm front
     * clearance"* — while the identical geometry made of a *machine* produced `RED measured=100`.
     * `criteria.ts` had the owner's decision that obstructions and the room edge block a service
     * face; the rule engine contradicted it.
     *
     * `space_outline` is deliberately absent. A room outline *contains* the machine rather than
     * standing in front of it, and `gapAlongNormal` measures towards a polygon the face is outside
     * of — pointing it at the room would return a number about the wrong side of the wall. That is
     * the half this decision's own fallback covers, and it is recorded as `RC-905` below rather
     * than guessed at.
     */
    let unmeasurableFace = false;
    for (const boundary of context.boundaries) {
      if (boundary.kind !== 'wall' && boundary.kind !== 'obstruction') continue;

      /*
       * The ninth review's `SC-907` finding, in the rule engine. `gapAlongNormal` takes a single
       * global minimum across whatever survives its lateral clip, which is the nearest *connected*
       * material only when the polygon is convex. A non-convex wall run can present a disconnected
       * far arm inside the same band as a near one, and the function cannot tell them apart — so
       * the face is reported unmeasurable rather than measured wrongly.
       */
      if (!isConvexPolygon(boundary.vertices)) {
        unmeasurableFace = true;
        continue;
      }

      const rawGap = gapAlongNormal(face, band, boundary.vertices);
      if (rawGap === null) continue;
      const gap = Math.max(0, rawGap);
      if (nearest === null || gap < nearest) nearest = gap;
    }

    if (unmeasurableFace) {
      results.push({
        ...base,
        level: 'YELLOW',
        measured: null,
        ...reasonOf('RC-905', { label, side }),
      });
      continue;
    }

    for (const other of context.placements) {
      if (other.id === placement.id) continue;

      const otherObject = context.catalog.get(other.equipmentObjectId);
      if (!otherObject) continue;

      const rawGap = gapAlongNormal(
        face,
        band,
        footprintCorners(otherObject, other.transform),
      );
      if (rawGap === null) continue;
      /*
       * Owner decision, following the same one taken for `@mfd/ai-local`'s `compliance_margin`:
       * clamped at zero, not reported signed. `gapAlongNormal` clips to this face's own width
       * before measuring (seventh Critical 0 review round), so a negative result here means the
       * neighbour genuinely crosses the plane within that width — for a plain rectangular subject,
       * that is indistinguishable from an actual overlap with the subject's own footprint. This
       * function has no Gate 2 of its own: it is the live validation engine, and it reports every
       * category — clearance included — for whatever the drawing actually holds, collision among
       * them. A negative gap here is real, but "-700 mm of rear clearance" is still not a sentence
       * a live finding should print for a pair the engineer is mid-drag on: zero is. The RED verdict
       * is unaffected either way — `violated` is decided below, and zero is already less than any
       * positive threshold a clearance rule can carry.
       */
      const gap = Math.max(0, rawGap);
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
