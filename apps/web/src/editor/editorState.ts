import {
  type PlanTransform,
  type ScreenSize,
  type Vec2,
  type Viewport,
  createViewport,
} from '@mfd/cad-engine';
import type {
  InstallationPlan,
  RationaleCode,
  RationaleParams,
  ScoreBreakdown,
} from '@mfd/ai-contract';
import type { ComplianceSummary, PlacementDiffEntry } from '@mfd/ai-local';
import {
  type Boundary,
  type DocumentState,
  type Level,
  type MfdDocument,
  type ObstructionType,
  type Placement,
  type ReferencePointKind,
  type SpaceFunction,
  createDocument,
  createDocumentState,
  planTransformOf,
  requireLevel,
} from '@mfd/document-model';

import type { ToolId } from './tools';

/**
 * What the solver returned, and what it was asked.
 *
 * The request is kept beside the results so the panel can say *"three layouts for 12 stations in
 * Treatment Area A"* rather than showing scores detached from the question they answer — and so a
 * stale result set is recognisable when the room selection changes underneath it.
 *
 * ## One shape for both operations
 *
 * Generating a layout and optimising one produce the same thing to decide about: ranked
 * alternatives, each scored, each with a per-machine diff against what is on the drawing. They
 * differ in *what the diff contains* — all `added` for a generation, `moved` and `unchanged` for an
 * optimisation — and that difference is data rather than a second state shape.
 *
 * Two parallel shapes would have meant two preview paths, two apply paths and two ghost layers, and
 * the third of those to fall out of step would have been the one nobody was looking at.
 */
export interface LayoutProposalSet {
  readonly operation: LayoutOperation;
  readonly spaceId: string;
  readonly equipmentObjectId: string;
  readonly requestedCount: number | null;
  readonly resolvedCount: number;
  readonly countWasDerived: boolean;
  readonly proposals: readonly LayoutProposal[];
  /** Why nothing came back, when nothing did. An empty list is not self-explanatory. */
  readonly emptyReason: LayoutEmptyReason | null;
  /**
   * The drawing as it stands, scored on the same model. Null for a generation.
   *
   * Present so an optimisation's totals mean something: 0.68 is not an improvement on anything
   * until the number it improves on is on screen next to it.
   */
  readonly currentScore: ScoreBreakdown | null;
  /**
   * The mandatory rules the drawing breaks, when `emptyReason` is `current_layout_blocked`.
   *
   * Shown **before** anything else the panel has to say, and shown in full: they are the engineer's
   * work before the optimiser will speak to them again. Empty in every other case.
   */
  readonly blocking: readonly BlockingViolation[];
}

/** One mandatory rule the drawn layout breaks, as the solver reported it. */
export interface BlockingViolation {
  readonly ruleId: string;
  readonly reasonCode: string;
  /**
   * The machines it is about — one for a clearance, two for a collision.
   *
   * Without these the panel says a rule is broken and leaves an engineer to find *where* on a
   * drawing with ten machines on it, which is not a finding they can act on.
   */
  readonly placements: readonly BlockingPlacement[];
}

/**
 * A machine named by a blocking violation, and whether it is in the room being optimised.
 *
 * > Owner decision: **the whole level**, not the selected room. Everything on the drawing counts
 * > towards whether it is acceptable.
 *
 * Which means a machine the engineer did not select — one in the next room, or one whose centre
 * falls outside the outline they clicked — can block the run. That is the decision working as
 * intended and it is baffling without this flag: the panel would name a machine that is not in the
 * room the engineer is looking at, with no hint of why it is being mentioned.
 *
 * Resolved where the partition is made rather than at render time, because the partition is what
 * decides it. `runSolver` already computes exactly this to split `current` from `existing`, and a
 * second answer worked out in the panel would be free to disagree with the first.
 */
