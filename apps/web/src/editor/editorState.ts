import { type ScreenSize, type Vec2, type Viewport, createViewport } from '@mfd/cad-engine';
import type { Placement } from '@mfd/document-model';

import type { ToolId } from './tools';

/**
 * The editor's entire state.
 *
 * Deliberately one plain object behind a reducer rather than a state library. In a
 * later editor-architecture sprint this becomes the host for the document model and
 * a command stack for undo/redo, and a reducer is already the right shape for that.
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
   * the derived value would leave it stale whenever the view moves without the
   * pointer moving — which is exactly what a wheel pan does.
   */
  readonly cursorScreen: Vec2 | null;
  /** True while a pan drag is in progress — drives the cursor style. */
  readonly isPanning: boolean;

  /**
   * Placed equipment.
   *
   * A flat list for now. The document model puts placements under
   * `Project → Level → Space`; spaces arrive in Sprint 3 and levels in Sprint 4,
   * and this list migrates under them then. See docs/data-model/PROJECT_MODEL.md.
   */
  readonly placements: readonly Placement[];
  /** Catalogue id armed for placement by the equipment tool. */
  readonly armedEquipmentObjectId: string | null;
  readonly selectedPlacementId: string | null;
  /** Monotonic counter behind placement ids, so ids stay deterministic. */
  readonly nextPlacementNumber: number;
}

export const INITIAL_EDITOR_STATE: EditorState = {
  viewport: createViewport(),
  screen: { width: 0, height: 0 },
  activeTool: 'select',
  showGrid: true,
  snapToGrid: true,
  cursorScreen: null,
  isPanning: false,
  placements: [],
  armedEquipmentObjectId: null,
  selectedPlacementId: null,
  nextPlacementNumber: 1,
};
