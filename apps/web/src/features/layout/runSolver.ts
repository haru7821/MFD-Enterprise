import { dialysisScoringModel } from '@mfd/ai-contract/scoring';
import type { PipelineInput, RankedLayout } from '@mfd/ai-local';
import { diffPlacements, optimiseLayout, rankLayouts } from '@mfd/ai-local';
import { dialysisKnowledge } from '@mfd/layout-knowledge/base';
import type { Level, Placement } from '@mfd/document-model';
import { obstructionBoundaries } from '@mfd/document-model';
import type { Catalog, EquipmentObject } from '@mfd/object-library';
import type { RuleSet } from '@mfd/rule-engine';

import type { LayoutEmptyReason, LayoutProposal, LayoutProposalSet } from '@/editor/editorState';

/**
 * The editor's two calls into the solver.
 *
 * Everything the solver needs is assembled here, from the document — so the panel is a form and a
 * table, and this file is the only place that knows the solver's shape. If the request ever needs
 * a new field, exactly one call site changes.
 *
 * ## No LLM, and no network
 *
 * `@mfd/ai-local` is pure TypeScript that runs in the browser. There is no fetch here, no model, no
 * key, and nothing to configure — the owner's *"do not add LLM dependency, keep solver
 * deterministic"* is satisfied by the import list rather than by a policy.
 *
 * ## Synchronous, and why that is a decision rather than an oversight
 *
 * The solver runs in the click handler. At the design target — a ward of fifty stations, three
 * strategies — it completes in roughly a quarter of a second (`performance.test.ts` measures it),
 * and a promise would buy nothing except a loading state that flickers. If a real project ever
 * makes it slow, the fix is a worker, and the seam for that is these two signatures.
 */

export interface SolverRequest {
  readonly level: Level;
  readonly spaceId: string | null;
  readonly object: EquipmentObject;
  readonly catalog: Catalog;
  readonly ruleSet: RuleSet;
  /** Null means "as many as fit", which the solver resolves and reports. */
  readonly stationCount: number | null;
}

export interface OptimiseRequest {
  readonly level: Level;
  readonly spaceId: string | null;
  readonly object: EquipmentObject;
  readonly catalog: Catalog;
  readonly ruleSet: RuleSet;
  /**
   * The engineer's explicit permission for machines already on the drawing to move.
   *
   * > Owner decision, Step 6B: *"Existing placements are immutable unless the engineer explicitly
   * > allows movement."*
   *
   * Passed straight through to the solver, which refuses without it. The checkbox in the panel is
   * a way of setting this, not the thing that enforces it.
   */
  readonly allowMovingExisting: boolean;
}

export function runSolver(request: SolverRequest): LayoutProposalSet {
  const room = roomOf(request.level, request.spaceId);

  if (!room) {
    return empty(request, 'generate', 'no_room_selected');
  }

  const result = rankLayouts({
    ...pipelineInput(request, room.vertices),
    /*
     * Machines already on this level stay put and are obstructions to the new ones. An engineer
     * filling a second bay does not expect the first bay to be rearranged — and `runOptimiser` is
     * the feature for that, with its own explicit permission.
     */
    existing: request.level.placements,
    stationTarget: request.stationCount,
    scoring: dialysisScoringModel,
  });

  if (result.layouts.length === 0) {
    /*
     * Two different answers, and telling them apart is the difference between a useful message and
     * a shrug. Nothing generated at all means the room cannot hold the count; candidates generated
     * and then rejected means the count fits geometrically and breaks a rule.
     */
    const reason: LayoutEmptyReason =
      result.rejected.length > 0 ? 'no_position_satisfies_rules' : 'room_too_small';
    return {
      ...empty(request, 'generate', reason),
      resolvedCount: result.resolvedStationCount,
    };
  }

  return {
    operation: 'generate',
    spaceId: request.spaceId ?? '',
    equipmentObjectId: request.object.id,
    requestedCount: request.stationCount,
    resolvedCount: result.resolvedStationCount,
    countWasDerived: result.countWasDerived,
    emptyReason: null,
    currentScore: null,
    blocking: [],
    /*
     * `[]` and not the level's placements: a generation adds machines, it does not move any. Diffed
     * against what is already there, every new machine would be reported as the nearest existing
     * one having *moved* — and the ghost layer would draw arrows for edits the approval will not
     * make.
     */
    proposals: result.layouts.map((layout) => proposalOf(layout, [])),
  };
}

