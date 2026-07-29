import {
  DEFAULT_SCALE,
  ORIGIN,
  type ScreenSize,
  type Vec2,
  centreOn,
  createViewport,
  panBy,
  zoomBy,
  zoomTo,
} from '@mfd/cad-engine';

import type { EditorState } from './editorState';
import type { ToolId } from './tools';

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
  | { readonly type: 'snap/toggle' };

/** Put the model origin at the middle of the screen at the default zoom. */
function resetView(screen: ScreenSize): EditorState['viewport'] {
  return centreOn(createViewport(DEFAULT_SCALE), ORIGIN, screen);
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
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
      return state.activeTool === action.tool ? state : { ...state, activeTool: action.tool };

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
  }
}
