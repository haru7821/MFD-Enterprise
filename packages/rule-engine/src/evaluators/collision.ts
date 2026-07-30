import type { Placement } from '@mfd/document-model';
import { footprintCorners } from '@mfd/object-library';
import type { EquipmentObject } from '@mfd/object-library';

import { type EvaluationResult, decideLevel, reasonOf, weakestStatus } from '../result';
import { polygonsOverlap } from '../sat';
import type { CollisionRule } from '../schema';
import type { EvaluationContext, ResolvedPlacement } from './types';

/**
 * Equipment-to-equipment collision, reported per machine.
 *
 * ## Why this is equipment-centred rather than pair-centred
 *
 * The first implementation emitted one result per *pair*, which is O(n²): fifty
 * machines produced 1,225 collision findings, 1,225 of them saying two machines do
 * not overlap. That failed as a report before it failed as a performance matter —
 * an engineer opening the findings panel saw twelve hundred rows of nothing wrong.
 *
 * Now each governed machine reports on itself:
 *
 * - **Clear** → one result. "This machine overlaps nothing."
 * - **Colliding** → one result per machine it collides with.
 *
 * So the count tracks the number of machines plus the number of actual problems,
 * not the square of the machine count. A single collision among fifty machines
 * gives fifty findings: forty-eight clear and two RED — one anchored on each of
 * the machines involved, because an engineer looking at either one needs to see it.
 *
 * ## Result field mapping
 *
 * No field was added to the frozen contract (EVALUATION_RESULT_VERSION stays 1):
 *
 * | Concept | Contract field |
 * | --- | --- |
 * | Which machine the finding is about | `placementIds[0]` — **always the subject** |
 * | The machine it collides with | `placementIds[1]`, absent when clear |
 * | Issue type | `category` (`'collision'`) |
 * | Penetration depth, millimetres | `measured`, null when clear |
 *
 * ## Provenance
 *
 * An overlap check reads **design footprints and nothing else**. The footprint is an
 * owner-defined planning property with no manufacturer citation, so no equipment field
 * group feeds this conclusion and none can make it provisional: "these two machines
 * overlap by 500 mm" is a fact about two rectangles, and an unknown service clearance
 * elsewhere in the record does not soften it.
 *
 * That is the point of per-group verification. Under the old record-level status, one
 * unsourced clearance made every collision finding on that machine provisional too.
 *
 * So `dataStatus` here is the rule's own status.
 *
 * Boundary collision (walls, room outlines) is in ./boundary.ts.
 */

interface Overlap {
  readonly other: Placement;
  readonly otherObject: EquipmentObject;
  readonly penetration: number;
}

export function evaluateCollision(
  rule: CollisionRule,
  subjects: readonly ResolvedPlacement[],
  context: EvaluationContext,
): EvaluationResult[] {
  // `evaluate()` dispatches boundary scope to ./boundary.ts. Reaching here with any
  // other scope means a schema variant was added without an evaluator, which is
  // reported rather than ignored: a rule that silently does nothing looks exactly
  // like a rule that passes.
  if (rule.parameters.scope !== 'equipment') {
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
        ...reasonOf('RC-902', { scope: rule.parameters.scope }),
        source: rule.source,
      },
    ];
  }

  const governed = new Set(subjects.map((subject) => subject.placement.id));

  // Footprint corners once per machine, not once per comparison. Recomputing
  // inside the pair loop costs n² transforms to produce n distinct answers.
  const scene = context.placements.flatMap((placement) => {
    const object = context.catalog.get(placement.equipmentObjectId);
    return object
      ? [{ placement, object, corners: footprintCorners(object, placement.transform) }]
      : [];
  });

  const overlapsBySubject = new Map<string, Overlap[]>();

  // Each unordered pair tested once. The findings are per machine, but the
  // geometry is symmetric — testing A against B and then B against A would double
  // the work to learn the same fact.
  for (let i = 0; i < scene.length; i += 1) {
    const a = scene[i];
    if (!a) continue;

    for (let j = i + 1; j < scene.length; j += 1) {
      const b = scene[j];
      if (!b) continue;
      // Skip pairs this rule governs neither side of.
      if (!governed.has(a.placement.id) && !governed.has(b.placement.id)) continue;

      const overlap = polygonsOverlap(a.corners, b.corners);
      if (!overlap.overlapping) continue;

      // Recorded from both sides, so each machine can report its own problem.
      for (const [subject, other] of [
        [a, b],
        [b, a],
      ] as const) {
        if (!governed.has(subject.placement.id)) continue;
        const list = overlapsBySubject.get(subject.placement.id) ?? [];
        list.push({
          other: other.placement,
          otherObject: other.object,
          penetration: overlap.penetration,
        });
        overlapsBySubject.set(subject.placement.id, list);
      }
    }
  }

  const results: EvaluationResult[] = [];

  for (const subject of subjects) {
    const { placement } = subject;
    const overlaps = overlapsBySubject.get(placement.id) ?? [];

    const base = {
      ruleId: rule.ruleId,
      category: rule.category,
      appliedValue: null,
      thresholdOrigin: 'none',
      unit: rule.unit,
      source: rule.source,
    } as const;

    if (overlaps.length === 0) {
      // Footprints only — see the note at the top of this file. Nothing in the
      // equipment record's verified groups was read, so nothing there can downgrade it.
      const dataStatus = weakestStatus(rule.status);

      results.push({
        ...base,
        level: decideLevel({ violated: false, severity: rule.severity, dataStatus }),
        placementIds: [placement.id],
        measured: null,
        dataStatus,
        ...reasonOf('RC-202', { label: placement.label }),
      });
      continue;
    }

    for (const overlap of overlaps) {
      const dataStatus = weakestStatus(rule.status);
      const penetration = Math.round(overlap.penetration);

      results.push({
        ...base,
        level: decideLevel({ violated: true, severity: rule.severity, dataStatus }),
        placementIds: [placement.id, overlap.other.id],
        measured: penetration,
        dataStatus,
        ...reasonOf('RC-201', {
          label: placement.label,
          other: overlap.other.label,
          measured: penetration,
        }),
      });
    }
  }

  return results;
}
