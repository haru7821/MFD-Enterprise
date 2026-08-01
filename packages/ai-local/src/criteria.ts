import type {
  ReferencePointSummary,
  ScoreReasonCode,
  ScoringCriterion,
} from '@mfd/ai-contract';
import type { Rect, Vec2 } from '@mfd/cad-engine';
import type { Boundary, Placement, ReferencePointKind } from '@mfd/document-model';
import type { ClearanceSide, Catalog, EquipmentObject, Face } from '@mfd/object-library';
import {
  clearanceZones,
  faceGeometry,
  footprintBounds as objectFootprintBounds,
  footprintCentre,
  footprintCorners,
} from '@mfd/object-library';
import type { RuleSet } from '@mfd/rule-engine';
import { evaluate, gapAlongNormal, isConvexPolygon } from '@mfd/rule-engine';

import type { KnowledgeBase } from '@mfd/layout-knowledge';

import { generateCandidates } from './candidates';
import { type Bounds, boundsOf, routedDistance } from './routing';

/**
 * Measuring the eight criteria.
 *
 * Every function here returns a {@link Measurement}: a number **or** a reason it could not be
 * taken. Nothing returns a default, and that is the discipline the whole scoring engine rests on —
 * three of these criteria *minimise*, so a substituted zero is not a neutral value, it is a perfect
 * score for a measurement nobody took (AD-18).
 *
 * The measurements are in the criterion's own unit. Normalising them against the configured
 * reference is `./score.ts`'s job, and keeping the two apart is what lets a reference be re-tuned
 * (B-5b) without touching any geometry.
 */

export type Measurement =
  | { readonly kind: 'measured'; readonly value: number }
  | { readonly kind: 'unavailable'; readonly reasonCode: ScoreReasonCode };

const measured = (value: number): Measurement => ({ kind: 'measured', value });
const unavailable = (reasonCode: ScoreReasonCode): Measurement => ({
  kind: 'unavailable',
  reasonCode,
});

export interface MeasureInput {
  /**
   * The equipment being measured and counted — one kind, the kind `object` describes.
   *
   * > Owner decision: the gates judge the whole scene; the score measures only the equipment it was
   * > written for.
   *
   * Every criterion here is written against `object`: its planning footprint, its service
   * clearances, the services it needs routed to it. Handing it another kind makes it apply a
   * dialysis machine's clearances to a nurse station.
   */
  readonly placements: readonly Placement[];
  /**
   * Everything physically on the drawing, including {@link placements} — what the room actually
   * contains.
   *
   * **Separate from `placements` because the two are different roles**, and collapsing them is a
   * defect in whichever direction it is done. A criterion needs to know *what it is measuring*
   * (this equipment) and *what is in the way* (everything), and one field cannot be both.
   *
   * Found by the standing review after `placements` was narrowed to one kind and the geometry
   * silently narrowed with it: `future_expansion` reported **three more stations fit** in a 6 × 4 m
   * room that already held three machines and fits none, moving the total from 0.75 to 0.9375. It
   * is the one weighted criterion measurable with today's catalogue — every AK98 clearance is null,
   * so the rest report `SC-904` — which made it live, displayed, and false about the drawing.
   */
  readonly occupants: readonly Placement[];
  readonly catalog: Catalog;
  readonly ruleSet: RuleSet;
  readonly boundaries: readonly Boundary[];
  readonly room: readonly Vec2[];
  readonly obstructions: readonly (readonly Vec2[])[];
  readonly referencePoints: readonly ReferencePointSummary[];
  readonly object: EquipmentObject;
  readonly planStatus: 'none' | 'calibrated' | 'uncalibrated';
  readonly pitchPadding: number;
  /**
   * Observed practice from real drawings — Owner decision, layout-knowledge.
   *
   * **Required, not optional.** A caller with no knowledge base cannot construct this input, so
   * there is no path by which a criterion falls back to a figure written into the solver. That is
   * the requirement — *"the optimization engine must consume this knowledge package rather than
   * embedding layout assumptions"* — expressed as a compile error rather than a convention.
   *
   * It answers "what did other units do", never "what must this one do". Nothing read from it can
   * reach a compliance verdict: hard gates are a filter on the rule set (AD-17), and this is only
   * ever consulted for a figure the solver would otherwise have had to invent.
   */
  readonly knowledge: KnowledgeBase;
}

