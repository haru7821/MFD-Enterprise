import { describe, expect, it } from 'vitest';

import {
  FIXTURE_LEVEL_ID,
  fixtureDocument,
  fixturePlacement,
  fixtureRoomBoundary,
  fixtureSpace,
} from '../fixtures/index';
import {
  type Command,
  assignPlacementSpaceCommand,
  createBoundaryCommand,
  createPlacementCommand,
  createSpaceCommand,
  deletePlacementCommand,
  deleteSpaceCommand,
  movePlacementCommand,
  renameSpaceCommand,
  rotatePlacementCommand,
  setBoundaryVerticesCommand,
} from './commands';
import { findPlacement, findSpace, requireLevel } from './document';
import { EntityNotFoundError } from './errors';
import type { MfdDocument } from './schema';

const LEVEL = FIXTURE_LEVEL_ID;

function withPlacements(): MfdDocument {
  let document = fixtureDocument();
  for (const [index, position] of [
    { x: 0, y: 0 },
    { x: 3_000, y: 0 },
    { x: 6_000, y: 0 },
  ].entries()) {
    document = createPlacementCommand(
      LEVEL,
      fixturePlacement(`p${index + 1}`, position),
    ).apply(document).document;
  }
  return document;
}

function withRoom(): MfdDocument {
  return createSpaceCommand(LEVEL, fixtureRoomBoundary(), fixtureSpace()).apply(
    withPlacements(),
  ).document;
}

/**
 * The invariant every command must satisfy.
 *
 * Applying a command and then its inverse must give back the document byte for byte,
 * not merely one that "looks the same". Anything short of that is a document that
 * quietly changed while an engineer was pressing undo.
 */
function expectRoundTrip(before: MfdDocument, command: Command): MfdDocument {
  const { document: after, inverse } = command.apply(before);
  const restored = inverse.apply(after).document;
  expect(restored).toEqual(before);
  return after;
}

describe('placement commands', () => {
  it('creates a placement and undoes it exactly', () => {
    const before = fixtureDocument();
    const after = expectRoundTrip(
      before,
      createPlacementCommand(LEVEL, fixturePlacement('p1', { x: 100, y: 200 })),
    );
    expect(requireLevel(after, LEVEL).placements).toHaveLength(1);
  });

  it('moves a placement and undoes it exactly', () => {
    const before = withPlacements();
    const after = expectRoundTrip(before, movePlacementCommand(LEVEL, 'p2', { x: 9_999, y: 42 }));
    expect(findPlacement(requireLevel(after, LEVEL), 'p2')?.transform.position).toEqual({
      x: 9_999,
      y: 42,
    });
  });

  it('rotates a placement and undoes it exactly', () => {
    const before = withPlacements();
    const after = expectRoundTrip(before, rotatePlacementCommand(LEVEL, 'p1', 90_000));
    expect(findPlacement(requireLevel(after, LEVEL), 'p1')?.transform.rotation).toBe(90_000);
  });

  it('folds a rotation past a full turn', () => {
    // Four quarter turns must return the transform it started with, or two identical
    // layouts compare as different and a diff shows a change that is not there.
    const document = rotatePlacementCommand(LEVEL, 'p1', 450_000).apply(withPlacements())
      .document;
    expect(findPlacement(requireLevel(document, LEVEL), 'p1')?.transform.rotation).toBe(90_000);
  });

  it('deletes a placement and restores it at its original index', () => {
    // Draw order is what an engineer sees when machines overlap. Undo has to give
    // back the drawing they had, not one that merely contains the same machines.
    const before = withPlacements();
    const after = expectRoundTrip(before, deletePlacementCommand(LEVEL, 'p2'));

    expect(requireLevel(after, LEVEL).placements.map((p) => p.id)).toEqual(['p1', 'p3']);
    const restored = deletePlacementCommand(LEVEL, 'p2').apply(before).inverse.apply(after)
      .document;
    expect(requireLevel(restored, LEVEL).placements.map((p) => p.id)).toEqual([
      'p1',
      'p2',
      'p3',
    ]);
  });

  it('assigns a placement to a room and undoes it exactly', () => {
    const before = withRoom();
    const after = expectRoundTrip(before, assignPlacementSpaceCommand(LEVEL, 'p1', 'space-1'));
    expect(findPlacement(requireLevel(after, LEVEL), 'p1')?.spaceId).toBe('space-1');
  });

  it('names the entity when an id is not in the document', () => {
    expect(() => movePlacementCommand(LEVEL, 'nope', { x: 0, y: 0 }).apply(withPlacements()))
      .toThrow(EntityNotFoundError);
    expect(() => movePlacementCommand('no-level', 'p1', { x: 0, y: 0 }).apply(withPlacements()))
      .toThrow(EntityNotFoundError);
  });

  it('leaves the original document untouched', () => {
    // Commands return a new document. A command that mutated in place would make the
    // history's inverses point at state that no longer exists.
    const before = withPlacements();
    const snapshot = JSON.parse(JSON.stringify(before)) as MfdDocument;
    movePlacementCommand(LEVEL, 'p1', { x: 5, y: 5 }).apply(before);
    expect(before).toEqual(snapshot);
  });
});

