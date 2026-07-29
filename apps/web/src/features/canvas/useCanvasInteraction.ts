import { type RefObject, useEffect, useRef, useState } from 'react';

import { type Vec2, chooseGridSpec, screenToWorld, snapToStep, vec2 } from '@mfd/cad-engine';
import { footprintContains } from '@mfd/object-library';
import { catalog } from '@mfd/object-library/catalog';

import type { EditorState } from '@/editor/editorState';
import { useEditor } from '@/editor/useEditor';

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
  for (let index = state.placements.length - 1; index >= 0; index -= 1) {
    const placement = state.placements[index];
    if (!placement) continue;

    const object = catalog.get(placement.equipmentObjectId);
    if (object && footprintContains(object, placement.transform, point)) {
      return placement.id;
    }
  }
  return null;
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

      // Equipment tool with a catalogue object armed: place one.
      if (current.activeTool === 'equipment' && current.armedEquipmentObjectId) {
        const object = catalog.get(current.armedEquipmentObjectId);
        if (object) {
          event.preventDefault();
          dispatch({ type: 'placement/add', object, position: applySnap(current, world) });
        }
        return;
      }

      // Otherwise: select what is under the pointer, and start dragging it.
      const hitId = placementAt(current, world);
      dispatch({ type: 'placement/select', placementId: hitId });
      if (!hitId) return;

      const placement = current.placements.find((candidate) => candidate.id === hitId);
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
    };

    const onPointerMove = (event: PointerEvent) => {
      dispatch({ type: 'cursor/move', position: localPoint(event) });

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
      const drag = dragRef.current;
      if (drag && drag.pointerId === event.pointerId) {
        if (element.hasPointerCapture(event.pointerId)) {
          element.releasePointerCapture(event.pointerId);
        }
        dragRef.current = null;
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
      element.removeEventListener('auxclick', onAuxClick);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [dispatch, ref]);

  return { isSpacePanReady };
}
