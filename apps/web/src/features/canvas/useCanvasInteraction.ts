import { type RefObject, useEffect, useRef, useState } from 'react';

import {
  type Vec2,
  chooseGridSpec,
  modelToPixel,
  polygonArea,
  polygonContains,
  screenToWorld,
  snapToStep,
  vec2,
  worldToScreen,
} from '@mfd/cad-engine';
import { footprintContains } from '@mfd/object-library';
import { catalog } from '@mfd/object-library/catalog';

import { now } from '@/editor/clock';
import type { VertexRef } from '@/editor/editorState';
import {
  type EditorState,
  activeLevel,
  isTracingTool,
  planDisplayTransform,
} from '@/editor/editorState';
import { useEditor } from '@/editor/useEditor';
import { CLOSE_TARGET_RADIUS_PX, VERTEX_GRAB_RADIUS_PX } from '@/features/space/spaceTheme';

/**
 * Pointer and wheel navigation for the design canvas.
 *
 * Interaction model (Figma conventions, because that is what the product owner
 * asked the tool to feel like):
 *
 *   wheel               → pan vertically
 *   Shift + wheel       → pan horizontally
 *   Ctrl/Cmd + wheel    → zoom about the cursor
 *   middle-drag         → pan
 *   Space + drag        → pan with any tool active
 *   Pan tool + drag     → pan
 *
 * Listeners are attached natively rather than through React props because a wheel
 * handler must be non-passive to call preventDefault — React attaches wheel
 * listeners passively, and the page would scroll underneath the canvas.
 */

const ZOOM_WHEEL_SENSITIVITY = 0.0016;
const DELTA_MODE_LINE_PX = 16;
const DELTA_MODE_PAGE_PX = 400;

/** Snap a model-space point to the current grid, when snapping is on. */
function applySnap(state: EditorState, point: Vec2): Vec2 {
  return state.snapToGrid ? snapToStep(point, chooseGridSpec(state.viewport.scale).step) : point;
}

/**
 * The topmost placement under a model-space point.
 *
 * Searched back to front so the object drawn last — the one visually on top — wins,
 * which is what the user is pointing at.
 */
function placementAt(state: EditorState, point: Vec2): string | null {
  const placements = activeLevel(state).placements;
  for (let index = placements.length - 1; index >= 0; index -= 1) {
    const placement = placements[index];
    if (!placement) continue;

    const object = catalog.get(placement.equipmentObjectId);
    if (object && footprintContains(object, placement.transform, point)) {
      return placement.id;
    }
  }
  return null;
}

/**
 * Snap a vertex being dragged.
 *
 * Grid snapping, plus a stronger pull towards **other vertices of other boundaries**.
 * Two rooms sharing a party wall have to share its coordinates exactly, and getting
 * them within a few millimetres by eye leaves a sliver of floor that belongs to
 * neither room — the containment test would then place a machine near that wall in
 * neither of them.
 *
 * Vertices of the *same* boundary are excluded: snapping a vertex onto its own
 * neighbour collapses the edge between them, which `simplifyPolygon` would then
 * quietly delete.
 */
function snapVertex(state: EditorState, moving: VertexRef, point: Vec2): Vec2 {
  const grabWorld = VERTEX_GRAB_RADIUS_PX / state.viewport.scale;
  let best: Vec2 | null = null;
  let bestDistance = grabWorld;

  for (const boundary of activeLevel(state).boundaries) {
    if (boundary.id === moving.boundaryId) continue;
    for (const vertex of boundary.vertices) {
      const distance = Math.hypot(vertex.x - point.x, vertex.y - point.y);
      if (distance < bestDistance) {
        best = vertex;
        bestDistance = distance;
      }
    }
  }

  return best ?? applySnap(state, point);
}

/** The nearest vertex handle to a screen point, within grabbing distance. */
function vertexAt(state: EditorState, pointer: Vec2): VertexRef | null {
  const boundaryId = state.selectedBoundaryId;
  if (boundaryId === null) return null;

  const boundary = activeLevel(state).boundaries.find((entry) => entry.id === boundaryId);
  if (!boundary) return null;

  let best: VertexRef | null = null;
  let bestDistance = VERTEX_GRAB_RADIUS_PX;

  for (const [index, vertex] of boundary.vertices.entries()) {
    const screen = worldToScreen(state.viewport, vertex);
    const distance = Math.hypot(screen.x - pointer.x, screen.y - pointer.y);
    if (distance <= bestDistance) {
      best = { boundaryId, index };
      bestDistance = distance;
    }
  }

  return best;
}

