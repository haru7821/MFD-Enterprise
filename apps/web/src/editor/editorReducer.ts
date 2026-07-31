import {
  DEFAULT_SCALE,
  ORIGIN,
  type ScreenSize,
  type Vec2,
  centreOn,
  createViewport,
  panBy,
  simplifyPolygon,
  zoomBy,
  zoomTo,
} from '@mfd/cad-engine';
import {
  type Boundary,
  type CoordinateMapping,
  type MfdDocument,
  type ObstructionType,
  type ReferencePointKind,
  type PlanImage,
  type Space,
  type SpaceFunction,
  clearPlanImage,
  createBoundary,
  createBoundaryCommand,
  createDocumentState,
  createLevelCommand,
  type ProjectDetails,
  type ReportRenderMode,
  createObstruction,
  createPlacement,
  createPlacementCommand,
  createReferencePointCommand,
  groupCommand,
  createSpace,
  createSpaceCommand,
  deleteBoundaryCommand,
  deleteLevelCommand,
  deletePlacementCommand,
  deleteReferencePointCommand,
  moveReferencePointCommand,
  relabelReferencePointCommand,
  deleteSpaceCommand,
  describeBoundaryCommand,
  execute,
  insertBoundaryVertexCommand,
  moveBoundaryVertexCommand,
  movePlacementCommand,
  planOriginShift,
  redo,
  removeBoundaryVertexCommand,
  renameLevelCommand,
  renameSpaceCommand,
  rotatePlacementCommand,
  seal,
  setBoundaryVerticesCommand,
  setCoordinateMapping,
  setPlanImage,
  setProjectDetailsCommand,
  setReportRenderModeCommand,
  setPlanOriginCommand,
  undo,
} from '@mfd/document-model';
import type { EquipmentObject } from '@mfd/object-library';

import {
  DEFAULT_SPACE_FUNCTION,
  type EditorState,
  type VertexRef,
  activeLevel,
  defaultObstructionLabel,
  defaultSpaceName,
  emptyDocument,
} from './editorState';
import type { LayoutProposal, LayoutProposalSet } from './editorState';
import type { ToolId } from './tools';

/**
 * Editor actions.
 *
 * Document-changing actions carry an `at` timestamp rather than reading a clock here.
 * A reducer that called `Date.now()` would be impure — React invokes reducers twice in
 * development, and undo coalescing depends on that timestamp. `useDocumentCommands`
 * stamps it at the call site, which is where the clock belongs.
 */
