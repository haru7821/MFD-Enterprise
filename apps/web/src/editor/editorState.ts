import {
  type PlanTransform,
  type ScreenSize,
  type Vec2,
  type Viewport,
  createViewport,
} from '@mfd/cad-engine';
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