/** Every criterion, measured. The map is total, so a new criterion cannot be silently skipped. */
export function measureAll(input: MeasureInput): Record<ScoringCriterion, Measurement> {
  return {
    compliance_margin: measureComplianceMargin(input),
    installation_feasibility: measureInstallationFeasibility(input),
    maintenance_access: measureMaintenanceAccess(input),
    ro_piping_length: measureRouting(input, 'ro_supply'),
    electrical_routing: measureRouting(input, 'electrical_panel'),
    future_expansion: measureFutureExpansion(input),
    walking_distance: measureRouting(input, 'staff_base'),
    drain_routing: measureRouting(input, 'drain'),
  };
}

/**
 * Compliance margin — the **worst** headroom above a requirement, as a ratio of it.
 *
 * > Owner clarification: *"Among compliant candidates, compliance margin remains weighted at 40 %.
 * > The 40 % weight represents quality of compliance margin, not permission to trade rule
 * > violations against optimization."*
 *
 * Violations are gone by the time this runs — Gate 2 removed them — so every input here already
 * complies. What is scored is *by how much*: 1,400 mm where 1,200 mm is required is a ratio of
 * 1.17, and clearing by 5 mm is 1.004. A layout is only as good as its tightest face, so the
 * **minimum** ratio is taken rather than the mean: an average would let eleven generous clearances
 * hide one that a service engineer cannot actually work in.
 *
 * ## Why this is so often unavailable today
 *
 * A ratio needs a threshold, and every rule in `standards/rules/` currently carries `null` because
 * the AK98 manual has not been supplied (A-1). So on a real project this reports **`SC-904`, no
 * requirement to compare against**, and 40 % of the model is uncomputable.
 *
 * That is the honest answer and it is worth its visibility: the largest single weight in the
 * approved model cannot be evaluated until the manual arrives, and `coverage` says so on every
 * proposal rather than letting a total over the other 60 % pass for a complete one.
 */
function measureComplianceMargin(input: MeasureInput): Measurement {
  const report = evaluate({
    placements: input.placements,
    catalog: input.catalog,
    ruleSet: input.ruleSet,
    spatial: { boundaries: input.boundaries, planStatus: input.planStatus },
  });

  /*
   * Owner decision D4: *"Do not use an AABB approximation. Until exact polygon measurement exists,
   * report: Unavailable. Never silently approximate engineering measurements."*
   *
   * `freeDistanceOnSide` measures headroom to `roomBounds`, and a bounding box is the room only
   * when the room is an axis-aligned rectangle. On the audit's L-shaped room a face 300 mm from the
   * arm wall — true ratio 0.2917 — measured **2.7917**, because the box edge it measured to lies
   * outside the room. A 9.6x over-report on the criterion carrying 40 % of the model.
   *
   * Refused before any measurement rather than per face: the whole ratio rests on that box, so a
   * minimum taken over faces that happened to miss the error would be the same lie with fewer
   * chances to show itself — the reasoning `SC-907` and `SC-906` already follow above.
   */
  if (!isAxisAlignedRectangle(input.room)) return unavailable('SC-908');

  const roomBounds = boundsOf(input.room);
  const ratios: number[] = [];
  /*
   * Checked here rather than left to `freeDistanceOnSide`, so the criterion can refuse rather than
   * silently measuring past an occupant it has no size for. One `null` here means the room holds
   * equipment the catalogue does not describe, and there is no honest headroom figure to report.
   */
  if (occupantBounds(input.occupants, input.catalog) === null) return unavailable('SC-906');

  for (const result of report.results) {
    if (result.category !== 'clearance' || result.appliedValue === null) continue;
    if (result.appliedValue <= 0) continue;

    const side = sideOfRule(input.ruleSet, result.ruleId);
    if (!side) continue;

    for (const placementId of result.placementIds) {
      const placement = input.placements.find((entry) => entry.id === placementId);
      if (!placement) continue;

      const free = freeDistanceOnSide(placement, side, input, roomBounds);
      if (free === null) continue;
      /*
       * Owner decision, tenth review round: one blocked face voids the whole criterion, even
       * when every other face measures cleanly. `SC-906` already answers a structurally
       * identical question this way — an occupant with no catalogue entry refuses the whole
       * criterion rather than measuring around the unknown — and the standing "Unknown must
       * remain Unknown" instruction points at the same answer here. The alternative (report the
       * minimum of whatever measured) was confirmed to make a non-convex obstruction cost
       * nothing whenever any other governed face happened to be clear, which is the opposite
       * failure from the one this whole fix exists to close.
       */
      if (free === 'unavailable') return unavailable('SC-907');
      ratios.push(free / result.appliedValue);
    }
  }

  if (ratios.length === 0) return unavailable('SC-904');
  return measured(Math.min(...ratios));
}

