import {
  chooseGridSpec,
  formatLength,
  screenToWorld,
  snapToStep,
  zoomPercent,
} from '@mfd/cad-engine';

import { getTool } from '@/editor/tools';
import { useEditor } from '@/editor/useEditor';

function formatCoordinate(millimetres: number): string {
  return `${Math.round(millimetres).toLocaleString('en-US')} mm`;
}

function Field({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-ink-faint">{label}</span>
      <span className="font-mono text-ink-muted tabular-nums">{value}</span>
    </span>
  );
}

/**
 * Status bar — the readout that turns the canvas into an instrument.
 *
 * The cursor position is reported after snapping when snap is on, so what the
 * status bar says is what a placed object would actually get.
 */
export function StatusBar() {
  const { state } = useEditor();

  const grid = chooseGridSpec(state.viewport.scale);
  const tool = getTool(state.activeTool);

  // Derived from the live viewport, so the readout stays correct when the view
  // moves under a stationary pointer.
  const cursorWorld = state.cursorScreen
    ? screenToWorld(state.viewport, state.cursorScreen)
    : null;
  const cursor =
    cursorWorld && state.snapToGrid ? snapToStep(cursorWorld, grid.step) : cursorWorld;

  return (
    <footer className="flex items-center gap-4 border-t border-edge bg-chrome px-3 py-1.5 text-[11px]">
      <span className="text-ink-muted">
        <span className="font-medium text-ink">{tool.label}</span>
        <span className="ml-2 text-ink-faint">{tool.hint}</span>
      </span>

      <div className="ml-auto flex items-center gap-4">
        <Field label="X" value={cursor ? formatCoordinate(cursor.x) : '—'} />
        <Field label="Y" value={cursor ? formatCoordinate(cursor.y) : '—'} />
        <Field label="Grid" value={state.showGrid ? formatLength(grid.step) : 'off'} />
        <Field label="Snap" value={state.snapToGrid ? 'on' : 'off'} />
        <Field label="Zoom" value={`${zoomPercent(state.viewport).toFixed(1)}%`} />
      </div>
    </footer>
  );
}
