import {
  distanceToPolygonEdge,
  polygonCentroid,
  polygonContains,
  polygonContainsPolygon,
  polygonsOverlapAnywhere,
} from '@mfd/cad-engine';
import type { Vec2 } from '@mfd/cad-engine';
import type { Boundary } from '@mfd/document-model';
import { footprintCorners } from '@mfd/object-library';

import { type EvaluationResult, decideLevel, reasonOf, weakestStatus } from '../result';
import type { CollisionRule } from '../schema';
import type { BoundaryEvaluationContext, ResolvedPlacement } from './types';

/**
 * Boundary collision — equipment against the building.
 *
 * Fills the `BoundaryCollisionEvaluator` extension point declared in Sprint 3, now
 * that the spatial model exists. Two questions, both asked per machine:
 *
 * | Boundary kind | The machine must |
 * | --- | --- |
 * | `space_outline` | be **inside** a room |
 * | `wall`, `obstruction` | **not overlap** it |
 *
 * ## Why this is not the separating axis test
 *
 * `polygonsOverlap` in ../sat.ts is convex-only, and rooms are not convex. An
 * L-shaped treatment area is the ordinary case, and SAT reports a machine standing in
 * the notch of an L as inside the room — a false pass on the exact geometry an
 * engineer is most likely to get wrong. So containment here is ray casting and
 * overlap is edge-crossing plus containment, both from `@mfd/cad-engine`.
 *
 * ## Which room a machine is judged against
 *
 * Its **home room**: the outline containing its centre, or failing that the one
 * containing the most of its corners. A machine in room A is trivially outside room
 * B, so "inside every room" is not the question — "inside the room it is in" is.
 *
 * A machine in no room at all is a violation, not a pass. An engineer who has drawn
 * the rooms and left a machine in the corridor needs to see that.
 *
 * ## Provenance
 *
 * A boundary check reads a **design footprint** and a **traced boundary**, and no
 * manufacturer figure at all.
 *
 * The footprint is an owner-defined planning property with no citation. The boundary is
 * project data the engineer traced, and its reliability is the calibration's — handled by
 * the plan-status gate in `evaluate.ts` rather than by pretending a traced wall is a draft
 * manual figure.
 *
 * So no equipment field group feeds this conclusion, and `dataStatus` is the rule's own
 * status. An unknown service clearance does not make "this machine is outside the room"
 * provisional; it is a fact about a polygon and a rectangle.
 */

/** The room a machine is judged against, or null when it is in none. */
function homeRoom(corners: readonly Vec2[], rooms: readonly Boundary[]): Boundary | null {
  const centre = polygonCentroid(corners);

  if (centre) {
    for (const room of rooms) {
      if (polygonContains(room.vertices, centre)) return room;
    }
  }

  // No room holds the centre: the machine straddles a wall. Judge it against the
  // room it is mostly in, so the finding names a room the engineer recognises rather
  // than reporting a homeless machine that is plainly half inside one.
  let best: Boundary | null = null;
  let bestCount = 0;
  for (const room of rooms) {
    const count = corners.filter((corner) => polygonContains(room.vertices, corner)).length;
    if (count > bestCount) {
      best = room;
      bestCount = count;
    }
  }
  return best;
}

/** How far the machine reaches past the room outline, in millimetres. */
function overhang(corners: readonly Vec2[], room: Boundary): number | null {
  let worst: number | null = null;
  for (const corner of corners) {
    if (polygonContains(room.vertices, corner)) continue;
    const distance = distanceToPolygonEdge(room.vertices, corner);
    if (worst === null || distance > worst) worst = distance;
  }
  return worst;
}

/**
 * How deep the overlap between a machine and an obstruction runs, in millimetres.
 *
 * Measured in **both directions**, because either shape can be the one doing the
 * engulfing. A machine straddling the edge of a column has no corner inside the
 * column — the column's corners are inside the machine. Looking only one way reports
 * null on the commonest case there is.
 *
 * Null when no vertex of either shape lies inside the other: a machine spanning a
 * 100 mm partition crosses its edges without any corner landing anywhere. There is a
 * real overlap and no well-defined depth, and reporting zero would read as "just
 * touching".
 */