/**
 * Is this outline exactly its own bounding box?
 *
 * The condition under which measuring to `boundsOf(room)` is measuring to the room — owner decision
 * D4. Four distinct corners, every edge axis-parallel, and each corner of the box present.
 *
 * Deliberately stricter than convexity. A rotated rectangle is convex and its bounding box is
 * strictly larger than it is, so a convexity test would have let exactly the same approximation
 * through on any room an engineer traced off a drawing that was not square to the page.
 */
function isAxisAlignedRectangle(room: readonly Vec2[]): boolean {
  const distinct = room.filter(
    (point, index) => index === 0 || point.x !== room[index - 1]?.x || point.y !== room[index - 1]?.y,
  );
  if (distinct.length !== 4) return false;

  for (let i = 0; i < 4; i += 1) {
    const a = distinct[i];
    const b = distinct[(i + 1) % 4];
    if (!a || !b) return false;
    // Every edge runs along one axis: exactly one coordinate changes.
    if (a.x !== b.x && a.y !== b.y) return false;
    if (a.x === b.x && a.y === b.y) return false;
  }

  const xs = new Set(distinct.map((point) => point.x));
  const ys = new Set(distinct.map((point) => point.y));
  return xs.size === 2 && ys.size === 2;
}

/** Which face a clearance rule governs. Null for a rule that is not a per-side clearance. */
function sideOfRule(ruleSet: RuleSet, ruleId: string): ClearanceSide | null {
  const rule = ruleSet.rules.find((entry) => entry.ruleId === ruleId);
  if (!rule || rule.category !== 'clearance') return null;
  const side = (rule.parameters as { side?: string }).side;
  return side === 'front' || side === 'rear' || side === 'left' || side === 'right' ? side : null;
}

/**
 * How much room there actually is on one face, in millimetres.
 *
 * ## Why this is measured rather than read off a finding
 *
 * The obvious implementation is `result.measured / result.appliedValue`, and it does not work: the
 * rule engine reports `measured` only when something is **inside** the clearance zone. A compliant
 * machine has nothing in its zone, so `measured` is null — the very layouts this criterion exists to
 * rank are the ones the finding cannot supply a number for.
 *
 * So headroom is geometry. Walk outward from the face until something stops you: another machine's
 * footprint, an obstruction, or the room's own edge. That distance over the requirement is the
 * margin, and it is defined for exactly the compliant layouts a finding is silent about.
 *
 * Sampled outward in 50 mm steps to a ceiling of three times the requirement. The ceiling costs
 * nothing — the criterion normalises against a 1.5× target and clamps — and it stops an open room
 * from turning into a long walk for a number that is already at full marks.
 */
const PROBE_STEP_MM = 50;
const PROBE_CEILING_MULTIPLE = 3;

