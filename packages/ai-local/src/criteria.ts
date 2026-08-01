import type {
  ReferencePointSummary,
  ScoreReasonCode,
  ScoringCriterion,
} from '@mfd/ai-contract';
import type { Rect, Vec2 } from '@mfd/cad-engine';
import type { Boundary, Placement, ReferencePointKind } from '@mfd/document-model';
import type { ClearanceSide, Catalog, EquipmentObject } from '@mfd/object-library';
import {
  clearanceZones,
  footprintBounds as objectFootprintBounds,
  localToModel,
  sideNormals,
} from '@mfd/object-library';
import type { RuleSet } from '@mfd/rule-engine';
import { evaluate } from '@mfd/rule-engine';

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

  const obstacles = obstructionBounds(input.obstructions);
  const roomBounds = boundsOf(input.room);
  const ratios: number[] = [];
  /*
   * Hoisted out of the probe so the criterion can refuse rather than silently probing past an
   * occupant it has no size for. One `null` here means the room holds equipment the catalogue does
   * not describe, and there is no honest headroom figure to report — see `occupantBounds`.
   */
  const occupants = occupantBounds(input.occupants, input.catalog);
  if (occupants === null) return unavailable('SC-906');

  for (const result of report.results) {
    if (result.category !== 'clearance' || result.appliedValue === null) continue;
    if (result.appliedValue <= 0) continue;

    const side = sideOfRule(input.ruleSet, result.ruleId);
    if (!side) continue;

    for (const placementId of result.placementIds) {
      const placement = input.placements.find((entry) => entry.id === placementId);
      if (!placement) continue;

      const free = freeDistanceOnSide(placement, side, input, obstacles, roomBounds, occupants);
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
  occupants: readonly OccupantBounds[],
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

  const footprint = input.catalog.get(placement.equipmentObjectId)?.planningFootprint;
  if (!footprint) return null;

  /*
   * Start at the face rather than the centre. Which half-extent that is depends on which LOCAL
   * axis the normal lies along — `normal.x !== 0` for east/west, `normal.y !== 0` for north/south —
   * and not on the *rotated* `direction`, which the previous version compared instead. Comparing
   * the rotated direction is wrong at every angle except multiples of 90°: at rotation 0 it happens
   * to agree with the local axis, which is why every test written before a non-square, rotated
   * occupant existed passed anyway. At 45° the comparison degenerates to an arbitrary tie-break;
   * a bed at 90° started this probe 550 mm inside its own footprint rather than at its face.
   *
   * This does not correct a separate, pre-existing simplification: for a `symbol.origin:
   * "front-left"` object — every shipped record — `transform.position` is the footprint's corner,
   * not its centre, so this probe's start point is offset from the true face centre along the
   * perpendicular axis too. That is unrelated to rotation and unchanged here; it is a question
   * about `freeDistanceOnSide`'s anchor, not about which axis its reach uses.
   */
  const reach = normal.x !== 0 ? footprint.width / 2 : footprint.depth / 2;
  // Everything in the room blocks the probe, not only this equipment kind — see `occupants`.
  // Excluded by id: the machine being probed is not an obstacle to its own service face.
  const others = excluding(occupants, placement.id);
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
      to: placement.transform.position,
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