/**
 * The edge midpoint handle nearest a screen point, within grabbing distance.
 *
 * Insertion is offered on midpoints rather than anywhere along an edge, so that
 * clicking an edge to insert and clicking near a vertex to grab it cannot be confused.
 * The returned index is the vertex the edge *leaves*, which is what
 * `insertBoundaryVertexCommand` takes.
 */
function edgeMidpointAt(
  state: EditorState,
  pointer: Vec2,
): { readonly afterIndex: number; readonly position: Vec2 } | null {
  const boundaryId = state.selectedBoundaryId;
  if (boundaryId === null) return null;

  const boundary = activeLevel(state).boundaries.find((entry) => entry.id === boundaryId);
  if (!boundary) return null;

  let best: { afterIndex: number; position: Vec2 } | null = null;
  let bestDistance = VERTEX_GRAB_RADIUS_PX;

  for (let index = 0; index < boundary.vertices.length; index += 1) {
    const a = boundary.vertices[index];
    const b = boundary.vertices[(index + 1) % boundary.vertices.length];
    if (!a || !b) continue;

    const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const screen = worldToScreen(state.viewport, midpoint);
    const distance = Math.hypot(screen.x - pointer.x, screen.y - pointer.y);
    if (distance <= bestDistance) {
      best = { afterIndex: index, position: midpoint };
      bestDistance = distance;
    }
  }

  return best;
}

/** The topmost boundary whose outline contains a model point. */
function boundaryAt(state: EditorState, point: Vec2): string | null {
  const boundaries = activeLevel(state).boundaries;
  // Back to front, and smallest-first among containers: a column drawn inside a room
  // is the more specific answer, and the one being pointed at.
  let best: string | null = null;
  let bestArea = Number.POSITIVE_INFINITY;

  for (const boundary of boundaries) {
    if (!polygonContains(boundary.vertices, point)) continue;
    const area = polygonArea(boundary.vertices);
    if (area <= bestArea) {
      best = boundary.id;
      bestArea = area;
    }
  }
  return best;
}

function normaliseWheelDelta(event: WheelEvent): { x: number; y: number } {
  const unit =
    event.deltaMode === 1
      ? DELTA_MODE_LINE_PX
      : event.deltaMode === 2
        ? DELTA_MODE_PAGE_PX
        : 1;
  return { x: event.deltaX * unit, y: event.deltaY * unit };
}

export interface CanvasInteractionState {
  /** True while Space is held — the canvas shows a grab cursor. */
  readonly isSpacePanReady: boolean;
}