/**
 * The free distance in front of a service face, in millimetres — the **minimum across the whole
 * face**, not along one ray through its middle.
 *
 * > Architecture decision AD-21. Owner decision, following the Critical 0 review's third finding:
 * > *"minimum across the whole face"*, matching `@mfd/rule-engine`'s own clearance evaluator and
 * > `measureMaintenanceAccess`'s existing "full containment, not mere overlap" standard, over
 * > "along the centreline", which let an obstruction anywhere else in a declared clearance zone
 * > score full marks — measured at the time: 3.0 (the ceiling) for an obstruction squarely inside a
 * > zone but off-centre, versus 0.125 for the identical obstruction moved onto the centreline.
 *
 * The face itself comes from `@mfd/object-library`'s `faceGeometry`, which derives the anchor and
 * the face's own lateral extent from the side's model-space outward normal rather than from a
 * `ClearanceZone` polygon's corner order — see its own doc comment for why deriving from corner
 * order can't be made to work. Against another placement's or an obstruction's real polygon, the
 * measurement is `@mfd/rule-engine`'s exact `gapAlongNormal` — the same function, the same result,
 * rather than a second implementation free to drift from the rule engine's own finding on the same
 * geometry.
 *
 * The room edge is not a polygon "in front of" the face the way an obstruction is — it is a
 * container, not an obstacle — so `gapAlongNormal` does not apply to it directly. It is checked
 * at the face's own two ends (`face.min`/`face.max`) rather than only its centre: for a *convex*
 * room, the distance to the boundary along a fixed direction is a concave function of the starting
 * point's position along the face, and a concave function over an interval attains its minimum at
 * one of the interval's endpoints — so the two ends are provably enough to find the worst point,
 * with no need to sample the interior. **This does not hold for a concave (non-convex) room
 * outline**, where a dip between the two ends could go undetected; the room polygon is still
 * reduced to its axis-aligned bounds beforehand (`roomBounds`, unchanged from the prior version),
 * so a diagonal or irregular wall is already only approximated. Both are pre-existing imprecisions,
 * not part of what this Critical 0 review round was scoped to close.
 *
 * ## Clamped at zero
 *
 * `@mfd/rule-engine`'s `gapAlongNormal` reports a *negative* gap when a polygon crosses the face's
 * plane, within the face's own lateral extent. The fifth Critical 0 review round found this
 * reachable and confirmed it directly with a quad `polygonsOverlap` calls non-overlapping — but the
 * seventh round found that reproduction was measuring against a corner standing beside the face,
 * outside its own width, not in front of it: `gapAlongNormal` now clips to the face's own extent
 * before measuring, and the reproduction's true whole-face gap is positive.
 *
 * For **another placement** measured against this one — always a plain rectangle, both today's only
 * shape — a clipped crossing and an actual overlap with the footprint being measured against turn
 * out to be the same event (checked directly: two million randomised, band-constrained, straddling
 * polygons against a rectangular reference, zero non-colliding), and every `scoreLayout` call in
 * this package is gated behind Gate 2 first — so a negative, clipped result against a placement
 * would itself be evidence of a collision this function is never actually asked about.
 *
 * **This does not extend to an obstruction.** The eighth review round found a genuinely
 * non-overlapping, non-convex obstruction — a riser wrapping around one side of the machine, from in
 * front of this face to beyond its far side — can still drive `gapAlongNormal` deeply negative: the
 * function clips laterally and then takes the single minimum projection across everything left, with
 * no regard for whether that minimum comes from material actually nearest the face or from a
 * disconnected piece reached only by going around the machine. Gate 2's own boundary rule uses a
 * concave-correct test (`polygonsOverlapAnywhere`) and passes this shape; `compliance_margin` still
 * reported 0 for a rear face with 100 mm of genuine headroom. Confirmed directly, wired the way
 * `apps/web`'s `runSolver.ts` actually wires it — the same `Boundary` fed to both `applyGates` and
 * `scoreLayout`'s `obstructions`, not two disconnected inputs.
 *
 * **Owner decision: report the face unavailable rather than measure it.** `gapAlongNormal` has no
 * notion of "nearest connected material", and giving it one is a real geometry investment (convex
 * decomposition) the owner has not yet asked for. Until it exists, a face is only measured against
 * an obstruction `@mfd/rule-engine`'s `isConvexPolygon` accepts; an obstruction that both fails that
 * check and actually lies in front of the face — `gapAlongNormal`'s own full relevance test, not
 * merely the lateral half of it (see the tenth review round's finding below) — makes this face's
 * headroom unknown for this side, rather than reported as a number the geometry cannot back. That
 * is a real loss of coverage on any drawing with a non-convex riser or duct run near a governed
 * face — the honest alternative to a number that reads as measured and is not.
 *
 * **The tenth review round found the first version of this check used only the lateral half of
 * `gapAlongNormal`'s relevance test**, so a non-convex obstruction anywhere in the face's lateral
 * band — including one entirely behind the face plane, on the far side of the machine, that
 * `gapAlongNormal` itself would have ignored outright — voided the face's measurement. Fixed by
 * calling `gapAlongNormal` itself and abstaining only when *it* reports a result: a `null` means
 * `gapAlongNormal` already decided this obstruction is not in front of the face at all, and a
 * non-convex obstruction the function ignores costs nothing, matching what the paragraph above
 * claims.
 *
 * **The same review round also found the caller's original handling of a blocked face too
 * forgiving**: dropping it from the ratio pool and reporting the minimum of whatever else
 * measured made a non-convex obstruction cost *nothing* the moment any other governed face was
 * clear — confirmed directly, a station 100 mm from a non-convex riser scored identically to one
 * with no obstruction at all, so long as one other face was free. **Owner decision: any blocked
 * face voids the whole criterion** (`measureComplianceMargin` returns `SC-907` the instant this
 * function returns `'unavailable'`, rather than continuing to the next candidate), matching how
 * `SC-906` already refuses the whole criterion for an occupant with no catalogue entry rather than
 * measuring around the unknown.
 */