/**
 * Improve the arrangement the engineer drew.
 *
 * The count is whatever is already in the room — read off the drawing rather than off the form,
 * because the requested count is a request and this is a fact. Nothing is added, nothing is
 * removed; the solver produces a permutation or it says it has nothing to offer.
 */
export function runOptimiser(request: OptimiseRequest): LayoutProposalSet {
  const room = roomOf(request.level, request.spaceId);

  if (!room) {
    return emptyOptimisation(request, 'no_room_selected', 0);
  }

  /*
   * Only the machines of the equipment kind being optimised, and only inside the selected room.
   *
   * A ward with twelve dialysis stations and one nurse station is not a thirteen-station
   * optimisation problem: the solver arranges one catalogue object at a time, and handing it a
   * mixed list would make it propose thirteen dialysis machines and delete the nurse station in
   * everything but name.
   */
  const current = request.level.placements.filter(
    (placement) =>
      placement.equipmentObjectId === request.object.id &&
      withinRoom(placement, room.vertices, request.catalog),
  );

  if (current.length === 0) {
    return emptyOptimisation(request, 'nothing_to_optimise', 0);
  }

  const result = optimiseLayout({
    ...pipelineInput(request, room.vertices),
    // Machines of *other* kinds stay exactly where they are, and are obstructions to this
    // rearrangement — the same treatment a column gets.
    existing: request.level.placements.filter((placement) => !current.includes(placement)),
    current,
    allowMovingExisting: request.allowMovingExisting,
    scoring: dialysisScoringModel,
  });

  if (result.outcome !== 'improved') {
    return {
      ...emptyOptimisation(request, OPTIMISATION_REASONS[result.outcome], result.stationCount),
      /*
       * Null when the outcome is `blocked`, and the solver is what makes it null — Owner decision
       * D1, *"no baseline comparison"*. Passed through rather than blanked here, so there is one
       * place that decides whether a score exists and not two that can disagree.
       */
      currentScore: result.current,
      blocking: result.blocking.map((violation) => ({
        ruleId: violation.detail.ruleId ?? '',
        reasonCode: violation.detail.reasonCode ?? '',
      })),
    };
  }

  return {
    operation: 'optimise',
    spaceId: request.spaceId ?? '',
    equipmentObjectId: request.object.id,
    // Not requested: read off the drawing, and immutable by the owner's first Step 5 constraint.
    requestedCount: result.stationCount,
    resolvedCount: result.stationCount,
    countWasDerived: false,
    emptyReason: null,
    currentScore: result.current,
    blocking: [],
    proposals: result.proposals.map((proposal) => ({
      id: proposal.candidateId,
      rank: proposal.rank,
      placements: proposal.placements,
      score: proposal.score,
      compliance: proposal.compliance,
      explanation: proposal.explanation,
      diff: diffPlacements(current, proposal.placements),
    })),
  };
}

/**
 * Why an optimisation produced nothing, in the panel's vocabulary.
 *
 * A `Record` over the solver's outcomes rather than a chain of ifs, so a new outcome fails to
 * compile until somebody decides what an engineer should be told about it. `improved` is absent
 * because it is not an empty result — the caller has already returned by then.
 */
const OPTIMISATION_REASONS = {
  already_best: 'already_best',
  no_feasible_candidate: 'no_feasible_arrangement',
  not_optimisable: 'nothing_to_optimise',
  movement_not_permitted: 'movement_not_permitted',
  blocked: 'current_layout_blocked',
} as const satisfies Record<string, LayoutEmptyReason>;

/** The fields both operations assemble the same way. */
function pipelineInput(
  request: SolverRequest | OptimiseRequest,
  room: PipelineInput['room'],
): Omit<PipelineInput, 'existing' | 'stationTarget'> {
  return {
    room,
    obstructions: obstructionBoundaries(request.level).map((boundary) => boundary.vertices),
    boundaries: request.level.boundaries,
    object: request.object,
    catalog: request.catalog,
    ruleSet: request.ruleSet,
    planStatus: planStatusOf(request.level),
    pitchPadding: pitchPaddingFor(request.object),
    /*
     * Observed practice, from `knowledge/` — Owner decision, layout-knowledge. The shipped base is
     * empty until drawings are observed, so criteria that would have used a figure written into the
     * solver report `SC-905` instead. The editor passes the real base rather than a stand-in: a
     * default assembled here would be the embedded assumption moved one file further out.
     */
    knowledge: dialysisKnowledge,
    referencePoints: request.level.referencePoints.map((point) => ({
      id: point.id,
      kind: point.kind,
      position: point.position,
    })),
  };
}

