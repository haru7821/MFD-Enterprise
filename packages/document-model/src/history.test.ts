import { describe, expect, it } from 'vitest';

import {
  FIXTURE_LEVEL_ID,
  fixtureDocument,
  fixturePlacement,
  fixtureRoomBoundary,
  fixtureSpace,
} from '../fixtures/index';
import {
  createPlacementCommand,
  createSpaceCommand,
  deletePlacementCommand,
  movePlacementCommand,
  rotatePlacementCommand,
} from './commands';
import { findPlacement, requireLevel } from './document';
import {
  MAX_HISTORY_DEPTH,
  MERGE_WINDOW_MS,
  type DocumentState,
  canRedo,
  canUndo,
  createDocumentState,
  execute,
  redo,
  redoLabel,
  seal,
  undo,
  undoLabel,
} from './history';

const LEVEL = FIXTURE_LEVEL_ID;

function start(): DocumentState {
  const state = createDocumentState(fixtureDocument());
  return execute(state, createPlacementCommand(LEVEL, fixturePlacement('p1', { x: 0, y: 0 })), 0);
}

function positionOf(state: DocumentState, id = 'p1') {
  return findPlacement(requireLevel(state.document, LEVEL), id)?.transform.position;
}

describe('undo and redo', () => {
  it('starts with nothing to undo', () => {
    const state = createDocumentState(fixtureDocument());
    expect(canUndo(state.history)).toBe(false);
    expect(canRedo(state.history)).toBe(false);
    expect(undoLabel(state.history)).toBeNull();
  });

  it('reverses the last command', () => {
    const placed = start();
    expect(requireLevel(placed.document, LEVEL).placements).toHaveLength(1);

    const undone = undo(placed);
    expect(requireLevel(undone.document, LEVEL).placements).toHaveLength(0);
    expect(canRedo(undone.history)).toBe(true);
  });

  it('redoes what it undid', () => {
    const placed = start();
    const restored = redo(undo(placed));
    expect(restored.document).toEqual(placed.document);
  });

  it('survives repeated undo and redo without drifting', () => {
    // Each redo recomputes its inverse against current state rather than reusing the
    // original forward command, so ten cycles have to land in the same place as one.
    let state = execute(seal(start()), movePlacementCommand(LEVEL, 'p1', { x: 500, y: 500 }), 100);
    const target = state.document;

    for (let i = 0; i < 10; i += 1) state = redo(undo(state));
    expect(state.document).toEqual(target);
  });

  it('does nothing when there is nothing to undo', () => {
    const state = createDocumentState(fixtureDocument());
    expect(undo(state)).toBe(state);
    expect(redo(state)).toBe(state);
  });

  it('labels what the next undo would reverse', () => {
    const placed = start();
    expect(undoLabel(placed.history)).toBe('Place p1');
    expect(redoLabel(undo(placed).history)).toBe('Place p1');
  });

  it('clears the redo stack on a new edit', () => {
    // An engineer who redoes into a layout they never drew is worse served than one
    // who cannot redo at all.
    const undone = undo(start());
    expect(canRedo(undone.history)).toBe(true);

    const diverged = execute(
      undone,
      createPlacementCommand(LEVEL, fixturePlacement('p2', { x: 1, y: 1 })),
      200,
    );
    expect(canRedo(diverged.history)).toBe(false);
  });
});

describe('coalescing a drag', () => {
  it('collapses a run of moves into one undo step', () => {
    // A drag emits a move per animation frame. Sixty undo steps to get a machine
    // back where it started is not what "undo the move" means.
    let state = seal(start());
    for (let frame = 1; frame <= 60; frame += 1) {
      state = execute(state, movePlacementCommand(LEVEL, 'p1', { x: frame * 10, y: 0 }), frame * 8);
    }

    expect(state.history.past).toHaveLength(2); // the create, plus one merged drag
    expect(positionOf(state)).toEqual({ x: 600, y: 0 });

    // One undo returns to before the drag began, not to the previous frame.
    expect(positionOf(undo(state))).toEqual({ x: 0, y: 0 });
  });

  it('starts a new step once the drag is sealed', () => {
    let state = seal(start());
    state = execute(state, movePlacementCommand(LEVEL, 'p1', { x: 100, y: 0 }), 10);
    state = seal(state);
    state = execute(state, movePlacementCommand(LEVEL, 'p1', { x: 200, y: 0 }), 20);

    expect(state.history.past).toHaveLength(3);
    expect(positionOf(undo(state))).toEqual({ x: 100, y: 0 });
  });

  it('does not merge two different machines', () => {
    let state = execute(
      seal(start()),
      createPlacementCommand(LEVEL, fixturePlacement('p2', { x: 0, y: 0 })),
      10,
    );
    state = execute(state, movePlacementCommand(LEVEL, 'p1', { x: 100, y: 0 }), 20);
    state = execute(state, movePlacementCommand(LEVEL, 'p2', { x: 100, y: 0 }), 25);

    expect(state.history.past).toHaveLength(4);
  });

  it('does not merge across the time window when nothing sealed', () => {
    let state = seal(start());
    state = execute(state, movePlacementCommand(LEVEL, 'p1', { x: 100, y: 0 }), 1_000);
    state = execute(
      state,
      movePlacementCommand(LEVEL, 'p1', { x: 200, y: 0 }),
      1_000 + MERGE_WINDOW_MS + 1,
    );

    expect(state.history.past).toHaveLength(3);
  });

  it('never merges commands that carry no merge key', () => {
    let state = seal(start());
    state = execute(state, deletePlacementCommand(LEVEL, 'p1'), 10);
    state = execute(
      state,
      createPlacementCommand(LEVEL, fixturePlacement('p2', { x: 0, y: 0 })),
      12,
    );
    expect(state.history.past).toHaveLength(3);
  });

  it('merges rotations separately from moves on the same machine', () => {
    let state = seal(start());
    state = execute(state, movePlacementCommand(LEVEL, 'p1', { x: 100, y: 0 }), 10);
    state = execute(state, rotatePlacementCommand(LEVEL, 'p1', 45_000), 12);

    expect(state.history.past).toHaveLength(3);
  });
});

describe('depth', () => {
  it('caps the stack and keeps the most recent steps', () => {
    let state = createDocumentState(fixtureDocument());
    for (let i = 0; i < MAX_HISTORY_DEPTH + 25; i += 1) {
      state = seal(
        execute(
          state,
          createPlacementCommand(LEVEL, fixturePlacement(`p${i}`, { x: i, y: 0 })),
          i * 1_000,
        ),
      );
    }

    expect(state.history.past).toHaveLength(MAX_HISTORY_DEPTH);
    expect(undoLabel(state.history)).toBe(`Place p${MAX_HISTORY_DEPTH + 24}`);
  });
});

describe('multi-entity steps', () => {
  it('undoes a room and its outline together', () => {
    const state = execute(
      seal(start()),
      createSpaceCommand(LEVEL, fixtureRoomBoundary(), fixtureSpace()),
      10,
    );
    const level = requireLevel(undo(state).document, LEVEL);

    expect(level.spaces).toHaveLength(0);
    expect(level.boundaries).toHaveLength(0);
    // The equipment is untouched.
    expect(level.placements).toHaveLength(1);
  });
});