export type EditorAction =
  | { readonly type: 'screen/resize'; readonly size: ScreenSize }
  | { readonly type: 'tool/select'; readonly tool: ToolId }
  | { readonly type: 'viewport/panBy'; readonly delta: Vec2 }
  | { readonly type: 'viewport/zoomBy'; readonly anchor: Vec2; readonly factor: number }
  | { readonly type: 'viewport/zoomTo'; readonly anchor: Vec2; readonly scale: number }
  | { readonly type: 'viewport/reset' }
  /** Pointer position in screen pixels relative to the canvas, or null when off it. */
  | { readonly type: 'cursor/move'; readonly position: Vec2 | null }
  | { readonly type: 'pan/start' }
  | { readonly type: 'pan/end' }
  | { readonly type: 'grid/toggle' }
  | { readonly type: 'snap/toggle' }
  | { readonly type: 'plan/toggle' }
  /** Arm a catalogue object for placement, or pass null to disarm. */
  | { readonly type: 'equipment/arm'; readonly equipmentObjectId: string | null }
  /** Arm a reference-point kind, or pass null to disarm. */
  | {
      readonly type: 'referencePoint/arm';
      readonly kind: ReferencePointKind | null;
    }
  | {
      readonly type: 'referencePoint/add';
      readonly kind: ReferencePointKind;
      readonly position: Vec2;
      readonly at: number;
    }
  | {
      readonly type: 'referencePoint/move';
      readonly pointId: string;
      readonly position: Vec2;
      readonly at: number;
    }
  | {
      readonly type: 'referencePoint/relabel';
      readonly pointId: string;
      readonly label: string | null;
      readonly at: number;
    }
  | { readonly type: 'referencePoint/delete'; readonly pointId: string; readonly at: number }
  | { readonly type: 'referencePoint/select'; readonly pointId: string | null }
  /** Store what the solver returned. The solver runs at the call site, not in the reducer. */
  | { readonly type: 'layout/propose'; readonly proposals: LayoutProposalSet }
  | { readonly type: 'layout/preview'; readonly proposalId: string | null }
  /** The engineer's explicit approval — the only action that touches the document. */
  | { readonly type: 'layout/approve'; readonly proposalId: string; readonly at: number }
  | { readonly type: 'layout/discard' }
  | {
      readonly type: 'placement/add';
      readonly object: EquipmentObject;
      /** Model-space position in millimetres. */
      readonly position: Vec2;
      readonly at: number;
    }
  | {
      readonly type: 'placement/move';
      readonly placementId: string;
      readonly position: Vec2;
      readonly at: number;
    }
  | {
      readonly type: 'placement/rotate';
      readonly placementId: string;
      readonly rotation: number;
      readonly at: number;
    }
  | { readonly type: 'placement/select'; readonly placementId: string | null }
  | { readonly type: 'placement/delete'; readonly placementId: string; readonly at: number }
  | { readonly type: 'space/select'; readonly spaceId: string | null }
  | { readonly type: 'boundary/select'; readonly boundaryId: string | null }
  | { readonly type: 'vertex/select'; readonly vertex: VertexRef | null }
  | {
      readonly type: 'vertex/move';
      readonly vertex: VertexRef;
      readonly position: Vec2;
      readonly at: number;
    }
  | {
      readonly type: 'vertex/insert';
      readonly boundaryId: string;
      readonly afterIndex: number;
      readonly position: Vec2;
      readonly at: number;
    }
  | { readonly type: 'vertex/delete'; readonly vertex: VertexRef; readonly at: number }
  | {
      readonly type: 'boundary/describe';
      readonly boundaryId: string;
      readonly label: string;
      readonly obstructionType: ObstructionType | null;
      readonly at: number;
    }
  | { readonly type: 'boundary/delete'; readonly boundaryId: string; readonly at: number }
  | { readonly type: 'obstruction/setType'; readonly obstructionType: ObstructionType }
  | { readonly type: 'level/select'; readonly levelId: string }
  | { readonly type: 'level/add'; readonly name: string; readonly at: number }
  | {
      readonly type: 'level/rename';
      readonly levelId: string;
      readonly name: string;
      readonly elevation: number;
      readonly at: number;
    }
  | { readonly type: 'level/delete'; readonly levelId: string; readonly at: number }
  | { readonly type: 'origin/start' }
  | { readonly type: 'origin/set'; readonly pixel: Vec2; readonly at: number }
  | {
      readonly type: 'space/rename';
      readonly spaceId: string;
      readonly name: string;
      readonly function: SpaceFunction;
      readonly at: number;
    }
  | { readonly type: 'space/delete'; readonly spaceId: string; readonly at: number }
  | {
      readonly type: 'boundary/setVertices';
      readonly boundaryId: string;
      readonly vertices: readonly Vec2[];
      readonly at: number;
    }
  /** Room tracing. */
  | { readonly type: 'room/addVertex'; readonly point: Vec2 }
  | { readonly type: 'room/undoVertex' }
  | { readonly type: 'room/cancel' }
  | { readonly type: 'room/close'; readonly at: number }
  /** Plan workflow — deliberately outside the undo stack; see document-model/plan.ts. */
  | { readonly type: 'plan/import'; readonly planImage: PlanImage }
  | { readonly type: 'plan/clear' }
  | { readonly type: 'plan/setMapping'; readonly mapping: CoordinateMapping | null }
  | { readonly type: 'calibration/start' }
  | { readonly type: 'calibration/pick'; readonly pixel: Vec2 }
  | { readonly type: 'pick/cancel' }
  | { readonly type: 'history/undo' }
  | { readonly type: 'history/redo' }
  | {
      readonly type: 'project/setDetails';
      readonly details: ProjectDetails;
      readonly at: number;
    }
  | {
      readonly type: 'project/setRenderMode';
      readonly mode: ReportRenderMode;
      readonly at: number;
    }
  | { readonly type: 'history/seal' }
  | { readonly type: 'document/load'; readonly document: MfdDocument }
  | { readonly type: 'document/new'; readonly now: string };