function freeDistanceOnSide(
  placement: Placement,
  side: ClearanceSide,
  input: MeasureInput,
  room: Bounds | null,
): number | null | 'unavailable' {
  const object = input.catalog.get(placement.equipmentObjectId);
  if (!object) return null;

  const required = object.serviceClearance[side];
  if (required === null) return null;

  const face = faceGeometry(object, placement.transform, side);
  const ceiling = required * PROBE_CEILING_MULTIPLE;

  let nearest: number | null = null;
  const consider = (rawGap: number | null) => {
    if (rawGap === null) return;
    // Owner decision: a negative gap clamps to zero rather than reporting a signed distance
    // nothing asked for. See this function's doc comment for why this is believed unreachable
    // today, and kept anyway.
    const gap = Math.max(0, rawGap);
    if (nearest === null || gap < nearest) nearest = gap;
  };

  // Every other placement in the room blocks this face, not only this equipment kind — the
  // machine being measured is excluded by id, since it is not an obstacle to its own service face.
  for (const other of input.occupants) {
    if (other.id === placement.id) continue;
    const otherObject = input.catalog.get(other.equipmentObjectId);
    if (!otherObject) continue;
    consider(gapAlongNormal(face, face, footprintCorners(otherObject, other.transform)));
  }

  for (const obstruction of input.obstructions) {
    const rawGap = gapAlongNormal(face, face, obstruction);
    // `gapAlongNormal` has already decided this obstruction is not in front of the face at all —
    // behind the plane or off to one side — so a non-convex shape here costs nothing; there is no
    // "nearest material" question to get wrong about geometry that was never in play.
    if (rawGap === null) continue;
    if (!isConvexPolygon(obstruction)) return 'unavailable';
    consider(rawGap);
  }

  consider(nearestRoomEdgeAcrossFace(face, room, ceiling));

  return nearest === null ? ceiling : Math.min(nearest, ceiling);
}

/**
 * How far the face can extend, at its worst end, before leaving the room — `null` when it does not
 * leave within `ceiling`, at either end. See {@link freeDistanceOnSide} for why the two ends suffice
 * for a convex room and not for a concave one.
 */
function nearestRoomEdgeAcrossFace(face: Face, room: Bounds | null, ceiling: number): number | null {
  if (room === null) return null;

  const originProjection = face.origin.x * face.axis.x + face.origin.y * face.axis.y;
  let nearest: number | null = null;

  for (const offset of [face.min, face.max]) {
    const along = offset - originProjection;
    const start = {
      x: face.origin.x + face.axis.x * along,
      y: face.origin.y + face.axis.y * along,
    };

    for (let distance = 0; distance <= ceiling; distance += PROBE_STEP_MM) {
      const point = { x: start.x + face.normal.x * distance, y: start.y + face.normal.y * distance };
      if (!within(room, point)) {
        if (nearest === null || distance < nearest) nearest = distance;
        break;
      }
    }
  }

  return nearest;
}

function within(bounds: Bounds, point: Vec2): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

/**
 * The footprints of everything in the room except one placement, or **null** when any of them has
 * no catalogue entry.
 *
 * ## Why null rather than a shorter list
 *
 * There were two of these, and they disagreed silently. One substituted the *measured* object's
 * footprint for an unknown occupant — inventing a dimension for equipment nothing knows the size of.
 * The other dropped it, so it blocked nothing and the room measured emptier than it is. Both became
 * reachable the moment the scored population and the blocking population came apart, and neither
 * was tested.
 *
 * > Owner: *"Unknown must remain Unknown. Never interpolate. Never estimate. Never replace missing
 * > data with assumptions."*
 *
 * A guessed footprint and an ignored one are both assumptions — one about size, one about absence.
 * So the answer is that the criterion cannot be measured, reported as `SC-906`, and every caller
 * has to handle it because the type says so.
 */
/** `@mfd/cad-engine`'s `Rect` (x, y, width, height) as this file's `Bounds` (min/max). */
function rectToBounds(rect: Rect): Bounds {
  return {
    minX: rect.x,
    minY: rect.y,
    maxX: rect.x + rect.width,
    maxY: rect.y + rect.height,
  };
}

interface OccupantBounds {
  readonly placementId: string;
  readonly bounds: Bounds;
}

/**
 * The rotated, origin-correct bounding box of every occupant's own footprint.
 *
 * > Owner decision, following the standing review: equipment geometry rotates with its placement.
 *
 * Delegates to `@mfd/object-library`'s `footprintBounds`, which this file used to duplicate rather
 * than import. The duplicate was also wrong: it built the local rectangle centred on `(0, 0)`,
 * which is correct only for a `symbol.origin: "centre"` object. Every shipped record is
 * `"front-left"` — local `[0, width] × [0, depth]` — so the duplicate rotated the right rectangle
 * about the wrong point, off by up to half the footprint on each axis. `footprintBounds` reads the
 * origin from `localFootprintRect` and gets this right by construction; this file no longer needs
 * to know the convention at all.
 */
