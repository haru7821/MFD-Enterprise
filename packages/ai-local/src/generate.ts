import type { PlacementSummary, ReferencePointSummary } from '@mfd/ai-contract';
import type { Vec2 } from '@mfd/cad-engine';
import type { Boundary, Placement } from '@mfd/document-model';
import type { Catalog, EquipmentObject } from '@mfd/object-library';
import type { RuleSet } from '@mfd/rule-engine';

import { type Candidate, generateCandidates } from './candidates';
import { type GateOutcome, type Rejection, applyGates } from './gates';

/**
 * The candidate pipeline, in the owner's approved order.
 *
 * ```
 *   input requirements
 *          ↓
 *   generation            ── arrangements holding exactly the resolved count
 *          ↓
 *   Gate 1 · station count ── exact. Never adds, never removes.
 *          ↓
 *   Gate 2 · rule compliance ── any mandatory violation is discarded
 *          ↓
 *   feasible candidates   ── the only thing the scoring engine ever sees
 * ```
 *
 * Step 3 ends at the third box. Scoring and ranking are step 4, and the seam between them is
 * deliberate: **the scoring engine is never handed a candidate that failed a gate.** Not "handed
 * one and told to score it zero" — never handed one. That is the structural form of *"rule
 * violations shall never be compensated by optimization scores"*, and it is a property of the data
 * flow rather than of a number.
 */

export interface PipelineInput {
  readonly room: readonly Vec2[];
  readonly obstructions: readonly (readonly Vec2[])[];
  readonly boundaries: readonly Boundary[];
  readonly object: EquipmentObject;
  readonly catalog: Catalog;
  readonly ruleSet: RuleSet;
  readonly planStatus: 'none' | 'calibrated' | 'uncalibrated';
  /**
   * The engineer's requested station count, or **null for "as many as fit"**.
   *
   * Null is resolved to a number *before* Gate 1 runs, and the resolution is reported. "Exactly
   * the requested number" is not a statement that can be made about null, and an engineer who
   * asked for as many as fit is owed the answer to how many that turned out to be.
   */
  readonly stationTarget: number | null;
  /** Extra spacing beyond the design footprint, from the equipment's own service clearance. */
  readonly pitchPadding: number;
  /** Existing placements that stay put — an optimisation works around them. */
  readonly existing: readonly Placement[];
  /**
   * Points the scoring criteria measure from. Empty is legitimate; four weighted criteria then
   * report `unavailable` rather than a distance from an assumed origin.
   *
   * Carried on the *pipeline* input rather than only on the scoring input because the two travel
   * together everywhere, and splitting them would let a caller score a layout against a different
   * set of points than the one it was generated for.
   */
  readonly referencePoints: readonly ReferencePointSummary[];
}

export interface FeasibleCandidate {
  readonly candidate: Candidate;
  readonly placements: readonly Placement[];
  readonly summaries: readonly PlacementSummary[];
  /** What survived the gate: how much of this candidate's compliance is actually established. */
  readonly gates: GateOutcome;
}

export interface RejectedCandidate {
  readonly candidateId: string;
  readonly rejection: Rejection;
}

export interface PipelineResult {
  /** The count Gate 1 enforced — the engineer's number, or what "as many as fit" resolved to. */
  readonly resolvedStationCount: number;
  /** True when the count above was derived rather than requested. */
  readonly countWasDerived: boolean;
  readonly feasible: readonly FeasibleCandidate[];
  /**
   * Everything discarded, with why.
   *
   * Kept rather than dropped because *"no layout satisfies the rules"* is only a useful answer if
   * it can say which constraint was binding. A pipeline that returned an empty array and nothing
   * else would leave an engineer with a room and no idea what to change.
   */
  readonly rejected: readonly RejectedCandidate[];
}

/**
 * Generate, gate, and report what survived.
 *
 * Deterministic: the same inputs produce the same candidates, in the same order, with the same
 * ids. Nothing here reads a clock, a random source, or an unordered collection.
 */
export function generateFeasibleCandidates(input: PipelineInput): PipelineResult {
  if (input.stationTarget !== null) {
    return gateAt(input, input.stationTarget, false);
  }

  /*
   * "As many as fit" means as many as fit **and pass the gates**, and the difference is not
   * academic.
   *
   * An earlier version resolved the count by asking the generator alone: walk down until an
   * arrangement of that size exists, then gate it. On a real room that resolved to the densest
   * packing the geometry allows — and every candidate at that density then failed Gate 2, so the
   * engineer got "no layout satisfies the rules" for a request that had a perfectly good answer two
   * machines down. Found by a browser spec; the unit fixtures used rooms where the two counts
   * happened to coincide.
   *
   * So the walk runs the whole pipeline at each count and stops at the first that survives. It is
   * more work — the gates run once per count tried — and it is the only version that answers the
   * question actually asked.
   */
  const ceiling = maximumSlots(input);
  for (let count = ceiling; count > 0; count -= 1) {
    const attempt = gateAt(input, count, true);
    if (attempt.feasible.length > 0) return attempt;
  }

  return { resolvedStationCount: 0, countWasDerived: true, feasible: [], rejected: [] };
}