/** Put the model origin at the middle of the screen at the default zoom. */
function resetView(screen: ScreenSize): EditorState['viewport'] {
  return centreOn(createViewport(DEFAULT_SCALE), ORIGIN, screen);
}

/** Apply a plan-level change, which is not undoable. */
function withDocument(state: EditorState, document: MfdDocument): EditorState {
  return { ...state, doc: { ...state.doc, document } };
}

/** Replace the document *and* its history — for changes that are undoable. */
function withDocumentState(state: EditorState, doc: EditorState['doc']): EditorState {
  return { ...state, doc };
}

/**
 * Replace the document, panning the view so the drawing does not appear to move.
 *
 * Setting the plan origin translates every placement and boundary vertex in model
 * space, and moves the plan image with them, so their positions *relative to the
 * drawing* are unchanged. Relative to the **viewport** they all move together, which on
 * screen looks like the whole floor sliding — not something an engineer asked for by
 * clicking a point and calling it zero.
 *
 * So this compensates: whenever the active level's plan origin changes, the view moves
 * with it. Stated as a rule over the before-and-after origins rather than as a special
 * case inside one action, because undo and redo change the origin too — and a
 * compensation applied on the way in but not on the way out is the same bug with an
 * extra keystroke in front of it.
 */
function withOriginCompensation(state: EditorState, doc: EditorState['doc']): EditorState {
  const before = activeLevel(state).coordinateMapping;
  const next = withDocumentState(state, doc);
  const after = activeLevel(next).coordinateMapping;

  if (!before || !after) return next;
  if (before.origin.x === after.origin.x && before.origin.y === after.origin.y) return next;

  const shift = planOriginShift(before, after.origin);
  return {
    ...next,
    viewport: panBy(next.viewport, {
      x: shift.x * next.viewport.scale,
      y: shift.y * next.viewport.scale,
    }),
  };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  const levelId = state.activeLevelId;

  switch (action.type) {
    case 'screen/resize': {
      if (
        action.size.width === state.screen.width &&
        action.size.height === state.screen.height
      ) {
        return state;
      }
      // The first real measurement decides where the origin sits. Without this the
      // drawing would open with 0,0 pinned to the top-left corner.
      const isFirstMeasurement = state.screen.width === 0 || state.screen.height === 0;
      return {
        ...state,
        screen: action.size,
        viewport: isFirstMeasurement ? resetView(action.size) : state.viewport,
      };
    }

    case 'tool/select':
      if (state.activeTool === action.tool) return state;
      return {
        ...state,
        activeTool: action.tool,
        // Leaving the equipment tool disarms it: an armed catalogue object that
        // survives a tool change places a machine on the next unrelated click.
        armedEquipmentObjectId:
          action.tool === 'equipment' ? state.armedEquipmentObjectId : null,
        armedReferencePointKind:
          action.tool === 'reference' ? state.armedReferencePointKind : null,
        // A half-traced ring does not belong to any other tool. Abandoning it on the
        // tool change is less surprising than having it reappear later. Switching
        // between the room and obstruction tools abandons it too: the two produce
        // different entities, and finishing a room as a column is not a thing to offer.
        draftRoomVertices: action.tool === state.activeTool ? state.draftRoomVertices : [],
      };

    case 'viewport/panBy':
      return { ...state, viewport: panBy(state.viewport, action.delta) };

    case 'viewport/zoomBy':
      return { ...state, viewport: zoomBy(state.viewport, action.anchor, action.factor) };

    case 'viewport/zoomTo':
      return { ...state, viewport: zoomTo(state.viewport, action.anchor, action.scale) };

    case 'viewport/reset':
      return { ...state, viewport: resetView(state.screen) };

    case 'cursor/move':
      return { ...state, cursorScreen: action.position };

    case 'pan/start':
      return state.isPanning ? state : { ...state, isPanning: true };

    case 'pan/end':
      return state.isPanning ? { ...state, isPanning: false } : state;

    case 'grid/toggle':
      return { ...state, showGrid: !state.showGrid };

    case 'snap/toggle':
      return { ...state, snapToGrid: !state.snapToGrid };

    case 'plan/toggle':
      return { ...state, showPlan: !state.showPlan };

    case 'equipment/arm':
      return {
        ...state,
        armedEquipmentObjectId: action.equipmentObjectId,
        activeTool: action.equipmentObjectId ? 'equipment' : state.activeTool,
      };

    case 'referencePoint/arm':
      return {
        ...state,
        armedReferencePointKind: action.kind,
        activeTool: action.kind ? 'reference' : state.activeTool,
      };

    case 'referencePoint/add': {
      const number = state.nextEntityNumber;
      return {
        ...state,
        doc: execute(
          state.doc,
          createReferencePointCommand(levelId, {
            id: `reference-${number}`,
            kind: action.kind,
            position: action.position,
            // Unnamed until the engineer names it. Null, not "" — the schema's rule, and the
            // report prints an em dash rather than an empty cell.
            label: null,
          }),
          action.at,
        ),
        nextEntityNumber: number + 1,
        selectedReferencePointId: `reference-${number}`,
        selectedPlacementId: null,
        selectedSpaceId: null,
      };
    }

    case 'referencePoint/move':
      return {
        ...state,
        doc: execute(
          state.doc,
          moveReferencePointCommand(levelId, action.pointId, action.position),
          action.at,
        ),
      };

    case 'referencePoint/relabel':
      return {
        ...state,
        doc: execute(
          state.doc,
          relabelReferencePointCommand(levelId, action.pointId, action.label),
          action.at,
        ),
      };

    case 'referencePoint/delete':
      return {
        ...state,
        doc: execute(state.doc, deleteReferencePointCommand(levelId, action.pointId), action.at),
        selectedReferencePointId:
          state.selectedReferencePointId === action.pointId ? null : state.selectedReferencePointId,
      };

    case 'referencePoint/select':
      return { ...state, selectedReferencePointId: action.pointId };

    case 'layout/propose':
      return {
        ...state,
        layoutProposals: action.proposals,
        // The best one previews immediately. An engineer who asked for layouts wants to see one,
        // and the ranking already says which is first.
        previewedProposalId: action.proposals.proposals[0]?.id ?? null,
      };

    case 'layout/preview':
      return { ...state, previewedProposalId: action.proposalId };

    case 'layout/approve': {
      const proposal = state.layoutProposals?.proposals.find(
        (entry) => entry.id === action.proposalId,
      );
      // A proposal that is no longer there is not an error worth throwing over — the panel is
      // closed and the approval is stale. Doing nothing is the honest response.
      if (!proposal) return state;

      /*
       * **One command group, so one undo press.**
       *
       * An engineer who accepts twelve stations and changes their mind should not have to press
       * undo twelve times. The group's inverse un-does the steps in reverse, which is the only
       * order they are valid in — see `groupCommand`.
       *
       * ## One loop for both operations
       *
       * The commands come off the proposal's **diff**, which is the same list the ghost layer drew.
       * So an approval applies exactly what was highlighted: an `added` ghost becomes a create, a
       * `moved` ghost becomes a move of the machine the arrow came from, and an `unchanged` one
       * becomes nothing at all.
       *
       * There is no branch on the operation here, and there should not be. A generation whose diff
       * is all-`added` and an optimisation whose diff is `moved`/`unchanged` differ in their data,
       * not in what approving them means.
       *
       * **Never a delete.** `diffPlacements` has no third case to produce one from, and the solver
       * asserts the same thing about its own commands — the owner's *"never delete placements
       * automatically"*, held at both ends.
       */
      const commands = proposal.diff.flatMap((entry) => {
        if (entry.change === 'added') return [createPlacementCommand(levelId, entry.placement)];
        if (entry.change === 'unchanged' || entry.source === null) return [];

        const source = entry.source;
        const moved = [
          movePlacementCommand(levelId, source.id, entry.placement.transform.position),
        ];
        if (entry.placement.transform.rotation !== source.transform.rotation) {
          moved.push(
            rotatePlacementCommand(levelId, source.id, entry.placement.transform.rotation),
          );
        }
        return moved;
      });

      // Nothing to do — an "optimisation" in which every machine stayed put. Not reachable through
      // the panel, which only offers proposals that beat the current layout, and `groupCommand`
      // throws on an empty group rather than pushing an undo step that undoes nothing.
      if (commands.length === 0) {
        return { ...state, layoutProposals: null, previewedProposalId: null };
      }

      const added = proposal.diff.filter((entry) => entry.change === 'added').length;
      const changed = proposal.diff.filter((entry) => entry.change === 'moved').length;

      return {
        ...state,
        doc: execute(
          state.doc,
          groupCommand(
            added > 0
              ? `Apply layout — ${added} × ${equipmentModel(proposal)}`
              : `Optimise layout — ${changed} × ${equipmentModel(proposal)} moved`,
            commands,
          ),
          action.at,
        ),
        // The proposals are spent. Leaving them on screen would invite a second approval that
        // would place the same machines again.
        layoutProposals: null,
        previewedProposalId: null,
        nextEntityNumber: state.nextEntityNumber + added,
      };
    }

    case 'layout/discard':
      return { ...state, layoutProposals: null, previewedProposalId: null };

    case 'placement/add': {
      const number = state.nextEntityNumber;
      const placement = createPlacement(
        `placement-${number}`,
        action.object,
        action.position,
        { label: `${action.object.model} ${number}` },
      );

      return {
        ...state,
        doc: execute(state.doc, createPlacementCommand(levelId, placement), action.at),
        nextEntityNumber: number + 1,
        selectedPlacementId: placement.id,
        selectedSpaceId: null,
      };
    }

    case 'placement/move':
      return {
        ...state,
        doc: execute(
          state.doc,
          movePlacementCommand(levelId, action.placementId, action.position),
          action.at,
        ),
      };

    case 'placement/rotate':
      return {
        ...state,
        doc: execute(
          state.doc,
          rotatePlacementCommand(levelId, action.placementId, action.rotation),
          action.at,
        ),
      };

    case 'placement/select':
      return state.selectedPlacementId === action.placementId
        ? state
        : {
            ...state,
            selectedPlacementId: action.placementId,
            selectedSpaceId: null,
            selectedBoundaryId: null,
            selectedVertex: null,
          };

    case 'placement/delete':
      return {
        ...state,
        doc: seal(
          execute(state.doc, deletePlacementCommand(levelId, action.placementId), action.at),
        ),
        selectedPlacementId:
          state.selectedPlacementId === action.placementId ? null : state.selectedPlacementId,
      };

    case 'space/select': {
      if (state.selectedSpaceId === action.spaceId) return state;
      // Selecting a room selects its outline too, so its vertices become editable
      // without a second click into a different concept.
      const space =
        action.spaceId === null
          ? null
          : activeLevel(state).spaces.find((entry) => entry.id === action.spaceId) ?? null;

      return {
        ...state,
        selectedSpaceId: action.spaceId,
        selectedBoundaryId: space?.boundaryId ?? null,
        selectedVertex: null,
        selectedPlacementId: null,
      };
    }

    case 'boundary/select': {
      if (state.selectedBoundaryId === action.boundaryId) return state;
      // A boundary may or may not be a room's. Reflecting that into the room
      // selection keeps the two inspectors showing the same thing.
      const owningSpace =
        action.boundaryId === null
          ? null
          : activeLevel(state).spaces.find(
              (entry) => entry.boundaryId === action.boundaryId,
            ) ?? null;

      return {
        ...state,
        selectedBoundaryId: action.boundaryId,
        selectedSpaceId: owningSpace?.id ?? null,
        selectedVertex: null,
        selectedPlacementId: null,
      };
    }

    case 'vertex/select':
      return { ...state, selectedVertex: action.vertex };

    case 'vertex/move':
      return {
        ...state,
        doc: execute(
          state.doc,
          moveBoundaryVertexCommand(
            levelId,
            action.vertex.boundaryId,
            action.vertex.index,
            action.position,
          ),
          action.at,
        ),
      };

    case 'vertex/insert':
      return {
        ...state,
        doc: seal(
          execute(
            state.doc,
            insertBoundaryVertexCommand(
              levelId,
              action.boundaryId,
              action.afterIndex,
              action.position,
            ),
            action.at,
          ),
        ),
        // Select the vertex just inserted, so it can be dragged straight away.
        selectedVertex: { boundaryId: action.boundaryId, index: action.afterIndex + 1 },
      };

    case 'vertex/delete':
      return {
        ...state,
        doc: seal(
          execute(
            state.doc,
            removeBoundaryVertexCommand(levelId, action.vertex.boundaryId, action.vertex.index),
            action.at,
          ),
        ),
        // The index no longer refers to what the engineer had selected.
        selectedVertex: null,
      };

    case 'boundary/describe':
      return {
        ...state,
        doc: execute(
          state.doc,
          describeBoundaryCommand(
            levelId,
            action.boundaryId,
            action.label,
            action.obstructionType,
          ),
          action.at,
        ),
      };

    case 'boundary/delete':
      return {
        ...state,
        doc: seal(
          execute(state.doc, deleteBoundaryCommand(levelId, action.boundaryId), action.at),
        ),
        selectedBoundaryId:
          state.selectedBoundaryId === action.boundaryId ? null : state.selectedBoundaryId,
        selectedVertex: null,
      };

    case 'obstruction/setType':
      return { ...state, draftObstructionType: action.obstructionType };

    case 'space/rename':
      // Not sealed here: the field seals on blur, so one editing session is one
      // undo step rather than one per keystroke.
      return {
        ...state,
        doc: execute(
          state.doc,
          renameSpaceCommand(levelId, action.spaceId, action.name, action.function),
          action.at,
        ),
      };

    case 'space/delete': {
      const space = activeLevel(state).spaces.find((entry) => entry.id === action.spaceId);
      return {
        ...state,
        doc: seal(execute(state.doc, deleteSpaceCommand(levelId, action.spaceId), action.at)),
        selectedSpaceId: state.selectedSpaceId === action.spaceId ? null : state.selectedSpaceId,
        selectedBoundaryId:
          space && state.selectedBoundaryId === space.boundaryId
            ? null
            : state.selectedBoundaryId,
        selectedVertex: null,
      };
    }

    case 'boundary/setVertices':
      return {
        ...state,
        doc: execute(
          state.doc,
          setBoundaryVerticesCommand(levelId, action.boundaryId, action.vertices),
          action.at,
        ),
      };

    case 'room/addVertex':
      return { ...state, draftRoomVertices: [...state.draftRoomVertices, action.point] };

    case 'room/undoVertex':
      return { ...state, draftRoomVertices: state.draftRoomVertices.slice(0, -1) };

    case 'room/cancel':
      return state.draftRoomVertices.length === 0 ? state : { ...state, draftRoomVertices: [] };

    case 'room/close': {
      // Vertices traced by hand collect repeats and points that merely sit along a
      // wall. Neither changes the shape; both make every later edge test slower and
      // every vertex handle harder to grab.
      const vertices = simplifyPolygon(state.draftRoomVertices);
      // Fewer than three vertices encloses nothing. Silently creating it would give
      // the engineer a room that reports every machine in the building as outside it.
      if (vertices.length < 3) return { ...state, draftRoomVertices: [] };

      const number = state.nextEntityNumber;

      // The obstruction tool produces a bare boundary; the room tool produces a
      // boundary and the room record that names it. Same gesture, two entities,
      // because a column is not a room and giving it one would be a fiction the
      // rule engine and the report would both have to work around.
      if (state.activeTool === 'obstruction') {
        const obstruction: Boundary = createObstruction(
          `boundary-${number}`,
          state.draftObstructionType,
          vertices,
          defaultObstructionLabel(state.draftObstructionType, number),
        );

        return {
          ...state,
          doc: seal(
            execute(state.doc, createBoundaryCommand(levelId, obstruction), action.at),
          ),
          draftRoomVertices: [],
          nextEntityNumber: number + 1,
          selectedBoundaryId: obstruction.id,
          selectedSpaceId: null,
          selectedPlacementId: null,
          selectedVertex: null,
        };
      }

      const boundary: Boundary = createBoundary(
        `boundary-${number}`,
        'space_outline',
        vertices,
        defaultSpaceName(number),
      );
      const space: Space = createSpace(
        `space-${number}`,
        boundary.id,
        defaultSpaceName(number),
        DEFAULT_SPACE_FUNCTION,
      );

      return {
        ...state,
        doc: seal(execute(state.doc, createSpaceCommand(levelId, boundary, space), action.at)),
        draftRoomVertices: [],
        nextEntityNumber: number + 1,
        selectedSpaceId: space.id,
        selectedBoundaryId: boundary.id,
        selectedPlacementId: null,
        selectedVertex: null,
      };
    }

    case 'plan/import':
      return {
        ...withDocument(state, setPlanImage(state.doc.document, levelId, action.planImage)),
        pick: null,
      };

    case 'plan/clear':
      return {
        ...withDocument(state, clearPlanImage(state.doc.document, levelId)),
        pick: null,
      };

    case 'plan/setMapping':
      return {
        ...withDocument(
          state,
          setCoordinateMapping(state.doc.document, levelId, action.mapping),
        ),
        pick: null,
      };

    case 'calibration/start':
      return activeLevel(state).planImage === null
        ? state
        : { ...state, pick: { kind: 'calibrate', points: [] }, activeTool: 'select' };

    case 'calibration/pick': {
      if (state.pick?.kind !== 'calibrate') return state;
      const points = [...state.pick.points, action.pixel].slice(-2);
      return { ...state, pick: { kind: 'calibrate', points } };
    }

    case 'origin/start':
      // Requires a mapping, not just a drawing: there is nothing to be the origin of
      // until a scale exists, and offering the control before then would let an
      // engineer set an origin that silently did nothing.
      return activeLevel(state).coordinateMapping === null
        ? state
        : { ...state, pick: { kind: 'origin' }, activeTool: 'select' };

    case 'origin/set':
      return {
        ...withOriginCompensation(
          state,
          seal(execute(state.doc, setPlanOriginCommand(levelId, action.pixel), action.at)),
        ),
        pick: null,
      };

    case 'pick/cancel':
      return state.pick === null ? state : { ...state, pick: null };

    case 'level/select': {
      if (action.levelId === state.activeLevelId) return state;
      // Selections name entities on the level being left. Carrying them across would
      // leave the inspector describing something the engineer can no longer see.
      return {
        ...state,
        activeLevelId: action.levelId,
        selectedPlacementId: null,
        selectedSpaceId: null,
        selectedBoundaryId: null,
        selectedVertex: null,
        draftRoomVertices: [],
        pick: null,
      };
    }

    case 'level/add': {
      const number = state.nextEntityNumber;
      const levelNewId = `level-${number}`;
      return {
        ...state,
        doc: seal(
          execute(state.doc, createLevelCommand(levelNewId, action.name), action.at),
        ),
        activeLevelId: levelNewId,
        nextEntityNumber: number + 1,
        selectedPlacementId: null,
        selectedSpaceId: null,
        selectedBoundaryId: null,
        selectedVertex: null,
        draftRoomVertices: [],
        pick: null,
      };
    }

    case 'level/rename':
      return {
        ...state,
        doc: execute(
          state.doc,
          renameLevelCommand(action.levelId, action.name, action.elevation),
          action.at,
        ),
      };

    case 'level/delete': {
      const next = seal(execute(state.doc, deleteLevelCommand(action.levelId), action.at));
      const remaining = next.document.project.levels;
      // The command refuses to remove the last level, so `remaining` is never empty.
      const stillThere = remaining.some((level) => level.id === state.activeLevelId);

      return {
        ...state,
        doc: next,
        activeLevelId: stillThere
          ? state.activeLevelId
          : remaining[0]?.id ?? state.activeLevelId,
        selectedPlacementId: null,
        selectedSpaceId: null,
        selectedBoundaryId: null,
        selectedVertex: null,
        draftRoomVertices: [],
        pick: null,
      };
    }

    case 'history/undo':
      return withOriginCompensation(state, undo(state.doc));

    case 'history/redo':
      return withOriginCompensation(state, redo(state.doc));

    case 'project/setDetails':
      // Not sealed here. The five cover-page fields share one merge key, so a typing session
      // is one undo step; the seal happens on blur, the same arrangement room renaming uses.
      return {
        ...state,
        doc: execute(state.doc, setProjectDetailsCommand(action.details), action.at),
      };

    case 'project/setRenderMode':
      // Sealed: choosing a drawing mode is a decision, not a typing session, so it is its own
      // undo step.
      return {
        ...state,
        doc: seal(execute(state.doc, setReportRenderModeCommand(action.mode), action.at)),
      };

    case 'history/seal':
      return { ...state, doc: seal(state.doc) };

    case 'document/load': {
      const level = action.document.project.levels[0];
      return {
        ...state,
        // A loaded document starts a fresh history. Undoing across a file open would
        // reach back into a project the engineer is no longer looking at.
        doc: createDocumentState(action.document),
        activeLevelId: level?.id ?? state.activeLevelId,
        selectedPlacementId: null,
        selectedSpaceId: null,
        selectedBoundaryId: null,
        selectedVertex: null,
        draftRoomVertices: [],
        pick: null,
        // Ids in a loaded document were numbered in another session. Restarting the
        // counter past the largest number already present avoids colliding with them.
        nextEntityNumber: nextFreeNumber(action.document),
      };
    }

    case 'document/new':
      return {
        ...INITIAL_EDITOR_STATE_VIEW(state),
        doc: createDocumentState(emptyDocument(action.now)),
      };
  }
}