function occupantBounds(placements: readonly Placement[], catalog: Catalog): OccupantBounds[] | null {
  const found: OccupantBounds[] = [];
  for (const placement of placements) {
    const object = catalog.get(placement.equipmentObjectId);
    if (!object) return null;
    found.push({
      placementId: placement.id,
      bounds: rectToBounds(objectFootprintBounds(object, placement.transform)),
    });
  }
  return found;
}

/** Everything except one placement — by id, which is the only thing that identifies it. */
function excluding(occupants: readonly OccupantBounds[], placementId: string): Bounds[] {
  return occupants
    .filter((entry) => entry.placementId !== placementId)
    .map((entry) => entry.bounds);
}

/**
 * Installation feasibility — the fraction of machines that can actually be got into place.
 *
 * Two components, both deterministic:
 *
 * | | |
 * | --- | --- |
 * | **Delivery path** | Is there a route from the level's `access_entry` to this machine's position, clear of everything installed? |
 * | **Working space** | Is there room at the connection faces for an installer, which is not the same envelope as service clearance in use? |
 *
 * A layout can satisfy every clearance rule and still require a machine to pass through a 700 mm
 * door, which is why this is a criterion and not a corollary of compliance.
 *
 * ## The crate allowance comes from drawings, or the criterion is not measured
 *
 * This used to be `const CRATE_ALLOWANCE_MM = 150` — a planning assumption written into the solver,
 * whose own comment admitted it wanted a citation. It is now read from the knowledge base, and when
 * no drawing has been observed the criterion reports `SC-905` rather than falling back.
 *
 * That is a real reduction in what the optimiser can currently discriminate on, and it is the
 * correct one: a delivery envelope decides whether a machine can physically reach its position, and
 * a wrong one produces a layout that cannot be installed. An invented 150 mm was not more useful
 * than no answer, it was less — it looked like a measurement.
 *
 * **The maximum observed allowance is used, not the median.** This is a feasibility question, so
 * the conservative reading is the safe one: a route wide enough for the widest crate anyone drew is
 * wide enough for all of them. Taking the median would call a machine deliverable on evidence that
 * half the observed sites would contradict.
 */

function measureInstallationFeasibility(input: MeasureInput): Measurement {
  const entry = pointOfKind(input.referencePoints, 'access_entry');
  if (!entry) return unavailable('SC-901');
  if (input.placements.length === 0) return unavailable('SC-902');

  const within = boundsOf(input.room);
  if (!within) return unavailable('SC-902');

  /*
   * `isPattern` as well as present: a single drawing's allowance is that site's choice, and seeding
   * a feasibility envelope from one observation would give the confident answer this package
   * exists to avoid. Below the support threshold the honest answer is that we do not know yet.
   */
  const allowance = input.knowledge.dimension('delivery_crate_allowance');
  if (!allowance || !allowance.isPattern) return unavailable('SC-905');

  /*
   * ## The observed allowance decides *whether* this is measured, and nothing about its geometry
   *
   * > Owner decision: option A. A route reaching the machine's position is enough. Planning
   * > footprints are modelled larger than the physical equipment wherever a margin belongs to the
   * > object rather than to its delivery — so a route to the footprint already carries the margin
   * > the design calls for, and there is no separate crate outline to route a second time.
   *
   * This was found worth asking because a fallback used to obscure it: the crated size used to be
   * computed here and handed to the router as the footprint for a placement the catalogue does not
   * describe, and nothing else. `routedDistance` routes a line and takes no width (routing.ts:89),
   * so the route was never checked against a crate's dimensions — the heading above this function
   * used to claim otherwise. `allowance` still gates whether the criterion is measured at all:
   * `SC-905` when no drawing has established a figure, which is the invented-constant failure this
   * replaced and is unrelated to the question above.
   */
  const occupants = occupantBounds(input.occupants, input.catalog);
  if (occupants === null) return unavailable('SC-906');

  let deliverable = 0;
  for (const placement of input.placements) {
    // Everything except this machine blocks its own delivery — including the obstructions, and
    // including the other machines, because they are installed too and the order is the planner's
    // problem rather than this criterion's.
    const blockers = [
      ...obstructionBounds(input.obstructions),
      ...excluding(occupants, placement.id),
    ];

    const route = routedDistance({
      from: entry.position,
      // Owner decision, AD-21 routing/report anchor follow-up: the footprint's true centre, not
      // `transform.position` — the corner for every shipped record, which never moved under a pure
      // rotation even though the machine visibly swept elsewhere.
      to: footprintCentre(input.object, placement.transform),
      blocked: blockers,
      within,
    });
    if (route !== null) deliverable += 1;
  }

  return measured(deliverable / input.placements.length);
}

