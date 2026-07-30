import { OBSTRUCTION_TYPES, canRemoveBoundaryVertex, obstructionBoundaries } from '@mfd/document-model';
import { polygonArea } from '@mfd/cad-engine';

import { now } from '@/editor/clock';
import { activeLevel, isTracingTool, selectedBoundary } from '@/editor/editorState';
import { useEditor } from '@/editor/useEditor';

/**
 * Columns, shafts and fixed obstacles, and the properties of the selected one.
 *
 * `obstructionType` is a dropdown and not free text, but for a different reason than the
 * room function: nothing selects on it. It appears in the report and in this list, and a
 * controlled vocabulary is what lets a report group "3 columns, 1 riser" rather than
 * printing whatever wording each engineer happened to use.
 *
 * The type does **not** change what is checked. Whether equipment may overlap an
 * obstruction is `kind`, which the rule engine reads; the type is description. Keeping
 * them apart is why adding a new type needs no evaluator change — and why an
 * unrecognised one could never silently stop being checked.
 */
export function ObstructionInspector() {
  const { state, dispatch } = useEditor();
  const level = activeLevel(state);
  const obstructions = obstructionBoundaries(level);
  const selected = selectedBoundary(state);
  const isObstruction = selected?.kind === 'obstruction';

  return (
    <section className="border-b border-edge px-3 py-2.5" aria-label="Obstructions">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        Obstructions
      </h2>

      {obstructions.length === 0 ? (
        <p className="text-[10px] text-ink-faint">
          Press <span className="font-mono text-ink-muted">O</span> and click to trace a
          column, shaft or fixed obstacle. Equipment must not overlap one.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5" data-testid="obstruction-list">
          {obstructions.map((boundary) => (
            <li key={boundary.id}>
              <button
                type="button"
                className={`flex w-full items-baseline justify-between gap-2 rounded px-1.5 py-1 text-left text-[11px] ${
                  boundary.id === state.selectedBoundaryId
                    ? 'bg-accent/15 text-ink ring-1 ring-accent/50'
                    : 'text-ink-muted hover:bg-white/5'
                }`}
                onClick={() => dispatch({ type: 'boundary/select', boundaryId: boundary.id })}
              >
                <span className="truncate">{boundary.label || boundary.id}</span>
                <span className="shrink-0 font-mono text-[10px] text-ink-faint tabular-nums">
                  {(polygonArea(boundary.vertices) / 1_000_000).toFixed(2)} m²
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 border-t border-edge pt-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-ink-faint">New obstruction is a</span>
          <select
            value={state.draftObstructionType}
            data-testid="draft-obstruction-type"
            className="rounded border border-edge bg-canvas px-1.5 py-0.5 text-[11px] text-ink outline-none focus:border-accent"
            onChange={(event) =>
              dispatch({
                type: 'obstruction/setType',
                obstructionType: event.target.value as (typeof OBSTRUCTION_TYPES)[number],
              })
            }
          >
            {OBSTRUCTION_TYPES.map((value) => (
              <option key={value} value={value}>
                {value.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>
      </div>

      {isObstruction && selected && (
        <div className="mt-2 flex flex-col gap-1.5 border-t border-edge pt-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-ink-faint">Label</span>
            <input
              type="text"
              value={selected.label}
              data-testid="obstruction-label"
              className="rounded border border-edge bg-canvas px-1.5 py-0.5 text-[11px] text-ink outline-none focus:border-accent"
              onChange={(event) =>
                dispatch({
                  type: 'boundary/describe',
                  boundaryId: selected.id,
                  label: event.target.value,
                  obstructionType: selected.obstructionType,
                  at: now(),
                })
              }
              onBlur={() => dispatch({ type: 'history/seal' })}
            />
          </label>

          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-ink-faint">Type</span>
            <select
              value={selected.obstructionType ?? 'other'}
              data-testid="obstruction-type"
              className="rounded border border-edge bg-canvas px-1.5 py-0.5 text-[11px] text-ink outline-none focus:border-accent"
              onChange={(event) =>
                dispatch({
                  type: 'boundary/describe',
                  boundaryId: selected.id,
                  label: selected.label,
                  obstructionType: event.target.value as (typeof OBSTRUCTION_TYPES)[number],
                  at: now(),
                })
              }
              onBlur={() => dispatch({ type: 'history/seal' })}
            >
              {OBSTRUCTION_TYPES.map((value) => (
                <option key={value} value={value}>
                  {value.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            data-testid="delete-obstruction"
            className="self-start rounded border border-edge px-1.5 py-0.5 text-[10px] text-ink-faint hover:border-red-500/60 hover:text-red-300"
            onClick={() =>
              dispatch({ type: 'boundary/delete', boundaryId: selected.id, at: now() })
            }
          >
            Delete obstruction
          </button>
        </div>
      )}

      {/*
        Only for an obstruction. A room's boundary is described by the room inspector,
        and having both panels report the same vertex count left two places to read one
        fact — which is one more than can stay in step.
      */}
      {isObstruction && selected && (
        <p
          data-testid="obstruction-vertex-count"
          className="mt-1.5 font-mono text-[10px] text-ink-faint"
        >
          {selected.vertices.length} vertices ·{' '}
          {isTracingTool(state)
            ? 'press V to reshape it'
            : canRemoveBoundaryVertex(selected)
              ? 'drag a handle to reshape · click a midpoint to add one · Delete removes the selected one'
              : 'drag a handle to reshape · click a midpoint to add one · three is the minimum'}
        </p>
      )}
    </section>
  );
}