/** Generate at one count and put every candidate through both gates. */
function gateAt(input: PipelineInput, count: number, derived: boolean): PipelineResult {
  if (count <= 0) {
    return { resolvedStationCount: 0, countWasDerived: derived, feasible: [], rejected: [] };
  }

  const candidates = generateCandidates({
    room: input.room,
    /*
     * Existing machines are obstructions to the new ones.
     *
     * The generator used to see only `input.obstructions`, so it happily proposed a slot a machine
     * was already standing in — and Gate 2 then rejected the whole candidate for the collision.
     * With an existing machine on the first slot that rejected *every* candidate at *every* count,
     * and the engineer was told no layout satisfied the rules when the truth was that the solver
     * kept suggesting the one square it could not use.
     *
     * Gate 2 still catches an overlap; this stops the generator manufacturing them.
     */
    obstructions: [...input.obstructions, ...occupiedPolygons(input)],
    object: input.object,
    stationCount: count,
    pitchPadding: input.pitchPadding,
  });

  const feasible: FeasibleCandidate[] = [];
  const rejected: RejectedCandidate[] = [];

  for (const candidate of candidates) {
    const placements = placementsFor(candidate, input);
    const all = [...input.existing, ...placements];

    const gates = applyGates(
      {
        placements: all,
        catalog: input.catalog,
        ruleSet: input.ruleSet,
        boundaries: input.boundaries,
        planStatus: input.planStatus,
      },
      candidate.positions.length,
      count,
    );

    if (gates.rejection) {
      rejected.push({ candidateId: candidate.id, rejection: gates.rejection });
      continue;
    }

    feasible.push({
      candidate,
      placements,
      summaries: placements.map((placement) => ({
        placementId: placement.id,
        equipmentObjectId: placement.equipmentObjectId,
        position: placement.transform.position,
        rotation: placement.transform.rotation,
        spaceId: placement.spaceId,
      })),
      gates,
    });
  }

  return { resolvedStationCount: count, countWasDerived: derived, feasible, rejected };
}

/**
 * How many slots the densest strategy offers.
 *
 * Asking the generator for one station and reading how many usable slots it found would be
 * cleaner, but the generator returns arrangements rather than slots. This upper bound is cheap and
 * only has to be *not too small*: the loop above walks down from it.
 */
function maximumSlots(input: PipelineInput): number {
  const probe = generateCandidates({
    room: input.room,
    obstructions: [...input.obstructions, ...occupiedPolygons(input)],
    object: input.object,
    stationCount: 1,
    pitchPadding: input.pitchPadding,
  });
  if (probe.length === 0) return 0;

  const footprint = input.object.designFootprint;
  const width = Math.max(...input.room.map((p) => p.x)) - Math.min(...input.room.map((p) => p.x));
  const depth = Math.max(...input.room.map((p) => p.y)) - Math.min(...input.room.map((p) => p.y));
  const columns = Math.floor(width / (footprint.width + input.pitchPadding));
  const rows = Math.floor(depth / (footprint.depth + input.pitchPadding));
  return Math.max(0, columns * rows);
}

/** The footprints of machines already placed, as polygons the generator can avoid. */
function occupiedPolygons(input: PipelineInput): Vec2[][] {
  return input.existing.flatMap((placement) => {
    const object = input.catalog.get(placement.equipmentObjectId);
    if (!object) return [];
    const half = {
      x: object.designFootprint.width / 2,
      y: object.designFootprint.depth / 2,
    };
    const { x, y } = placement.transform.position;
    return [
      [
        { x: x - half.x, y: y - half.y },
        { x: x + half.x, y: y - half.y },
        { x: x + half.x, y: y + half.y },
        { x: x - half.x, y: y + half.y },
      ],
    ];
  });
}

function placementsFor(candidate: Candidate, input: PipelineInput): Placement[] {
  return candidate.positions.map((position, index) => ({
    id: `${candidate.id}-${index + 1}`,
    equipmentObjectId: input.object.id,
    equipmentObjectVersion: input.object.version,
    label: `${input.object.model} ${index + 1}`,
    transform: { position, rotation: candidate.rotation, mirrored: false },
    spaceId: null,
  }));
}