/**
 * Maintenance access — the fraction of machines a service engineer can actually reach.
 *
 * Reachable means: at least one of the machine's service faces has its clearance envelope free of
 * another machine's footprint, clear of every obstruction, and inside the room. Needs no reference
 * point, which is why it is the one weighted criterion that is always measurable — 15 % of the
 * model that survives an empty document.
 *
 * > Owner decision, following the standing review: **obstructions and the room boundary block a
 * > service face**, the same as equipment does.
 *
 * The three geometric criteria disagreed on this before the decision: the compliance-margin probe
 * already counted equipment, obstructions and the room edge; installation feasibility counted
 * equipment and obstructions; this counted equipment alone, so a machine backed against a wall or
 * standing beside a column read as serviceable on whichever side actually had no room to stand in.
 * The criterion's own name is the reason the wider answer is correct — *"can actually reach it"*
 * means from the floor a technician can actually stand on.
 */
function measureMaintenanceAccess(input: MeasureInput): Measurement {
  if (input.placements.length === 0) return unavailable('SC-902');

  const occupants = occupantBounds(input.occupants, input.catalog);
  if (occupants === null) return unavailable('SC-906');

  const obstacles = obstructionBounds(input.obstructions);
  const roomBounds = boundsOf(input.room);

  let reachable = 0;
  for (const placement of input.placements) {
    const blockers = [...excluding(occupants, placement.id), ...obstacles];

    /*
     * `clearanceZones` builds each side's zone in the object's own local frame — respecting both
     * `symbol.origin` and `symbol.frontEdge` — and rotates it into model space itself. This file
     * used to build the same rectangle by hand, in model space, always assuming front was +Y: two
     * assumptions (never rotated, front is always "south") baked into one formula, both true of
     * every fixture used to write it and neither true in general. Restricted to front/rear here,
     * matching what this criterion has always checked — a side with no declared clearance simply
     * has no zone, the same as before.
     */
    const faces = clearanceZones(input.object, placement.transform)
      .filter((zone) => zone.side === 'front' || zone.side === 'rear')
      .map((zone) => boundsOf(zone.polygon))
      .filter((bounds): bounds is Bounds => bounds !== null);

    // No declared clearance at all is a data gap, not a pass: it cannot be established that
    // anybody can service this machine.
    if (faces.length === 0) return unavailable('SC-904');

    // A face standing partly outside the room is not a face anyone can stand in front of. Full
    // containment, not mere overlap — a corner of clear floor on the room side of a face does not
    // make the other half of it reachable.
    const clearFace = (face: Bounds): boolean =>
      blockers.every((blocker) => !overlaps(face, blocker)) &&
      (roomBounds === null || fullyWithin(roomBounds, face));

    if (faces.some(clearFace)) reachable += 1;
  }

  return measured(reachable / input.placements.length);
}

/**
 * How many more machines fit **without moving any existing one**.
 *
 * Measured by asking the generator, which is why the "without moving" qualifier is free: existing
 * placements become obstructions, so a candidate that would displace one cannot be produced.
 */
function measureFutureExpansion(input: MeasureInput): Measurement {
  /*
   * **Unavailable when nothing is placed**, and this is not a formality.
   *
   * "How many *more* fit" needs a layout to be more than. An empty room fits the most, so without
   * this guard an empty room scored 1.00 on expansion — and since expansion is the only criterion
   * that needs neither a reference point nor a threshold, that was the *whole* total, at 0.05
   * coverage. A blank drawing came out as a perfect layout.
   *
   * That is the emptiest-room failure returning in a new shape: it was kept out of the weighted sum
   * by making station count a constraint, and crept back in through a criterion that improves as
   * the room empties. Found by a test asserting an empty room scores nothing.
   */
  if (input.placements.length === 0) return unavailable('SC-902');

  /*
   * Everything in the room, at **its own** footprint.
   *
   * Two corrections in one line. The population is `occupants` rather than `placements`, so space
   * a machine of another kind is standing in is not offered as room to expand into. And the size
   * comes from each placement's own catalogue entry via `occupantBounds` rather than from
   * `object.planningFootprint` applied to all of them — which was harmless while every placement
   * here was the same kind and is wrong the moment it is not. A dialysis bed is 1,000 x 2,100 mm
   * against the AK98's 800 x 800, so measuring one as the other misplaces a square metre.
   */
  const occupants = occupantBounds(input.occupants, input.catalog);
  if (occupants === null) return unavailable('SC-906');
  const occupied = occupants.map((entry) => entry.bounds);

  const blocked = [
    ...input.obstructions,
    ...occupied.map((bounds) => [
      { x: bounds.minX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.maxY },
      { x: bounds.minX, y: bounds.maxY },
    ]),
  ];

  // Bounded: past a dozen more the answer stops discriminating between layouts, and the reference
  // in the shipped model is four.
  const CEILING = 12;
  for (let extra = CEILING; extra > 0; extra -= 1) {
    const fits = generateCandidates({
      room: input.room,
      obstructions: blocked,
      object: input.object,
      stationCount: extra,
      pitchPadding: input.pitchPadding,
    });
    if (fits.length > 0) return measured(extra);
  }
  return measured(0);
}