export function useCanvasInteraction(
  ref: RefObject<HTMLElement | null>,
): CanvasInteractionState {
  const { state, dispatch } = useEditor();
  const [isSpacePanReady, setIsSpacePanReady] = useState(false);

  // Listeners are attached once. They read live state through refs so that
  // attaching and detaching does not happen on every pointer move.
  const stateRef = useRef(state);
  const spaceHeldRef = useRef(false);
  const panRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);
  /** Offset from the pointer to the placement origin, so a drag does not jump. */
  const dragRef = useRef<{ pointerId: number; placementId: string; grabOffset: Vec2 } | null>(
    null,
  );
  const vertexDragRef = useRef<{ pointerId: number; vertex: VertexRef } | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;

    const localPoint = (event: { clientX: number; clientY: number }) => {
      const bounds = element.getBoundingClientRect();
      return vec2(event.clientX - bounds.left, event.clientY - bounds.top);
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = normaliseWheelDelta(event);

      if (event.ctrlKey || event.metaKey) {
        dispatch({
          type: 'viewport/zoomBy',
          anchor: localPoint(event),
          factor: Math.exp(-delta.y * ZOOM_WHEEL_SENSITIVITY),
        });
        return;
      }

      // Trackpads report horizontal scroll in deltaX; a mouse wheel with Shift
      // reports it in deltaY. Support both.
      const pan = event.shiftKey && delta.x === 0 ? vec2(-delta.y, 0) : vec2(-delta.x, -delta.y);
      dispatch({ type: 'viewport/panBy', delta: pan });
    };

    const onPointerDown = (event: PointerEvent) => {
      const current = stateRef.current;
      const wantsPan =
        event.button === 1 || spaceHeldRef.current || current.activeTool === 'pan';

      if (wantsPan) {
        event.preventDefault();
        element.setPointerCapture(event.pointerId);
        panRef.current = {
          pointerId: event.pointerId,
          lastX: event.clientX,
          lastY: event.clientY,
        };
        dispatch({ type: 'pan/start' });
        return;
      }

      if (event.button !== 0) return;
      const world = screenToWorld(current.viewport, localPoint(event));

      // A modal pick takes precedence over every tool: it is something the engineer
      // started deliberately, and a stray click that placed a machine instead would
      // leave them wondering which of the two things happened.
      if (current.pick) {
        event.preventDefault();
        // Recorded in image pixels, not millimetres. Both picks are statements about
        // the drawing — one of them made before the drawing has any millimetres in it.
        const pixel = modelToPixel(planDisplayTransform(current), world);
        dispatch(
          current.pick.kind === 'calibrate'
            ? { type: 'calibration/pick', pixel }
            : { type: 'origin/set', pixel, at: now() },
        );
        return;
      }

      // Tracing: a ring, closed by clicking the first vertex again.
      if (isTracingTool(current)) {
        event.preventDefault();
        const point = applySnap(current, world);
        const first = current.draftRoomVertices[0];

        if (first && current.draftRoomVertices.length >= 3) {
          const firstScreen = worldToScreen(current.viewport, first);
          const pointer = localPoint(event);
          const withinCloseTarget =
            Math.hypot(pointer.x - firstScreen.x, pointer.y - firstScreen.y) <=
            CLOSE_TARGET_RADIUS_PX;
          if (withinCloseTarget) {
            dispatch({ type: 'room/close', at: now() });
            return;
          }
        }

        dispatch({ type: 'room/addVertex', point });
        return;
      }

      // Equipment tool with a catalogue object armed: place one.
      if (current.activeTool === 'equipment' && current.armedEquipmentObjectId) {
        const object = catalog.get(current.armedEquipmentObjectId);
        if (object) {
          event.preventDefault();
          dispatch({
            type: 'placement/add',
            object,
            position: applySnap(current, world),
            at: now(),
          });
        }
        return;
      }

      const pointer = localPoint(event);

      // A vertex handle on the selected boundary beats everything else under the
      // pointer. The handles are only drawn once a boundary is selected, so this can
      // never steal a click the engineer meant for a machine.
      const grabbed = vertexAt(current, pointer);
      if (grabbed) {
        event.preventDefault();
        element.setPointerCapture(event.pointerId);
        dispatch({ type: 'vertex/select', vertex: grabbed });
        vertexDragRef.current = { pointerId: event.pointerId, vertex: grabbed };
        return;
      }

      // Then a midpoint handle, which inserts a vertex there.
      const midpoint = edgeMidpointAt(current, pointer);
      if (midpoint) {
        event.preventDefault();
        element.setPointerCapture(event.pointerId);
        dispatch({
          type: 'vertex/insert',
          boundaryId: current.selectedBoundaryId ?? '',
          afterIndex: midpoint.afterIndex,
          position: midpoint.position,
          at: now(),
        });
        // Drag the vertex that was just inserted, so inserting and positioning it are
        // one gesture rather than two.
        vertexDragRef.current = {
          pointerId: event.pointerId,
          vertex: {
            boundaryId: current.selectedBoundaryId ?? '',
            index: midpoint.afterIndex + 1,
          },
        };
        return;
      }

      // Then equipment, which sits above the building in the drawing and in intent.
      const hitId = placementAt(current, world);
      if (hitId) {
        dispatch({ type: 'placement/select', placementId: hitId });

        const placement = activeLevel(current).placements.find(
          (candidate) => candidate.id === hitId,
        );
        if (!placement) return;

        event.preventDefault();
        element.setPointerCapture(event.pointerId);
        dragRef.current = {
          pointerId: event.pointerId,
          placementId: hitId,
          grabOffset: vec2(
            placement.transform.position.x - world.x,
            placement.transform.position.y - world.y,
          ),
        };
        return;
      }

      // Finally the building itself. Selecting a boundary is what puts its vertex
      // handles on screen, so this is the click that makes geometry editable.
      dispatch({ type: 'boundary/select', boundaryId: boundaryAt(current, world) });
    };

    const onPointerMove = (event: PointerEvent) => {
      dispatch({ type: 'cursor/move', position: localPoint(event) });

      const vertexDrag = vertexDragRef.current;
      if (vertexDrag && vertexDrag.pointerId === event.pointerId) {
        const current = stateRef.current;
        const world = screenToWorld(current.viewport, localPoint(event));
        dispatch({
          type: 'vertex/move',
          vertex: vertexDrag.vertex,
          position: snapVertex(current, vertexDrag.vertex, world),
          at: now(),
        });
        return;
      }

      const drag = dragRef.current;
      if (drag && drag.pointerId === event.pointerId) {
        const current = stateRef.current;
        const world = screenToWorld(current.viewport, localPoint(event));
        dispatch({
          type: 'placement/move',
          placementId: drag.placementId,
          position: applySnap(
            current,
            vec2(world.x + drag.grabOffset.x, world.y + drag.grabOffset.y),
          ),
          at: now(),
        });
        return;
      }

      const pan = panRef.current;
      if (!pan || pan.pointerId !== event.pointerId) return;

      dispatch({
        type: 'viewport/panBy',
        delta: vec2(event.clientX - pan.lastX, event.clientY - pan.lastY),
      });
      pan.lastX = event.clientX;
      pan.lastY = event.clientY;
    };

    const endGesture = (event: PointerEvent) => {
      const vertexDrag = vertexDragRef.current;
      if (vertexDrag && vertexDrag.pointerId === event.pointerId) {
        const current = stateRef.current;
        const world = screenToWorld(current.viewport, localPoint(event));
        dispatch({
          type: 'vertex/move',
          vertex: vertexDrag.vertex,
          position: snapVertex(current, vertexDrag.vertex, world),
          at: now(),
        });
        return;
      }

      const drag = dragRef.current;
      if (drag && drag.pointerId === event.pointerId) {
        if (element.hasPointerCapture(event.pointerId)) {
          element.releasePointerCapture(event.pointerId);
        }
        dragRef.current = null;
        // One drag, one undo step. Sealing here is precise; the history's time
        // window is only a backstop for gestures that never reach a pointer-up.
        dispatch({ type: 'history/seal' });
        return;
      }

      const pan = panRef.current;
      if (!pan || pan.pointerId !== event.pointerId) return;

      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId);
      }
      panRef.current = null;
      dispatch({ type: 'pan/end' });
    };

    const onPointerLeave = () => {
      dispatch({ type: 'cursor/move', position: null });
    };

    // Double-click closes a room, for engineers who expect the polygon-tool
    // convention rather than clicking the first vertex again.
    const onDoubleClick = (event: MouseEvent) => {
      if (!isTracingTool(stateRef.current)) return;
      if (stateRef.current.draftRoomVertices.length < 3) return;
      event.preventDefault();
      dispatch({ type: 'room/close', at: now() });
    };

    // Middle-click opens the autoscroll widget in some browsers; suppress it.
    const onAuxClick = (event: MouseEvent) => {
      if (event.button === 1) event.preventDefault();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable]')) {
        return;
      }
      event.preventDefault(); // Space would otherwise scroll the page.
      spaceHeldRef.current = true;
      setIsSpacePanReady(true);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      spaceHeldRef.current = false;
      setIsSpacePanReady(false);
    };

    // Held keys are lost when the tab loses focus; clear the latch.
    const onBlur = () => {
      spaceHeldRef.current = false;
      setIsSpacePanReady(false);
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', endGesture);
    element.addEventListener('pointercancel', endGesture);
    element.addEventListener('pointerleave', onPointerLeave);
    element.addEventListener('dblclick', onDoubleClick);
    element.addEventListener('auxclick', onAuxClick);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    return () => {
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', endGesture);
      element.removeEventListener('pointercancel', endGesture);
      element.removeEventListener('pointerleave', onPointerLeave);
      element.removeEventListener('dblclick', onDoubleClick);
      element.removeEventListener('auxclick', onAuxClick);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [dispatch, ref]);

  return { isSpacePanReady };
}