describe('boundary commands', () => {
  it('creates a boundary and undoes it exactly', () => {
    const before = fixtureDocument();
    const after = expectRoundTrip(
      before,
      createBoundaryCommand(LEVEL, fixtureRoomBoundary('column-1', 400, 400)),
    );
    expect(requireLevel(after, LEVEL).boundaries).toHaveLength(1);
  });

  it('reshapes a boundary and undoes it exactly', () => {
    const before = withRoom();
    const reshaped = [
      { x: 0, y: 0 },
      { x: 10_000, y: 0 },
      { x: 10_000, y: 6_000 },
      { x: 5_000, y: 6_000 },
      { x: 5_000, y: 9_000 },
      { x: 0, y: 9_000 },
    ];

    const after = expectRoundTrip(before, setBoundaryVerticesCommand(LEVEL, 'boundary-1', reshaped));
    expect(requireLevel(after, LEVEL).boundaries[0]?.vertices).toHaveLength(6);
  });

  it('copies the vertices it is handed', () => {
    // The caller's array is live during a vertex drag. Storing the reference would
    // let the document change under the history.
    const vertices = [
      { x: 0, y: 0 },
      { x: 1_000, y: 0 },
      { x: 1_000, y: 1_000 },
    ];
    const document = setBoundaryVerticesCommand(LEVEL, 'boundary-1', vertices).apply(withRoom())
      .document;
    vertices.push({ x: 0, y: 1_000 });
    expect(requireLevel(document, LEVEL).boundaries[0]?.vertices).toHaveLength(3);
  });
});

describe('space commands', () => {
  it('creates a room and its outline in one undo step', () => {
    // A space with no boundary has no shape; an outline with no space has no name.
    // Two commands would let undo leave one of them behind.
    const before = withPlacements();
    const after = expectRoundTrip(
      before,
      createSpaceCommand(LEVEL, fixtureRoomBoundary(), fixtureSpace()),
    );

    const level = requireLevel(after, LEVEL);
    expect(level.spaces).toHaveLength(1);
    expect(level.boundaries).toHaveLength(1);
  });

  it('renames a room and undoes it exactly', () => {
    const before = withRoom();
    const after = expectRoundTrip(
      before,
      renameSpaceCommand(LEVEL, 'space-1', 'Isolation 1', 'isolation_treatment'),
    );
    expect(findSpace(requireLevel(after, LEVEL), 'space-1')?.function).toBe(
      'isolation_treatment',
    );
  });

  it('does not delete the equipment standing in a deleted room', () => {
    // Losing a machine because a room outline was redrawn is not a recoverable
    // mistake, and it is exactly what an ownership hierarchy would have produced.
    const before = assignPlacementSpaceCommand(LEVEL, 'p1', 'space-1').apply(withRoom())
      .document;
    const after = deleteSpaceCommand(LEVEL, 'space-1').apply(before).document;
    const level = requireLevel(after, LEVEL);

    expect(level.placements).toHaveLength(3);
    expect(findPlacement(level, 'p1')?.spaceId).toBeNull();
    expect(level.spaces).toHaveLength(0);
    expect(level.boundaries).toHaveLength(0);
  });

  it('reattaches the equipment when the room deletion is undone', () => {
    const before = assignPlacementSpaceCommand(LEVEL, 'p1', 'space-1').apply(withRoom())
      .document;
    const after = expectRoundTrip(before, deleteSpaceCommand(LEVEL, 'space-1'));
    expect(requireLevel(after, LEVEL).spaces).toHaveLength(0);
  });
});

describe('command data', () => {
  it('carries a label an engineer can read', () => {
    expect(createPlacementCommand(LEVEL, fixturePlacement('p1', { x: 0, y: 0 })).label).toBe(
      'Place p1',
    );
    expect(deleteSpaceCommand(LEVEL, 'space-1').label).toBe('Delete room');
  });

  it('keys drags on the entity so two machines do not coalesce', () => {
    expect(movePlacementCommand(LEVEL, 'p1', { x: 0, y: 0 }).mergeKey).toBe(
      'placement.move:p1',
    );
    expect(movePlacementCommand(LEVEL, 'p2', { x: 0, y: 0 }).mergeKey).not.toBe(
      movePlacementCommand(LEVEL, 'p1', { x: 0, y: 0 }).mergeKey,
    );
  });

  it('leaves discrete edits unmergeable', () => {
    expect(deletePlacementCommand(LEVEL, 'p1').mergeKey).toBeNull();
    expect(createSpaceCommand(LEVEL, fixtureRoomBoundary(), fixtureSpace()).mergeKey).toBeNull();
  });
});