/**
 * Summed routed distance from a reference point to every machine.
 *
 * Shared by RO piping, electrical, drain and walking distance: the four criteria differ only in
 * which point they measure from and, for one of them, what counts as an obstacle — so they differ
 * only in arguments. Writing four near-identical functions would have been four places for a fix
 * to be applied to three of.
 *
 * ## Equipment blocks a walk; it does not block a pipe
 *
 * > Owner decision, following the standing review: **`walking_distance` routes around equipment,
 * > the three service runs do not.**
 *
 * RO piping, electrical and drain are run in a ceiling or floor void — a machine standing on the
 * floor is not in their way, and only structural obstructions are. Walking distance measures a
 * person, on the floor, going to the machine: every other machine in the room is exactly as much
 * in their way as a column is, and routing straight through one is not a distance anybody would
 * actually walk.
 *
 * **A machine with no route contributes `unavailable` for the whole criterion**, rather than being
 * skipped. A sum over the reachable subset would score a layout with an unreachable machine as
 * *shorter* than one where everything is reachable — better, for a criterion that minimises.
 */
function measureRouting(input: MeasureInput, kind: ReferencePointKind): Measurement {
  const origin = pointOfKind(input.referencePoints, kind);
  if (!origin) return unavailable('SC-901');
  if (input.placements.length === 0) return unavailable('SC-902');

  const within = boundsOf(input.room);
  if (!within) return unavailable('SC-902');

  const obstacles = obstructionBounds(input.obstructions);

  // Only `walking_distance` needs to know what else is in the room. Computed for that kind alone
  // so the three service runs never need a catalogue entry for equipment they do not route around.
  const occupants = kind === 'staff_base' ? occupantBounds(input.occupants, input.catalog) : [];
  if (occupants === null) return unavailable('SC-906');

  let total = 0;
  for (const placement of input.placements) {
    const route = routedDistance({
      from: origin.position,
      // Owner decision, AD-21 routing/report anchor follow-up: the footprint's true centre, not
      // `transform.position` — see `measureInstallationFeasibility`'s identical comment.
      to: footprintCentre(input.object, placement.transform),
      blocked: [...obstacles, ...excluding(occupants, placement.id)],
      within,
    });
    if (route === null) return unavailable('SC-903');
    total += route;
  }

  return measured(total);
}

function pointOfKind(
  points: readonly ReferencePointSummary[],
  kind: ReferencePointKind,
): ReferencePointSummary | undefined {
  return points.find((point) => point.kind === kind);
}

function obstructionBounds(obstructions: readonly (readonly Vec2[])[]): Bounds[] {
  return obstructions
    .map((polygon) => boundsOf(polygon))
    .filter((bounds): bounds is Bounds => bounds !== null);
}

function overlaps(a: Bounds, b: Bounds): boolean {
  return !(a.maxX <= b.minX || a.minX >= b.maxX || a.maxY <= b.minY || a.minY >= b.maxY);
}

/**
 * Is `inner` entirely inside `outer`? Touching an edge counts as inside.
 *
 * The same tie-break as `polygonContainsPolygon`'s VD-5 decision: *"A footprint touching the room
 * boundary is considered contained... treat boundary contact as topological contact, not as a
 * crossing."* A service face flush with the wall is not a face standing outside the room; the
 * flip side is that a face crossing the wall by any amount is.
 */
function fullyWithin(outer: Bounds, inner: Bounds): boolean {
  return (
    inner.minX >= outer.minX &&
    inner.maxX <= outer.maxX &&
    inner.minY >= outer.minY &&
    inner.maxY <= outer.maxY
  );
}