export interface BlockingPlacement {
  readonly id: string;
  /** The label the engineer typed, or the id when the placement has none. */
  readonly label: string;
  readonly inSelectedRoom: boolean;
  /**
   * The room it is actually in, when it is not in the selected one. Null when it is in no room.
   *
   * > Owner decision: name the room, rather than only saying the machine is elsewhere.
   *
   * "Not in this room" is true and leaves an engineer to search a level by label; a level has no
   * bound on how many rooms it holds. A name is the smallest thing that makes the row somewhere to
   * go. Null is kept distinct from a name rather than rendered as one: a machine standing in
   * circulation, in no room at all, is a different fact from a machine in the room next door, and
   * it is also the more common way for a drawing to end up blocked.
   */
  readonly roomName: string | null;
}

/**
 * Why a plan could not be produced.
 *
 * > Owner decision, Sprint 6 § 1: *"AI Planner receives only validated layouts. Never plan directly
 * > from raw user drawings."*
 *
 * The contract holds that with a required field, so these are the cases the *editor* has to catch
 * before it can even build the input — an empty drawing has nothing to install, and a layout the
 * engineer has not approved is not the thing they mean to plan.
 */
export const PLANNING_REFUSALS = ['nothing_placed', 'proposals_pending'] as const;
export type PlanningRefusal = (typeof PLANNING_REFUSALS)[number];

/** Generating a layout from nothing, or improving the one the engineer drew. */
export const LAYOUT_OPERATIONS = ['generate', 'optimise'] as const;
export type LayoutOperation = (typeof LAYOUT_OPERATIONS)[number];

export const LAYOUT_EMPTY_REASONS = [
  'no_room_selected',
  'no_position_satisfies_rules',
  'room_too_small',
  /** Optimisation, asked of a room with nothing in it. */
  'nothing_to_optimise',
  /** Optimisation, without the engineer's opt-in to move what is already placed. */
  'movement_not_permitted',
  /** Optimisation found nothing better — a real answer, and not the same as finding nothing. */
  'already_best',
  /** Optimisation could not construct any compliant arrangement at the count already placed. */
  'no_feasible_arrangement',
  /**
   * The layout on the drawing breaks a mandatory rule, so there is nothing to optimise *from*.
   *
   * > Owner decision, D1: *"Optimisation is available only after the current layout satisfies all
   * > mandatory gates."*
   */
  'current_layout_blocked',
] as const;
export type LayoutEmptyReason = (typeof LAYOUT_EMPTY_REASONS)[number];

export interface LayoutProposal {
  readonly id: string;
  readonly rank: number;
  readonly placements: readonly Placement[];
  readonly score: ScoreBreakdown;
  /** What the rule engine established, separately from what the model scored. */
  readonly compliance: ComplianceSummary;
  /** Why it ranks where it does, in codes the panel renders in both languages. */
  readonly explanation: readonly { readonly code: RationaleCode; readonly params: RationaleParams }[];
  /**
   * Per machine: added, moved, or unchanged — and which existing machine each one is.
   *
   * Both the highlight *and* the edit come from here, which is the point. Approving a proposal
   * applies exactly the changes the canvas drew, because there is one list rather than a rendering
   * of one thing and an application of another.
   */
  readonly diff: readonly PlacementDiffEntry[];
}

/**
 * The editor's entire state.
 *
 * One plain object behind a reducer. Sprint 4 is where that choice pays: the document
 * and its undo history are a field on this object, so undo is the same mechanism as
 * every other state change rather than a parallel system bolted alongside one.
 *
 * ## What is document and what is not
 *
 * The document is what gets saved: rooms, machines, the plan and its calibration.
 * Everything else here — the viewport, the active tool, what is selected, a half-drawn
 * room — is *session* state, deliberately outside the document. None of it should
 * survive a save, appear in a report, or show up as a change when two engineers
 * compare projects.
 */

/**
 * The transform used to draw a plan that has not been calibrated yet.
 *
 * One pixel to one millimetre, origin at the top left. This is not a guess at the
 * drawing's real scale — it is the only way to get the image on screen so the engineer
 * can pick two points on it. The rule engine is told the plan is uncalibrated, so
 * nothing measured against it can reach GREEN.
 */
export const PROVISIONAL_PLAN_TRANSFORM: PlanTransform = {
  millimetresPerPixel: 1,
  origin: { x: 0, y: 0 },
  rotation: 0,
};

