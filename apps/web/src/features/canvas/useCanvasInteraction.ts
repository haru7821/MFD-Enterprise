import { type RefObject, useEffect, useRef, useState } from 'react';

import { vec2 } from '@mfd/cad-engine';

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
      const wantsPan =
        event.button === 1 || spaceHeldRef.current || stateRef.current.activeTool === 'pan';
      if (!wantsPan) return;

      event.preventDefault();
      element.setPointerCapture(event.pointerId);
      panRef.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
      dispatch({ type: 'pan/start' });
    };

    const onPointerMove = (event: PointerEvent) => {
      dispatch({ type: 'cursor/move', position: localPoint(event) });

      const pan = panRef.current;
      if (!pan || pan.pointerId !== event.pointerId) return;

      dispatch({
        type: 'viewport/panBy',
        delta: vec2(event.clientX - pan.lastX, event.clientY - pan.lastY),
      });
      pan.lastX = event.clientX;
      pan.lastY = event.clientY;
    };

    const endPan = (event: PointerEvent) => {
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
    element.addEventListener('pointerup', endPan);
    element.addEventListener('pointercancel', endPan);
    element.addEventListener('pointerleave', onPointerLeave);
    element.addEventListener('auxclick', onAuxClick);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    return () => {
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', endPan);
      element.removeEventListener('pointercancel', endPan);
      element.removeEventListener('pointerleave', onPointerLeave);
      element.removeEventListener('auxclick', onAuxClick);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [dispatch, ref]);

  return { isSpacePanReady };
}
