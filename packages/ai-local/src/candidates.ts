import type { Rect, Vec2 } from '@mfd/cad-engine';
import { polygonArea, polygonBounds, polygonContains } from '@mfd/cad-engine';
import type { EquipmentObject } from '@mfd/object-library';

/**
 * Candidate generation.
 *
 * ## Determinism is a requirement, not a property that happened
 *
 * > Owner decision, Step 3: *"The solver must remain deterministic. Given identical input data,
 * > identical candidates and rankings must be produced."*
 *
 * Three things are therefore forbidden in this file and everything it calls, and each is a way
 * determinism is normally lost without anyone noticing:
 *
 * 1. **`Math.random`.** Obvious, and the least likely of the three.
 * 2. **Iterating a `Set` or a `Map` built from unordered input.** Insertion order is stable in
 *    JavaScript, so this is *usually* fine — which is exactly what makes it dangerous. It breaks
 *    the day the input order changes for an unrelated reason.
 * 3. **An unstable sort key.** `Array.prototype.sort` is stable in modern engines, but two
 *    candidates with an equal score still need a **total** order or the ranking depends on
 *    generation order. Every comparator here ends in a tie-break on the candidate's id.
 *
 * The third is the one that bites. A solver that returns the same three layouts in a different
 * order on a second run has failed the owner's requirement just as completely as one that returns
 * different layouts, and it is far easier to ship.
 *
 * ## The generation strategy, and why it is a grid rather than a search
 *
 * Rows against the room's long axis, on a fixed pitch derived from the machine's design footprint
 * and the clearance it needs. It is not clever, and that is deliberate: the *scoring* is where the
 * engineering judgement lives, and the generator's job is to produce a broad, reproducible spread
 * of legal-looking arrangements for the gates and the scoring engine to sort out.
 *
 * A cleverer generator that pruned early would be faster and would couple generation to the
 * criteria — so changing a weight would change which candidates exist, not merely how they rank.
 * That is a worse property than being slow.
 */

/** A generated arrangement, before either gate has looked at it. */
export interface Candidate {
  /**
   * Stable and derived from the arrangement itself, not from a counter.
   *
   * So the same room produces the same ids on a second run, and an id survives being filtered:
   * a candidate rejected by a gate can be named in an explanation without the surviving ones
   * renumbering around the gap.
   */
  readonly id: string;
  /**
   * Each station's footprint **centre** — not a `Placement`'s `transform.position`.
   *
   * > Architecture decision AD-21: `transform.position` is where an object's local `(0, 0)` sits,
   * > and every shipped, `front-left` record has that at the footprint's corner, not its centre.
   *
   * The packing math above is naturally centre-based — "a rectangle here" is simpler to reason
   * about than a corner offset by half a footprint and then rotated about the wrong point — and
   * there is nothing wrong with that as this file's own internal representation. What would be
   * wrong is a caller assigning one of these straight to `transform.position`, which is exactly
   * what `generate.ts` used to do. `transformForCentre` (`@mfd/object-library`) is the one
   * conversion from a centre here to a real placement; see `generate.ts`'s `placementsFor`.
   */
  readonly positions: readonly Vec2[];
  /** Millidegrees, as everywhere in the document. One rotation for the whole arrangement. */
  readonly rotation: number;
  /** How this arrangement was produced, for the engineering explanation. */
  readonly strategy: CandidateStrategy;
}

export const CANDIDATE_STRATEGIES = ['rows', 'columns', 'perimeter'] as const;
export type CandidateStrategy = (typeof CANDIDATE_STRATEGIES)[number];

export interface GenerateInput {
  /** The room, as model-millimetre geometry. */
  readonly room: readonly Vec2[];
  readonly obstructions: readonly (readonly Vec2[])[];
  readonly object: EquipmentObject;
  /**
   * How many stations every candidate must hold — Gate 1's number.
   *
   * The generator is *told* the count rather than deciding it. A generator that produced
   * arrangements of varying size and left Gate 1 to discard the wrong ones would do most of its
   * work to have it thrown away, and would make "as many as fit" a property of the generator
   * rather than an explicit resolution the caller can show an engineer.
   */
  readonly stationCount: number;
  /** Extra spacing beyond the footprint, in millimetres. From the equipment's own clearance. */
  readonly pitchPadding: number;
}

/**
 * Every arrangement worth evaluating, in a fixed order.
 *
 * Returns an empty array when the room cannot hold the requested count under any strategy — which
 * is a real engineering answer and is reported as one, not padded with near-misses.
 */
