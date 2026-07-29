import { useEffect, useRef } from 'react';

import { ZOOM_STEP, vec2 } from '@mfd/cad-engine';

import { findAvailableToolByShortcut } from './tools';
import { useEditor } from './useEditor';

/**
 * Global keyboard shortcuts.
 *
 * Space (hold-to-pan) is handled in useCanvasInteraction instead, because it
 * belongs to the pan gesture rather than to a command.
 */
export function useKeyboardShortcuts(): void {
  const { state, dispatch } = useEditor();
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable]')) {
        return;
      }

      const screen = stateRef.current.screen;
      const centre = vec2(screen.width / 2, screen.height / 2);
      const key = event.key.toLowerCase();

      if (key === 'delete' || key === 'backspace') {
        const selected = stateRef.current.selectedPlacementId;
        if (selected) {
          event.preventDefault();
          dispatch({ type: 'placement/delete', placementId: selected });
        }
        return;
      }

      if (key === 'escape') {
        event.preventDefault();
        dispatch({ type: 'equipment/arm', equipmentObjectId: null });
        dispatch({ type: 'placement/select', placementId: null });
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
