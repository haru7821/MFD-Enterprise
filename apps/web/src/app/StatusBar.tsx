import {
  chooseGridSpec,
  formatLength,
  screenToWorld,
  snapToStep,
  zoomPercent,
} from '@mfd/cad-engine';
import { obstructionBoundaries } from '@mfd/document-model';
import { catalog } from '@mfd/object-library/catalog';
import type { EvaluationReport } from '@mfd/rule-engine';

import { activeLevel, isTracingTool, planStatusOf } from '@/editor/editorState';
import { getTool } from '@/editor/tools';
import { useEditor } from '@/editor/useEditor';

function formatCoordinate(millimetres: number): string {
  return `${Math.round(millimetres).toLocaleString('en-US')} mm`;
}

/**
 * Label and value are separated visually by a CSS gap, so the DOM text runs them
 * together as "Placed1". The value carries its own test hook rather than making
 * assertions depend on how the row happens to be spaced.
 */
function Field({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-ink-faint">{label}</span>
      <span
        data-testid={`field-${label.toLowerCase()}`}
        className="font-mono text-ink-muted tabular-nums"
      >
        {value}
      </span>
    </span>
  );
}

/**
 * Status bar — the readout that turns the canvas into an instrument.
 *
 * The cursor position is reported after snapping when snap is on, so what the
 * status bar says is what a placed object would actually get.
 */
export function StatusBar({ report }: { readonly report: EvaluationReport }) {
  const { state } = useEditor();
  const level = activeLevel(state);

  const grid = chooseGridSpec(state.viewport.scale);
  const tool = getTool(state.activeTool);

  // Derived from the live viewport, so the readout stays correct when the view
  // moves under a stationary pointer.
  const cursorWorld = state.cursorScreen
    ? screenToWorld(state.viewport, state.cursorScreen)
    : null;
  const cursor =
    cursorWorld && state.snapToGrid ? snapToStep(cursorWorld, grid.step) : cursorWorld;

  // Counted from the catalogue rather than stored on the placement: if a record is
  // upgraded from draft to verified, every placement of it stops being flagged with
  // no migration.
  const draftPlacementCount = level.placements.filter(
    (placement) => catalog.get(placement.equipmentObjectId)?.dataStatus === 'draft',
  ).length;

  const planStatus = planStatusOf(level);

  return (
    <footer
      data-testid="status-bar"
      className="flex items-center gap-4 border-t border-edge bg-chrome px-3 py-1.5 text-[11px]"
    >
      <span className="text-ink-muted">
        <span className="font-medium text-ink">{tool.label}</span>
        <span className="ml-2 text-ink-faint">
          {state.pick?.kind === 'origin'
            ? 'Click the drawing to set model (0, 0)'
            : state.pick?.kind === 'calibrate'
              ? 'Click two points a known distance apart'
              : state.selectedVertex
                ? 'Drag to move · Delete removes · Escape deselects'
                : state.selectedBoundaryId && !isTracingTool(state)
                  ? 'Drag a handle to reshape · click a midpoint to add a vertex'
                  : state.selectedPlacementId
                    ? 'Drag to move · [ and ] rotate a quarter turn · Delete removes'
                    : tool.hint}
        </span>
      </span>

      {draftPlacementCount > 0 && (
        <span
          data-testid="draft-placement-warning"
          className="rounded-sm border border-amber-500/50 bg-amber-500/10 px-1.5 py-px text-[10px] font-medium text-amber-300"
          title="These objects use placeholder figures, not manual values. No result computed from them can be treated as verified."
        >
          {draftPlacementCount === 1
            ? '1 placed object uses draft data'
            : `${draftPlacementCount} placed objects use draft data`}
        </span>
      )}

      {planStatus === 'uncalibrated' && (
        <span
          data-testid="plan-uncalibrated-warning"
          className="rounded-sm border border-amber-500/50 bg-amber-500/10 px-1.5 py-px text-[10px] font-medium text-amber-300"
          title="Set the drawing scale before trusting any measurement taken from it."
        >
          plan not calibrated
        </span>
      )}

      {(report.counts.RED > 0 || report.counts.YELLOW > 0) && (
        <span
          data-testid="findings-summary"
          className="font-mono text-[10px] tabular-nums"
          title="Installation requirement findings"
        >
          <span className="text-red-300">{report.counts.RED} RED</span>
          <span className="mx-1 text-ink-faint">·</span>
          <span className="text-amber-300">{report.counts.YELLOW} YELLOW</span>
        </span>
      )}

      <div className="ml-auto flex items-center gap-4">
        <Field label="Level" value={level.name} />
        <Field label="Placed" value={`${level.placements.length}`} />
        <Field label="Rooms" value={`${level.spaces.length}`} />
        <Field label="Obstructions" value={`${obstructionBoundaries(level).length}`} />
        <Field label="X" value={cursor ? formatCoordinate(cursor.x) : '—'} />
        <Field label="Y" value={cursor ? formatCoordinate(cursor.y) : '—'} />
        <Field label="Grid" value={state.showGrid ? formatLength(grid.step) : 'off'} />
        <Field label="Snap" value={state.snapToGrid ? 'on' : 'off'} />
        <Field label="Zoom" value={`${zoomPercent(state.viewport).toFixed(1)}%`} />
      </div>
    </footer>
  );
}