/**
 * A modal pick in progress on the plan.
 *
 * One field rather than a boolean each, because the two are mutually exclusive and a
 * pair of booleans would eventually be true at the same time. Both take precedence over
 * every tool: an engineer who deliberately started picking should not have a stray click
 * place a machine instead.
 */
export type PlanPick =
  /** Two points on a known distance, for the scale. Held in image pixels. */
  | { readonly kind: 'calibrate'; readonly points: readonly Vec2[] }
  /** One point, to become model (0, 0). */
  | { readonly kind: 'origin' };

/** A vertex of a boundary, while it is being edited. */
export interface VertexRef {
  readonly boundaryId: string;
  readonly index: number;
}

export interface EditorState {
  /** How model space maps to the screen. The canvas reads this; it never owns it. */
  readonly viewport: Viewport;
  /** Current size of the drawing surface, in CSS pixels. */
  readonly screen: ScreenSize;
  readonly activeTool: ToolId;
  readonly showGrid: boolean;
  readonly snapToGrid: boolean;
  readonly showPlan: boolean;
  /**
   * Pointer position in screen pixels, or null when the pointer is off the canvas.
   *
   * Screen space, not millimetres, on purpose: the pointer is a screen fact, and the
   * model position under it is derived through the viewport. Caching the derived value
   * would leave it stale whenever the view moves without the pointer moving — which is
   * exactly what a wheel pan does.
   */
  readonly cursorScreen: Vec2 | null;
  /** True while a pan drag is in progress — drives the cursor style. */
  readonly isPanning: boolean;

  /** The project and its undo history. */
  readonly doc: DocumentState;
  readonly activeLevelId: string;

  /** Catalogue id armed for placement by the equipment tool. */
  readonly armedEquipmentObjectId: string | null;
  /**
   * Which kind of reference point the next canvas click places.
   *
   * Armed rather than defaulted: a tool that placed a `drain` because that happened to be first
   * in the list would put a point of the wrong kind on a drawing, and the kind is what four
   * scoring criteria select on.
   */
  readonly armedReferencePointKind: ReferencePointKind | null;
  readonly selectedReferencePointId: string | null;

  /**
   * Layout proposals awaiting the engineer's decision.
   *
   * **Not applied to the document.** They live here, beside it, until somebody approves one — the
   * owner's fourth requirement, and the reason a proposal is state rather than an edit. A solver
   * that wrote to the document and offered an undo would have already changed the drawing.
   */
  readonly layoutProposals: LayoutProposalSet | null;
  /** Which proposal is being previewed. Null means the current layout is shown as it is. */
  readonly previewedProposalId: string | null;
  /**
   * The installation plan, once an engineer has asked for one.
   *
   * **Session state, not document state**, and deliberately: a plan is derived from a layout *and*
   * from the evaluation of that layout, so a plan saved into the project would be stale the moment
   * somebody nudged a machine — and it would be stale invisibly, inside a file somebody later
   * exported a report from. Regenerating is cheap; a plan that quietly describes an older drawing
   * is not.
   */
  readonly installationPlan: InstallationPlan | null;
  /** Why the last planning attempt produced nothing. Null when a plan exists or none was asked for. */
  readonly planningRefusal: PlanningRefusal | null;
  readonly selectedPlacementId: string | null;
  readonly selectedSpaceId: string | null;
  /**
   * The boundary whose geometry is being edited.
   *
   * Separate from `selectedSpaceId` because not every boundary belongs to a room — a
   * structural column has no room-hood at all, and its vertices still have to be
   * draggable. Selecting a room selects its boundary too.
   */
  readonly selectedBoundaryId: string | null;
  readonly selectedVertex: VertexRef | null;

  /** Vertices of a boundary being traced, in model millimetres. Empty when idle. */
  readonly draftRoomVertices: readonly Vec2[];
  /** What the obstruction tool creates. Room outlines carry none. */
  readonly draftObstructionType: ObstructionType;
  /** Non-null while a modal pick on the plan is in progress. */
  readonly pick: PlanPick | null;

