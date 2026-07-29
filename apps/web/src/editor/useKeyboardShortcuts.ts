import { useEffect, useRef } from 'react';

import { ZOOM_STEP, vec2 } from '@mfd/cad-engine';

import { now } from './clock';
import { findAvailableToolByShortcut } from './tools';
import { useEditor } from './useEditor';

/**
 * Global keyboard shortcuts.
 *
 * Space (hold-to-pan) is handled in useCanvasInteraction instead, because it belongs
 * to the pan gesture rather than to a command.
 */
export function useKeyboardShortcuts(): void {
  const { state, dispatch } = useEditor();
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const isTyping =
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable]') !== null;

      const key = event.key.toLowerCase();

      // Undo and redo are the exception to the modifier guard below: they carry a
      // modifier precisely so they cannot collide with a tool key.
      if ((event.metaKey || event.ctrlKey) && (key === 'z' || key === 'y')) {
        // Inside a text field the browser's own undo is the right one — undoing the
        // document while somebody is retyping a room name is not what they meant.
        if (isTyping) return;
        event.preventDefault();
        const wantsRedo = key === 'y' || event.shiftKey;
        dispatch({ type: wantsRedo ? 'history/redo' : 'history/undo' });
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping) return;

      const screen = stateRef.current.screen;
      const centre = vec2(screen.width / 2, screen.height / 2);

      if (key === 'enter') {
        // Close a traced room without having to hit the first vertex exactly.
        if (stateRef.current.draftRoomVertices.length >= 3) {
          event.preventDefault();
          dispatch({ type: 'room/close', at: now() });
        }
        return;
      }

      if (key === 'delete' || key === 'backspace') {
        // While tracing, Backspace takes back the last vertex rather than deleting
        // the selection — the gesture in progress owns the key it is using.
        if (stateRef.current.draftRoomVertices.length > 0) {
          event.preventDefault();
          dispatch({ type: 'room/undoVertex' });
          return;
        }

        const selectedSpace = stateRef.current.selectedSpaceId;
        if (selectedSpace) {
          event.preventDefault();
          dispatch({ type: 'space/delete', spaceId: selectedSpace, at: now() });
          return;
        }

        const selected = stateRef.current.selectedPlacementId;
        if (selected) {
          event.preventDefault();
          dispatch({ type: 'placement/delete', placementId: selected, at: now() });
        }
        return;
      }

      if (key === 'escape') {
        event.preventDefault();
        // Escape cancels the most specific thing in progress, one level at a time.
        if (stateRef.current.calibration) {
          dispatch({ type: 'calibration/cancel' });
          return;
        }
        if (stateRef.current.draftRoomVertices.length > 0) {
          dispatch({ type: 'room/cancel' });
          return;
        }
        dispatch({ type: 'equipment/arm', equipmentObjectId: null });
        dispatch({ type: 'placement/select', placementId: null });
        dispatch({ type: 'space/select', spaceId: null });
        return;
      }

      const tool = findAvailableToolByShortcut(key);
      if (tool) {
        event.preventDefault();
        dispatch({ type: 'tool/select', tool: tool.id });
        return;
      }

      switch (key) {
        case 'g':
          event.preventDefault();
          dispatch({ type: 'grid/toggle' });
          break;
        case 's':
          event.preventDefault();
          dispatch({ type: 'snap/toggle' });
          break;
        case '=':
        case '+':
          event.preventDefault();
          dispatch({ type: 'viewport/zoomBy', anchor: centre, factor: ZOOM_STEP });
          break;
        case '-':
        case '_':
          event.preventDefault();
          dispatch({ type: 'viewport/zoomBy', anchor: centre, factor: 1 / ZOOM_STEP });
          break;
        case '0':
        case 'home':
          event.preventDefault();
          dispatch({ type: 'viewport/reset' });
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dispatch]);
}
