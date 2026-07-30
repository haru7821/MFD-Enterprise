import { dialysisScoringModel } from '@mfd/ai-contract/scoring';
import { rankLayouts } from '@mfd/ai-local';
import type { Level } from '@mfd/document-model';
import { obstructionBoundaries } from '@mfd/document-model';
import type { Catalog, EquipmentObject } from '@mfd/object-library';
import type { RuleSet } from '@mfd/rule-engine';

import type { LayoutEmptyReason, LayoutProposalSet } from '@/editor/editorState';

/**
 * The editor's one call into the solver.
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
 * The solver runs in the click handler. At the sizes this product deals with — a ward, a dozen
 * machines, three strategies — it completes well inside a frame, and a promise would buy nothing
 * except a loading state that flickers. If a real project ever makes it slow, the fix is a worker,
 * and the seam for that is this function's signature.
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

export function runSolver(request: SolverRequest): LayoutProposalSet {
  const room = roomOf(request.level, request.spaceId);

  if (!room) {
    return empty(request, 'no_room_selected');
  }

  const result = rankLayouts({
    room: room.vertices,
    obstructions: obstructionBoundaries(request.level).map((boundary) => boundary.vertices),
    boundaries: request.level.boundaries,
    object: request.object,
    catalog: request.catalog,
    ruleSet: request.ruleSet,
    planStatus: planStatusOf(request.level),
    stationTarget: request.stationCount,
    pitchPadding: pitchPaddingFor(request.object),
    /*
     * Machines already on this level stay put and are obstructions to the new ones. An engineer
     * filling a second bay does not expect the first bay to be rearranged — and Sprint 6's
     * optimiser is the feature for that, with its own explicit approval.
     */
    existing: request.level.placements,
    referencePoints: request.level.referencePoints.map((point) => ({
      id: point.id,
      kind: point.kind,
      position: point.position,
    })),
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
    return { ...empty(request, reason), resolvedCount: result.resolvedStationCount };
  }

  return {
    spaceId: request.spaceId ?? '',
    equipmentObjectId: request.object.id,
    requestedCount: request.stationCount,
    resolvedCount: result.resolvedStationCount,
    countWasDerived: result.countWasDerived,
    emptyReason: null,
    proposals: result.layouts.map((layout) => ({
      id: layout.candidateId,
      rank: layout.rank,
      placements: layout.placements,
      score: layout.score,
      explanation: layout.explanation.map((item) => ({ code: item.code, params: item.params })),
    })),
  };
}

function empty(request: SolverRequest, reason: LayoutEmptyReason): LayoutProposalSet {
  return {
    spaceId: request.spaceId ?? '',
    equipmentObjectId: request.object.id,
    requestedCount: request.stationCount,
    resolvedCount: request.stationCount ?? 0,
    countWasDerived: request.stationCount === null,
    proposals: [],
    emptyReason: reason,
  };
}

/** The selected room's outline, or null when nothing usable is selected. */
function roomOf(level: Level, spaceId: string | null) {
  if (spaceId === null) return null;
  const space = level.spaces.find((entry) => entry.id === spaceId);
  if (!space) return null;
  return level.boundaries.find((boundary) => boundary.id === space.boundaryId) ?? null;
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
function pitchPaddingFor(object: EquipmentObject): number {
  const { front, rear } = object.serviceClearance;
  return Math.max(front ?? 0, rear ?? 0);
}
