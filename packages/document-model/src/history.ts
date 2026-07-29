import type { Command } from './commands';
import type { MfdDocument } from './schema';

/**
 * The undo stack.
 *
 * A plain reducer over immutable state, so the editor can hold it in the same place
 * it holds everything else and a test can drive it without a UI.
 *
 * ## Coalescing
 *
 * A pointer drag emits a move command per animation frame. Sixty undo steps to get a
 * machine back where it started is not what "undo the move" means, so consecutive
 * commands that share a `mergeKey` and land within {@link MERGE_WINDOW_MS} of each
 * other become one entry: the newest forward command, and the **oldest** inverse —
 * the one that goes back to before the drag began.
 *
 * The time window is a backstop, not the primary mechanism. The editor calls
 * {@link seal} on pointer-up, which is precise; the window only catches the case
 * where nothing sealed and two unrelated edits would otherwise merge.
 *
 * ## Depth
 *
 * Capped at {@link MAX_HISTORY_DEPTH}. Each entry is a pair of small command objects
 * — ids and numbers — so the cap is about bounding a session that runs all day, not
 * about memory pressure from any single step. Snapshot undo would have needed a cap
 * two orders of magnitude tighter, because a level embeds its floor plan.
 */

export const MERGE_WINDOW_MS = 300;
export const MAX_HISTORY_DEPTH = 200;

export interface HistoryEntry {
  readonly command: Command;
  readonly inverse: Command;
  /** Milliseconds since the epoch, supplied by the caller. */
  readonly at: number;
}

export interface History {
  readonly past: readonly HistoryEntry[];
  readonly future: readonly HistoryEntry[];
  /** True when the next push must start a new entry rather than merge. */
  readonly sealed: boolean;
}

export const EMPTY_HISTORY: History = Object.freeze({
  past: Object.freeze([]),
  future: Object.freeze([]),
  sealed: true,
});

export interface DocumentState {
  readonly document: MfdDocument;
  readonly history: History;
}

export function canUndo(history: History): boolean {
  return history.past.length > 0;
}

export function canRedo(history: History): boolean {
  return history.future.length > 0;
}

/** What the next undo would reverse, for the menu label. Null when there is nothing. */
export function undoLabel(history: History): string | null {
  return history.past[history.past.length - 1]?.command.label ?? null;
}

export function redoLabel(history: History): string | null {
  return history.future[history.future.length - 1]?.command.label ?? null;
}

function trim(entries: readonly HistoryEntry[]): readonly HistoryEntry[] {
  return entries.length > MAX_HISTORY_DEPTH
    ? entries.slice(entries.length - MAX_HISTORY_DEPTH)
    : entries;
}

function mergesWith(previous: HistoryEntry | undefined, command: Command, at: number): boolean {
  if (!previous || command.mergeKey === null) return false;
  return previous.command.mergeKey === command.mergeKey && at - previous.at <= MERGE_WINDOW_MS;
}

/**
 * Apply a command and record it.
 *
 * `at` is passed in rather than read from a clock: a reducer that calls `Date.now()`
 * cannot be replayed, and replaying the command log is how a collaborative session
 * and a reproducible report both work.
 *
 * A new edit clears the redo stack. Branching histories are a research project and
 * an engineer who redoes into a layout they never drew is worse served than one who
 * cannot redo at all.
 */
export function execute(state: DocumentState, command: Command, at: number): DocumentState {
  const { document, inverse } = command.apply(state.document);
  const previous = state.history.past[state.history.past.length - 1];

  if (!state.history.sealed && mergesWith(previous, command, at) && previous) {
    const merged: HistoryEntry = {
      command,
      // The oldest inverse in the run: undoing a drag returns to where it started,
      // not to the previous animation frame.
      inverse: previous.inverse,
      at,
    };

    return {
      document,
      history: {
        past: [...state.history.past.slice(0, -1), merged],
        future: [],
        sealed: false,
      },
    };
  }

  return {
    document,
    history: {
      past: trim([...state.history.past, { command, inverse, at }]),
      future: [],
      sealed: false,
    },
  };
}

/**
 * Close the current undo entry, so the next command starts a new one.
 *
 * Called on pointer-up. One drag, one undo step.
 */
export function seal(state: DocumentState): DocumentState {
  return state.history.sealed
    ? state
    : { ...state, history: { ...state.history, sealed: true } };
}

export function undo(state: DocumentState): DocumentState {
  const entry = state.history.past[state.history.past.length - 1];
  if (!entry) return state;

  const { document, inverse } = entry.inverse.apply(state.document);

  return {
    document,
    history: {
      past: state.history.past.slice(0, -1),
      // The redo entry carries the inverse computed just now, against the state the
      // undo produced. Reusing the original forward command would be wrong the moment
      // an entity's index changed.
      future: [...state.history.future, { command: entry.command, inverse, at: entry.at }],
      sealed: true,
    },
  };
}

export function redo(state: DocumentState): DocumentState {
  const entry = state.history.future[state.history.future.length - 1];
  if (!entry) return state;

  const { document, inverse } = entry.inverse.apply(state.document);

  return {
    document,
    history: {
      past: trim([...state.history.past, { command: entry.command, inverse, at: entry.at }]),
      future: state.history.future.slice(0, -1),
      sealed: true,
    },
  };
}

export function createDocumentState(document: MfdDocument): DocumentState {
  return { document, history: EMPTY_HISTORY };
}
