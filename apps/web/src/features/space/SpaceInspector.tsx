import { SPACE_FUNCTIONS, findBoundary, spaceArea } from '@mfd/document-model';

import { now } from '@/editor/clock';
import { activeLevel, isTracingTool } from '@/editor/editorState';
import { useEditor } from '@/editor/useEditor';

/**
 * The rooms on this level, and the properties of the selected one.
 *
 * `function` is a dropdown rather than a text field because rules select on it. Free
 * text would let "Treatment Rm" and "treatment room" become two different things that
 * no rule matches — and a rule that matches nothing looks exactly like a rule that
 * everything passes.
 */
export function SpaceInspector() {
  const { state, dispatch } = useEditor();
  const level = activeLevel(state);
  const selected = level.spaces.find((space) => space.id === state.selectedSpaceId) ?? null;

  return (
    <section className="border-b border-edge px-3 py-2.5" aria-label="Rooms">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        Rooms
      </h2>

      {level.spaces.length === 0 ? (
        <p className="text-[10px] text-ink-faint">
          Press <span className="font-mono text-ink-muted">R</span> and click to trace a room.
          Click the first point again, or double-click, to close it.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5" data-testid="space-list">
          {level.spaces.map((space) => {
            const area = spaceArea(level, space);
            const isSelected = space.id === state.selectedSpaceId;
            return (
              <li key={space.id}>
                <button
                  type="button"
                  className={`flex w-full items-baseline justify-between gap-2 rounded px-1.5 py-1 text-left text-[11px] ${
                    isSelected
                      ? 'bg-accent/15 text-ink ring-1 ring-accent/50'
                      : 'text-ink-muted hover:bg-white/5'
                  }`}
                  onClick={() => dispatch({ type: 'space/select', spaceId: space.id })}
                >
                  <span className="truncate">{space.name}</span>
                  <span className="shrink-0 font-mono text-[10px] text-ink-faint tabular-nums">
                    {area === null ? '—' : `${(area / 1_000_000).toFixed(1)} m²`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selected && (
        <div className="mt-2 flex flex-col gap-1.5 border-t border-edge pt-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-ink-faint">Name</span>
            <input
              type="text"
              value={selected.name}
              data-testid="space-name"
              className="rounded border border-edge bg-canvas px-1.5 py-0.5 text-[11px] text-ink outline-none focus:border-accent"
              onChange={(event) =>
                dispatch({
                  type: 'space/rename',
                  spaceId: selected.id,
                  name: event.target.value,
                  function: selected.function,
                  at: now(),
                })
              }
              // One editing session, one undo step. Leaving the field is the
              // natural boundary; keystrokes are not.
              onBlur={() => dispatch({ type: 'history/seal' })}
            />
          </label>

          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-ink-faint">Function</span>
            <select
              value={selected.function}
              data-testid="space-function"
              className="rounded border border-edge bg-canvas px-1.5 py-0.5 text-[11px] text-ink outline-none focus:border-accent"
              onChange={(event) =>
                dispatch({
                  type: 'space/rename',
                  spaceId: selected.id,
                  name: selected.name,
                  function: event.target.value as (typeof SPACE_FUNCTIONS)[number],
                  at: now(),
                })
              }
              onBlur={() => dispatch({ type: 'history/seal' })}
            >
              {SPACE_FUNCTIONS.map((value) => (
                <option key={value} value={value}>
                  {value.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>

          <p
            data-testid="space-vertex-count"
            className="font-mono text-[10px] text-ink-faint"
          >
            {findBoundary(level, selected.boundaryId)?.vertices.length ?? 0} vertices ·{' '}
            {isTracingTool(state)
              ? 'press V to reshape it'
              : 'drag a handle to reshape · click a midpoint to add one'}
          </p>

          <button
            type="button"
            data-testid="delete-space"
            className="self-start rounded border border-edge px-1.5 py-0.5 text-[10px] text-ink-faint hover:border-red-500/60 hover:text-red-300"
            onClick={() =>
              dispatch({ type: 'space/delete', spaceId: selected.id, at: now() })
            }
          >
            Delete room
          </button>
          {/* Deleting a room never deletes the machines standing in it — they are
              unassigned instead. Losing equipment because an outline was redrawn is
              not a recoverable mistake. */}
        </div>
      )}
    </section>
  );
}