function intrusion(corners: readonly Vec2[], obstruction: Boundary): number | null {
  let worst: number | null = null;

  const consider = (point: Vec2, into: readonly Vec2[]): void => {
    if (!polygonContains(into, point)) return;
    const distance = distanceToPolygonEdge(into, point);
    if (worst === null || distance > worst) worst = distance;
  };

  for (const corner of corners) consider(corner, obstruction.vertices);
  for (const vertex of obstruction.vertices) consider(vertex, corners);

  return worst;
}

function label(boundary: Boundary): string {
  return boundary.label || (boundary.kind === 'space_outline' ? 'the room' : 'an obstruction');
}

export function evaluateBoundaryCollision(
  rule: CollisionRule,
  subjects: readonly ResolvedPlacement[],
  context: BoundaryEvaluationContext,
): EvaluationResult[] {
  const base = {
    ruleId: rule.ruleId,
    category: rule.category,
    appliedValue: null,
    thresholdOrigin: 'none',
    unit: rule.unit,
    source: rule.source,
  } as const;

  const rooms = context.boundaries.filter((boundary) => boundary.kind === 'space_outline');
  const obstructions = context.boundaries.filter(
    (boundary) => boundary.kind !== 'space_outline',
  );

  if (rooms.length === 0 && obstructions.length === 0) {
    // Reported rather than skipped: a rule that silently produces nothing is
    // indistinguishable from a rule everything passes.
    return [
      {
        ...base,
        level: 'YELLOW',
        placementIds: [],
        measured: null,
        dataStatus: 'draft',
        ...reasonOf('RC-901'),
        source: rule.source,
      },
    ];
  }

  const results: EvaluationResult[] = [];

  for (const { placement, object } of subjects) {
    // Footprint and traced geometry only — see the note above.
    const dataStatus = weakestStatus(rule.status);
    const corners = footprintCorners(object, placement.transform);
    const entry = { ...base, dataStatus };

    // 1. Obstructions the machine sits on top of.
    const hit = obstructions.filter((obstruction) =>
      polygonsOverlapAnywhere(corners, obstruction.vertices),
    );

    for (const obstruction of hit) {
      const depth = intrusion(corners, obstruction);
      results.push({
        ...entry,
        level: decideLevel({ violated: true, severity: rule.severity, dataStatus }),
        placementIds: [placement.id],
        measured: depth === null ? null : Math.round(depth),
        ...(depth === null
          ? reasonOf('RC-312', { label: placement.label, obstruction: label(obstruction) })
          : reasonOf('RC-311', {
              label: placement.label,
              obstruction: label(obstruction),
              measured: Math.round(depth),
            })),
      });
    }

    // 2. Room containment.
    if (rooms.length === 0) {
      if (hit.length === 0) {
        results.push({
          ...entry,
          level: decideLevel({ violated: false, severity: rule.severity, dataStatus }),
          placementIds: [placement.id],
          measured: null,
          ...reasonOf('RC-322', { label: placement.label }),
        });
      }
      continue;
    }

    const room = homeRoom(corners, rooms);

    if (!room) {
      results.push({
        ...entry,
        level: decideLevel({ violated: true, severity: rule.severity, dataStatus }),
        placementIds: [placement.id],
        measured: null,
        ...reasonOf('RC-303', { label: placement.label }),
      });
      continue;
    }

    if (!polygonContainsPolygon(room.vertices, corners)) {
      const past = overhang(corners, room);
      results.push({
        ...entry,
        level: decideLevel({ violated: true, severity: rule.severity, dataStatus }),
        placementIds: [placement.id],
        measured: past === null ? null : Math.round(past),
        ...(past === null
          ? reasonOf('RC-302', { label: placement.label, room: label(room) })
          : reasonOf('RC-301', {
              label: placement.label,
              room: label(room),
              measured: Math.round(past),
            })),
      });
      continue;
    }

    if (hit.length === 0) {
      results.push({
        ...entry,
        level: decideLevel({ violated: false, severity: rule.severity, dataStatus }),
        placementIds: [placement.id],
        measured: null,
        ...reasonOf('RC-321', { label: placement.label, room: label(room) }),
      });
    }
  }

  return results;
}