/**
 * Keep the view, drop everything about the old project.
 *
 * An engineer starting a new review has not asked for their zoom level to be reset.
 */
function INITIAL_EDITOR_STATE_VIEW(state: EditorState): EditorState {
  return {
    ...state,
    activeLevelId: 'level-1',
    armedEquipmentObjectId: null,
    armedReferencePointKind: null,
    selectedReferencePointId: null,
    selectedPlacementId: null,
    selectedSpaceId: null,
    selectedBoundaryId: null,
    selectedVertex: null,
    draftRoomVertices: [],
    pick: null,
    nextEntityNumber: 1,
  };
}

/** One past the largest `-<n>` suffix in the document, so new ids cannot collide. */
function nextFreeNumber(document: MfdDocument): number {
  let highest = 0;
  for (const level of document.project.levels) {
    for (const id of [
      ...level.placements.map((entry) => entry.id),
      ...level.boundaries.map((entry) => entry.id),
      ...level.spaces.map((entry) => entry.id),
    ]) {
      const match = /-(\d+)$/.exec(id);
      const value = match?.[1] ? Number(match[1]) : 0;
      if (value > highest) highest = value;
    }
  }
  return highest + 1;
}


/** What the history entry calls the equipment. The catalogue id, which is stable and unambiguous. */
function equipmentModel(proposal: LayoutProposal): string {
  return proposal.placements[0]?.equipmentObjectId ?? 'equipment';
}
