import { canDeleteLevel, levelSummary } from '@mfd/document-model';

import { now } from '@/editor/clock';
import { activeLevel } from '@/editor/editorState';
import { useEditor } from '@/editor/useEditor';

/**
 * Which floor is being reviewed.
 *
 * A `<select>` rather than tabs: a hospital wing runs to more floors than a tab strip
 * holds, and a strip that scrolls sideways is worse than a list that does not.
 *
 * Deleting a level takes everything on it — machines, rooms, the calibrated plan. That
 * is why it is a command with an inverse rather than a confirmation dialogue: undo is a
 * better answer than a question nobody reads, and it is the answer for the case a
 * dialogue cannot cover, which is meaning to say yes and being wrong about which floor
 * was selected.
 */
export function LevelPanel() {
  const { state, dispatch } = useEditor();
  const level = activeLevel(state);
  const levels = state.doc.document.project.levels;
  const summary = levelSummary(level);
  const canDelete = canDeleteLevel(state.doc.document);

  return (
    <section className="border-b border-edge px-3 py-2.5" aria-label="Level">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          Level
        </h2>
        <span className="font-mono text-[10px] text-ink-faint tabular-nums">
          {levels.length} of {levels.length === 1 ? '1 floor' : `${levels.length} floors`}
        </span>
      </div>

      <select
        value={level.id}
        data-testid="level-select"
        aria-label="Active level"
        className="w-full rounded border border-edge bg-canvas px-1.5 py-1 text-[11px] text-ink outline-none focus:border-accent"
        onChange={(event) => dispatch({ type: 'level/select', levelId: event.target.value })}
      >
        {levels.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name}
          </option>
        ))}
      </select>

      <label className="mt-1.5 flex flex-col gap-0.5">
        <span className="text-[10px] text-ink-faint">Name</span>
        <input
          type="text"
          value={level.name}
          data-testid="level-name"
          className="rounded border border-edge bg-canvas px-1.5 py-0.5 text-[11px] text-ink outline-none focus:border-accent"
          onChange={(event) =>
            dispatch({
              type: 'level/rename',
              levelId: level.id,
              name: event.target.value,
              elevation: level.elevation,
              at: now(),
            })
          }
          // One editing session, one undo step.
          onBlur={() => dispatch({ type: 'history/seal' })}
        />
      </label>

      <p className="mt-1 font-mono text-[10px] text-ink-faint">
        {summary.placements} equipment · {summary.spaces} room
        {summary.spaces === 1 ? '' : 's'} · {summary.obstructions} obstruction
        {summary.obstructions === 1 ? '' : 's'}
      </p>

      <div className="mt-1.5 flex gap-1.5">
        <button
          type="button"
          data-testid="add-level"
          className="rounded border border-edge px-1.5 py-0.5 text-[10px] text-ink-muted hover:border-accent hover:text-ink"
          onClick={() =>
            dispatch({ type: 'level/add', name: `Level ${levels.length + 1}`, at: now() })
          }
        >
          Add level
        </button>
        <button
          type="button"
          data-testid="delete-level"
          disabled={!canDelete}
          title={canDelete ? undefined : 'A project needs at least one floor'}
          className="rounded border border-edge px-1.5 py-0.5 text-[10px] text-ink-faint hover:border-red-500/60 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => dispatch({ type: 'level/delete', levelId: level.id, at: now() })}
        >
          Delete level
        </button>
      </div>
    </section>
  );
}
