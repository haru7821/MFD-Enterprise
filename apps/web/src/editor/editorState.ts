import { type ScreenSize, type Vec2, type Viewport, createViewport } from '@mfd/cad-engine';

import type { ToolId } from './tools';

/**
 * The editor's entire state.
 *
 * Deliberately one plain object behind a reducer rather than a state library: in
 * Sprint 2 this becomes the host for the document model and a command stack for
 * undo/redo, and a reducer is already the right shape for that. No dependency is
 * added until it earns its place.
 */
export interface EditorState {
  /** How model space maps to the screen. The canvas reads this; it never owns it. */
  readonly viewport: Viewport;
  /** Current size of the drawing surface, in CSS pixels. */
  readonly screen: ScreenSize;
  readonly activeTool: ToolId;
  readonly showGrid: boolean;
  readonly snapToGrid: boolean;
  /**
   * Pointer position in screen pixels, or null when the pointer is off the canvas.
   *
   * Stored in screen space, not millimetres, on purpose: the pointer is a screen
   * fact, and the model position under it is derived through the viewport. Caching
   * the derived value instead would leave it stale whenever the view moves without
   * the pointer moving — which is exactly what a wheel pan does.
   */
  readonly cursorScreen: Vec2 | null;
  /** True while a pan drag is in progress — drives the cursor style. */
  readonly isPanning: boolean;
}

export const INITIAL_EDITOR_STATE: EditorState = {
  viewport: createViewport(),
  screen: { width: 0, height: 0 },
  activeTool: 'select',
  showGrid: true,
  snapToGrid: true,
  cursorScreen: null,
  isPanning: false,
};
