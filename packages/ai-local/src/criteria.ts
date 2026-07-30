import type {
  ReferencePointSummary,
  ScoreReasonCode,
  ScoringCriterion,
} from '@mfd/ai-contract';
import type { Vec2 } from '@mfd/cad-engine';
import type { Boundary, Placement, ReferencePointKind } from '@mfd/document-model';
import type { ClearanceSide, Catalog, EquipmentObject } from '@mfd/object-library';
import { localToModel, sideNormals } from '@mfd/object-library';
import type { RuleSet } from '@mfd/rule-engine';
import { evaluate } from '@mfd/rule-engine';

import { generateCandidates } from './candidates';
import { type Bounds, boundsAround, boundsOf, routedDistance } from './routing';

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
  readonly placements: readonly Placement[];
  readonly catalog: Catalog;
  readonly ruleSet: RuleSet;
  readonly boundaries: readonly Boundary[];
  readonly room: readonly Vec2[];
  readonly obstructions: readonly (readonly Vec2[])[];
  readonly referencePoints: readonly ReferencePointSummary[];
  readonly object: EquipmentObject;
  readonly planStatus: 'none' | 'calibrated' | 'uncalibrated';
  readonly pitchPadding: number;
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

  const obstacles = obstructionBounds(input.obstructions);
  const roomBounds = boundsOf(input.room);
  const ratios: number[] = [];

  for (const result of report.results) {
    if (result.category !== 'clearance' || result.appliedValue === null) continue;
    if (result.appliedValue <= 0) continue;

    const side = sideOfRule(input.ruleSet, result.ruleId);
    if (!side) continue;

    for (const placementId of result.placementIds) {
      const placement = input.placements.find((entry) => entry.id === placementId);
      if (!placement) continue;

      const free = freeDistanceOnSide(placement, side, input, obstacles, roomBounds);
      if (free === null) continue;
      ratios.push(free / result.appliedValue);
    }
  }

  if (ratios.length === 0) return unavailable('SC-904');
  return measured(Math.min(...ratios));
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

function freeDistanceOnSide(
  placement: Placement,
  side: ClearanceSide,
  input: MeasureInput,
  obstacles: readonly Bounds[],
  room: Bounds | null,
): number | null {
  const object = input.catalog.get(placement.equipmentObjectId);
  if (!object) return null;

  const required = object.serviceClearance[side];
  if (required === null) return null;

  const normal = sideNormals(object)[side];
  const transform = placement.transform;
  // The normal is in the object's local frame; rotating it by the placement's own rotation gives
  // the direction in model space. `localToModel` on the origin and on the normal, differenced,
  // does that without this file needing to know the transform's internals.
  const origin = localToModel({ x: 0, y: 0 }, transform);
  const tip = localToModel(normal, transform);
  const direction = { x: tip.x - origin.x, y: tip.y - origin.y };

  const footprint = input.catalog.get(placement.equipmentObjectId)?.designFootprint;
  if (!footprint) return null;

  // Start at the face rather than the centre.
  const reach =
    Math.abs(direction.x) > Math.abs(direction.y) ? footprint.width / 2 : footprint.depth / 2;
  const others = footprintBoundsOf(input.placements, input.catalog, placement.id);
  const ceiling = required * PROBE_CEILING_MULTIPLE;

  for (let distance = 0; distance <= ceiling; distance += PROBE_STEP_MM) {
    const point = {
      x: placement.transform.position.x + direction.x * (reach + distance),
      y: placement.transform.position.y + direction.y * (reach + distance),
    };

    const blocked =
      others.some((rect) => within(rect, point)) ||
      obstacles.some((rect) => within(rect, point)) ||
      (room !== null && !within(room, point));

    if (blocked) return distance;
  }

  return ceiling;
}

function within(bounds: Bounds, point: Vec2): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

function footprintBoundsOf(
  placements: readonly Placement[],
  catalog: Catalog,
  exceptId: string,
): Bounds[] {
  return placements
    .filter((placement) => placement.id !== exceptId)
    .flatMap((placement) => {
      const object = catalog.get(placement.equipmentObjectId);
      if (!object) return [];
      return [
        boundsAround(
          placement.transform.position,
          object.designFootprint.width,
          object.designFootprint.depth,
        ),
      ];
    });
}