function proposalOf(layout: RankedLayout, current: readonly Placement[]): LayoutProposal {
  return {
    id: layout.candidateId,
    rank: layout.rank,
    placements: layout.placements,
    score: layout.score,
    compliance: layout.compliance,
    explanation: layout.explanation,
    diff: diffPlacements(current, layout.placements),
  };
}

function empty(
  request: SolverRequest,
  operation: 'generate',
  reason: LayoutEmptyReason,
): LayoutProposalSet {
  return {
    operation,
    spaceId: request.spaceId ?? '',
    equipmentObjectId: request.object.id,
    requestedCount: request.stationCount,
    resolvedCount: request.stationCount ?? 0,
    countWasDerived: request.stationCount === null,
    proposals: [],
    emptyReason: reason,
    currentScore: null,
    blocking: [],
  };
}

function emptyOptimisation(
  request: OptimiseRequest,
  reason: LayoutEmptyReason,
  stationCount: number,
): LayoutProposalSet {
  return {
    operation: 'optimise',
    spaceId: request.spaceId ?? '',
    equipmentObjectId: request.object.id,
    requestedCount: stationCount,
    resolvedCount: stationCount,
    countWasDerived: false,
    proposals: [],
    emptyReason: reason,
    currentScore: null,
    blocking: [],
  };
}

/** The selected room's outline, or null when nothing usable is selected. */
function roomOf(level: Level, spaceId: string | null) {
  if (spaceId === null) return null;
  const space = level.spaces.find((entry) => entry.id === spaceId);
  if (!space) return null;
  return level.boundaries.find((boundary) => boundary.id === space.boundaryId) ?? null;
}

/**
 * Is this machine standing in the selected room?
 *
 * Centre-based, which is the loose test — a machine half in the doorway counts as inside. That is
 * the right direction to be wrong in here: including a borderline machine puts it in the
 * rearrangement, where the gates then judge its proposed position properly. Excluding it would
 * leave it as an obstruction the optimiser works around, which is a decision the engineer did not
 * make.
 */
function withinRoom(placement: Placement, room: PipelineInput['room'], catalog: Catalog): boolean {
  if (!catalog.get(placement.equipmentObjectId)) return false;
  const { x, y } = placement.transform.position;

  let inside = false;
  for (let i = 0, j = room.length - 1; i < room.length; j = i, i += 1) {
    const a = room[i];
    const b = room[j];
    if (!a || !b) continue;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function planStatusOf(level: Level): 'none' | 'calibrated' | 'uncalibrated' {
  if (level.planImage === null) return 'none';
  return level.coordinateMapping === null ? 'uncalibrated' : 'calibrated';
}

/**
 * How much space to leave between machines, beyond the footprint itself.
 *
 * The **larger of the front and rear** service clearances: a row of machines shares the gap between
 * them, so the binding figure is whichever face needs more. Falls back to zero when the catalogue
 * declares none — an unknown clearance is not a zero clearance, but the *generator* only proposes
 * positions the rule engine then judges, and padding a grid by a number nobody supplied would be
 * inventing one.
 */
/**
 * How much space to leave between machines when generating candidate layouts.
 *
 * Two sources, in a strict order, and the order is the architecture:
 *
 * 1. **The equipment record's service clearance.** A requirement — what the machine needs. Null on
 *    every record today (A-1), which is why the second source matters.
 * 2. **Observed station pitch from real drawings.** Not a requirement: what 117 hospitals actually
 *    did. Used only as a *starting* spacing for candidate generation, never as a threshold — the
 *    rule engine still judges every candidate, and a layout that violates a clearance is rejected
 *    by Gate 2 whatever spacing produced it (AD-17).
 *
 * A requirement always wins where one exists. Observed practice fills the silence, and it is
 * exactly the advisory use the knowledge layer was built for: it changes which layouts get
 * *proposed*, and nothing about which are *acceptable*.
 *
 * The padding is the pitch minus the footprint, because pitch is centre-to-centre and the generator
 * spaces on top of the footprint. Clamped at zero: an observed pitch narrower than the planning
 * footprint means those hospitals used a smaller machine, not that ours should overlap.
 */
function pitchPaddingFor(object: EquipmentObject): number {
  const { front, rear } = object.serviceClearance;
  const required = Math.max(front ?? 0, rear ?? 0);
  if (required > 0) return required;

  const observed = dialysisKnowledge.dimension('station_pitch');
  if (!observed?.isPattern) return 0;

  return Math.max(0, observed.medianMm - object.planningFootprint.width);
}