export function generateCandidates(input: GenerateInput): Candidate[] {
  const bounds = input.room.length >= 3 ? polygonBounds([...input.room]) : null;
  if (!bounds) return [];

  const footprint = footprintOf(input.object);
  const pitchX = footprint.width + input.pitchPadding;
  const pitchY = footprint.depth + input.pitchPadding;
  if (pitchX <= 0 || pitchY <= 0) return [];

  const candidates: Candidate[] = [];

  for (const strategy of CANDIDATE_STRATEGIES) {
    const slots = slotsFor(strategy, bounds, pitchX, pitchY);
    const usable = slots.filter(
      (slot) =>
        fitsInside(slot, footprint, input.room) &&
        input.obstructions.every((obstruction) => !overlapsPolygon(slot, footprint, obstruction)),
    );

    if (usable.length < input.stationCount) continue;

    // Exactly the requested count, taken in slot order. Taking a *prefix* rather than every
    // combination is a deliberate bound: choosing 12 of 40 slots is 5,586,853,480 arrangements,
    // and the useful variety between them is captured by the three strategies rather than by
    // enumerating them.
    const positions = usable.slice(0, input.stationCount);
    candidates.push({
      id: `${strategy}-${input.stationCount}-${hashPositions(positions)}`,
      positions,
      rotation: 0,
      strategy,
    });
  }

  // A total order. `localeCompare` would depend on the runtime's locale data — the same code
  // producing a different ranking on a different machine is precisely what determinism forbids.
  return candidates.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The **design footprint**, never the manufacturer's dimensions.
 *
 * Phase 4.5's separation, and it matters here more than anywhere: the design footprint is the area
 * an engineer has decided a machine occupies in a plan, and it is what every engine measures.
 * Packing against the manufacturer's carcass dimensions would produce a layout that fits on paper
 * and not in a room.
 */
function footprintOf(object: EquipmentObject): { width: number; depth: number } {
  return { width: object.planningFootprint.width, depth: object.planningFootprint.depth };
}

function slotsFor(
  strategy: CandidateStrategy,
  bounds: Rect,
  pitchX: number,
  pitchY: number,
): Vec2[] {
  const slots: Vec2[] = [];

  const columns = Math.floor(bounds.width / pitchX);
  const rows = Math.floor(bounds.height / pitchY);
  if (columns <= 0 || rows <= 0) return slots;

  const at = (column: number, row: number): Vec2 => ({
    x: bounds.x + pitchX * (column + 0.5),
    y: bounds.y + pitchY * (row + 0.5),
  });

  if (strategy === 'rows') {
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) slots.push(at(column, row));
    }
    return slots;
  }

  if (strategy === 'columns') {
    for (let column = 0; column < columns; column += 1) {
      for (let row = 0; row < rows; row += 1) slots.push(at(column, row));
    }
    return slots;
  }

  // Perimeter: the ring first, then the interior. Machines against a wall leave the middle of a
  // room clear, which is what a bed route needs — the criteria decide whether that is worth it
  // here, and the generator's job is only to make the option available to be judged.
  for (let column = 0; column < columns; column += 1) slots.push(at(column, 0));
  for (let row = 1; row < rows; row += 1) slots.push(at(columns - 1, row));
  for (let column = columns - 2; column >= 0 && rows > 1; column -= 1) slots.push(at(column, rows - 1));
  for (let row = rows - 2; row >= 1 && columns > 1; row -= 1) slots.push(at(0, row));
  for (let row = 1; row < rows - 1; row += 1) {
    for (let column = 1; column < columns - 1; column += 1) slots.push(at(column, row));
  }
  return slots;
}

/** Every corner of the footprint inside the room. Corners, not the centre — a centre-only test
 *  passes a machine half outside a wall. */
function fitsInside(
  centre: Vec2,
  footprint: { width: number; depth: number },
  room: readonly Vec2[],
): boolean {
  return cornersOf(centre, footprint).every((corner) => polygonContains([...room], corner));
}

function overlapsPolygon(
  centre: Vec2,
  footprint: { width: number; depth: number },
  polygon: readonly Vec2[],
): boolean {
  if (polygon.length < 3) return false;
  // Corner-in-polygon and polygon-vertex-in-footprint together, because either test alone misses
  // the case where one shape's edges cross the other's without any vertex being contained.
  if (cornersOf(centre, footprint).some((corner) => polygonContains([...polygon], corner))) return true;

  const half = { x: footprint.width / 2, y: footprint.depth / 2 };
  return polygon.some(
    (vertex) =>
      Math.abs(vertex.x - centre.x) <= half.x && Math.abs(vertex.y - centre.y) <= half.y,
  );
}

function cornersOf(centre: Vec2, footprint: { width: number; depth: number }): Vec2[] {
  const halfWidth = footprint.width / 2;
  const halfDepth = footprint.depth / 2;
  return [
    { x: centre.x - halfWidth, y: centre.y - halfDepth },
    { x: centre.x + halfWidth, y: centre.y - halfDepth },
    { x: centre.x + halfWidth, y: centre.y + halfDepth },
    { x: centre.x - halfWidth, y: centre.y + halfDepth },
  ];
}

/**
 * A short, stable digest of an arrangement.
 *
 * Not a cryptographic hash and not trying to be — it distinguishes arrangements within one run and
 * reproduces across runs, which is all an id needs to do. Written out rather than pulled from a
 * library so that "the ids are deterministic" is checkable by reading twelve lines.
 */
function hashPositions(positions: readonly Vec2[]): string {
  let hash = 2_166_136_261;
  for (const position of positions) {
    for (const value of [Math.round(position.x), Math.round(position.y)]) {
      hash ^= value;
      // FNV-1a's prime, via shifts: Math.imul keeps this in 32-bit integer arithmetic, where
      // floating-point multiplication would lose the low bits that distinguish nearby layouts.
      hash = Math.imul(hash, 16_777_619);
    }
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

/** Usable floor area, for reporting how full a room is. Absolute, so vertex winding cannot flip it. */
export function roomArea(room: readonly Vec2[]): number {
  return Math.abs(polygonArea([...room]));
}