  /** Monotonic counter behind entity ids, so ids stay deterministic within a session. */
  readonly nextEntityNumber: number;
}

export const INITIAL_LEVEL_ID = 'level-1';

/**
 * The document a fresh session opens with.
 *
 * The timestamp is a constant rather than `Date.now()`. The initial state is a module
 * constant evaluated at import; stamping it with a clock would make two sessions
 * started a second apart hold different "identical" documents. `document/new` stamps a
 * real timestamp when the engineer actually starts work.
 */
const EPOCH = '2026-01-01T00:00:00.000Z';

export function emptyDocument(now: string = EPOCH): MfdDocument {
  return createDocument({
    projectId: 'project-1',
    name: 'Untitled dialysis unit',
    now,
    levelId: INITIAL_LEVEL_ID,
    levelName: 'Level 1',
    ruleSetRef: { id: 'dialysis', version: '0.1.0' },
  });
}

export const INITIAL_EDITOR_STATE: EditorState = {
  viewport: createViewport(),
  screen: { width: 0, height: 0 },
  activeTool: 'select',
  showGrid: true,
  snapToGrid: true,
  showPlan: true,
  cursorScreen: null,
  isPanning: false,
  doc: createDocumentState(emptyDocument()),
  activeLevelId: INITIAL_LEVEL_ID,
  armedEquipmentObjectId: null,
  armedReferencePointKind: null,
  selectedReferencePointId: null,
  layoutProposals: null,
  previewedProposalId: null,
  installationPlan: null,
  planningRefusal: null,
  selectedPlacementId: null,
  selectedSpaceId: null,
  selectedBoundaryId: null,
  selectedVertex: null,
  draftRoomVertices: [],
  draftObstructionType: 'column',
  pick: null,
  nextEntityNumber: 1,
};

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/**
 * The level being edited.
 *
 * Falls back to the first level when the active id has gone missing rather than
 * throwing. A stale id is a bug worth fixing, but blanking the drawing an engineer is
 * working on is not the way to report it.
 */
export function activeLevel(state: EditorState): Level {
  const level = state.doc.document.project.levels.find(
    (candidate) => candidate.id === state.activeLevelId,
  );
  return level ?? requireLevel(state.doc.document, state.doc.document.project.levels[0]?.id ?? '');
}

export function placements(state: EditorState): readonly Placement[] {
  return activeLevel(state).placements;
}

/**
 * The transform used to draw the plan image.
 *
 * The real mapping once calibrated, the provisional one before. The distinction is
 * never silently lost: {@link planStatusOf} tells the rule engine which it is.
 */
export function planDisplayTransform(state: EditorState): PlanTransform {
  return planTransformOf(activeLevel(state)) ?? PROVISIONAL_PLAN_TRANSFORM;
}

export type PlanStatus = 'none' | 'calibrated' | 'uncalibrated';

export function planStatusOf(level: Level): PlanStatus {
  if (level.planImage === null) return 'none';
  return level.coordinateMapping === null ? 'uncalibrated' : 'calibrated';
}

/** Default name for a newly drawn room, numbered so two rooms are never both "Room". */
export function defaultSpaceName(index: number): string {
  return `Room ${index}`;
}

export const DEFAULT_SPACE_FUNCTION: SpaceFunction = 'hemodialysis_treatment';

/** The boundary being edited, or null. */
export function selectedBoundary(state: EditorState): Boundary | null {
  if (state.selectedBoundaryId === null) return null;
  return (
    activeLevel(state).boundaries.find(
      (boundary) => boundary.id === state.selectedBoundaryId,
    ) ?? null
  );
}

/** Does the active tool trace a polygon? */
export function isTracingTool(state: EditorState): boolean {
  return state.activeTool === 'room' || state.activeTool === 'obstruction';
}

/** Default label for a newly drawn obstruction, so no two read the same. */
export function defaultObstructionLabel(type: ObstructionType, index: number): string {
  const noun = type === 'fixed_equipment' ? 'Fixed equipment' : type;
  return `${noun.charAt(0).toUpperCase()}${noun.slice(1)} ${index}`;
}