/**
 * Installation feasibility — the fraction of machines that can actually be got into place.
 *
 * Two components, both deterministic:
 *
 * | | |
 * | --- | --- |
 * | **Delivery path** | Is there a route from the level's `access_entry` to this machine's position wide enough for its **crated** footprint? |
 * | **Working space** | Is there room at the connection faces for an installer, which is not the same envelope as service clearance in use? |
 *
 * A layout can satisfy every clearance rule and still require a machine to pass through a 700 mm
 * door, which is why this is a criterion and not a corollary of compliance.
 *
 * The crate allowance is a **planning assumption**, not a manufacturer figure: 150 mm on each side
 * of the design footprint. Stated here rather than buried, because it is exactly the kind of number
 * that should carry a citation once the manual supplies one.
 */
const CRATE_ALLOWANCE_MM = 150;

function measureInstallationFeasibility(input: MeasureInput): Measurement {
  const entry = pointOfKind(input.referencePoints, 'access_entry');
  if (!entry) return unavailable('SC-901');
  if (input.placements.length === 0) return unavailable('SC-902');

  const within = boundsOf(input.room);
  if (!within) return unavailable('SC-902');

  const crate = {
    width: input.object.designFootprint.width + CRATE_ALLOWANCE_MM * 2,
    depth: input.object.designFootprint.depth + CRATE_ALLOWANCE_MM * 2,
  };

  let deliverable = 0;
  for (const placement of input.placements) {
    // Everything except this machine blocks its own delivery — including the obstructions, and
    // including the other machines, because they are installed too and the order is the planner's
    // problem rather than this criterion's.
    const blockers = [
      ...obstructionBounds(input.obstructions),
      ...footprintBounds(input.placements, input.catalog, placement.id, crate),
    ];

    const route = routedDistance({
      from: entry.position,
      to: placement.transform.position,
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
 * another machine's footprint. Needs no reference point, which is why it is the one weighted
 * criterion that is always measurable — 15 % of the model that survives an empty document.
 */
function measureMaintenanceAccess(input: MeasureInput): Measurement {
  if (input.placements.length === 0) return unavailable('SC-902');

  const clearance = input.object.serviceClearance;
  const footprint = input.object.designFootprint;

  let reachable = 0;
  for (const placement of input.placements) {
    const others = footprintBounds(input.placements, input.catalog, placement.id, footprint);
    const centre = placement.transform.position;

    const faces: Bounds[] = [];
    if (clearance.front !== null) {
      faces.push({
        minX: centre.x - footprint.width / 2,
        maxX: centre.x + footprint.width / 2,
        minY: centre.y + footprint.depth / 2,
        maxY: centre.y + footprint.depth / 2 + clearance.front,
      });
    }
    if (clearance.rear !== null) {
      faces.push({
        minX: centre.x - footprint.width / 2,
        maxX: centre.x + footprint.width / 2,
        minY: centre.y - footprint.depth / 2 - clearance.rear,
        maxY: centre.y - footprint.depth / 2,
      });
    }

    // No declared clearance at all is a data gap, not a pass: it cannot be established that
    // anybody can service this machine.
    if (faces.length === 0) return unavailable('SC-904');

    if (faces.some((face) => others.every((other) => !overlaps(face, other)))) reachable += 1;
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

  const occupied = input.placements.map((placement) =>
    boundsAround(
      placement.transform.position,
      input.object.designFootprint.width,
      input.object.designFootprint.depth,
    ),
  );

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
 * which point they measure from, so they differ only in an argument. Writing four near-identical
 * functions would have been four places for a fix to be applied to three of.
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

  let total = 0;
  for (const placement of input.placements) {
    const route = routedDistance({
      from: origin.position,
      to: placement.transform.position,
      // Machines do not block a pipe run to themselves or to each other: services are routed in a
      // ceiling or a floor void, not across the floor between the machines.
      blocked: obstacles,
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

function footprintBounds(
  placements: readonly Placement[],
  catalog: Catalog,
  exceptId: string,
  size: { width: number; depth: number },
): Bounds[] {
  return placements
    .filter((placement) => placement.id !== exceptId)
    .map((placement) => {
      const object = catalog.get(placement.equipmentObjectId);
      const width = object?.designFootprint.width ?? size.width;
      const depth = object?.designFootprint.depth ?? size.depth;
      return boundsAround(placement.transform.position, width, depth);
    });
}

function overlaps(a: Bounds, b: Bounds): boolean {
  return !(a.maxX <= b.minX || a.minX >= b.maxX || a.maxY <= b.minY || a.minY >= b.maxY);
}
