import { type Vec2, equals, pixelToModel } from '@mfd/cad-engine';
import { describe, expect, it } from 'vitest';

import {
  FIXTURE_LEVEL_ID,
  FIXTURE_NOW,
  fixtureDocument,
  fixturePlacement,
  fixtureRoomBoundary,
  fixtureSpace,
} from '../fixtures/index';
import {
  type Command,
  assignPlacementSpaceCommand,
  canDeleteLevel,
  canRemoveBoundaryVertex,
  createBoundaryCommand,
  createReferencePointCommand,
  createLevelCommand,
  createPlacementCommand,
  createSpaceCommand,
  deleteLevelCommand,
  deletePlacementCommand,
  deleteReferencePointCommand,
  deleteSpaceCommand,
  describeBoundaryCommand,
  insertBoundaryVertexCommand,
  moveBoundaryVertexCommand,
  moveReferencePointCommand,
  movePlacementCommand,
  removeBoundaryVertexCommand,
  renameLevelCommand,
  relabelReferencePointCommand,
  renameSpaceCommand,
  rotatePlacementCommand,
  setBoundaryVerticesCommand,
  setPlanOriginCommand,
} from './commands';
import { createObstruction, findPlacement, findSpace, requireLevel } from './document';
import {
  calibrateFromTwoPoints,
  planTransformOf,
  setCoordinateMapping,
  setMappingRotation,
} from './plan';
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

describe('reference point commands', () => {
  const DRAIN = {
    id: 'rp1',
    kind: 'drain' as const,
    position: { x: 1_200, y: 3_400 },
    label: null,
  };
  const PANEL = {
    id: 'rp2',
    kind: 'electrical_panel' as const,
    position: { x: 8_000, y: 200 },
    label: 'DB-3F-2',
  };

  function withPoints(): MfdDocument {
    let document = fixtureDocument();
    for (const point of [DRAIN, PANEL]) {
      document = createReferencePointCommand(LEVEL, point).apply(document).document;
    }
    return document;
  }

  it('places a point and undoes it exactly', () => {
    const after = expectRoundTrip(fixtureDocument(), createReferencePointCommand(LEVEL, DRAIN));
    expect(requireLevel(after, LEVEL).referencePoints).toEqual([DRAIN]);
  });

  it('moves a point and undoes it exactly', () => {
    // Worth an undo test of its own rather than trusting the shared invariant: moving one of these
    // changes four scoring criteria for every machine on the floor, so an engineer who nudges a
    // panel by a metre has to be able to get the original position back rather than re-place it by
    // eye.
    const after = expectRoundTrip(withPoints(), moveReferencePointCommand(LEVEL, 'rp1', { x: 0, y: 0 }));
    expect(requireLevel(after, LEVEL).referencePoints[0]?.position).toEqual({ x: 0, y: 0 });
  });

  it('relabels a point and undoes it exactly, including back to null', () => {
    const named = expectRoundTrip(withPoints(), relabelReferencePointCommand(LEVEL, 'rp1', 'Stack A'));
    expect(requireLevel(named, LEVEL).referencePoints[0]?.label).toBe('Stack A');

    // And the other direction: an engineer clearing a label gets null back, not an empty string.
    const cleared = expectRoundTrip(withPoints(), relabelReferencePointCommand(LEVEL, 'rp2', null));
    expect(requireLevel(cleared, LEVEL).referencePoints[1]?.label).toBeNull();
  });

  it('deletes a point and restores it at its original index', () => {
    // The properties panel lists these in order, so undo that appended would silently rearrange
    // what the engineer is looking at.
    const after = expectRoundTrip(withPoints(), deleteReferencePointCommand(LEVEL, 'rp1'));
    expect(requireLevel(after, LEVEL).referencePoints).toEqual([PANEL]);
  });

  it('refuses to move a point that is not there', () => {
    expect(() => moveReferencePointCommand(LEVEL, 'missing', { x: 0, y: 0 }).apply(withPoints()))
      .toThrow(/reference point/);
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

  it('keys a reference-point drag on the point, like a machine drag', () => {
    expect(moveReferencePointCommand(LEVEL, 'rp1', { x: 0, y: 0 }).mergeKey).toBe(
      'referencePoint.move:rp1',
    );
    expect(moveReferencePointCommand(LEVEL, 'rp2', { x: 0, y: 0 }).mergeKey).not.toBe(
      moveReferencePointCommand(LEVEL, 'rp1', { x: 0, y: 0 }).mergeKey,
    );
  });

  it('leaves discrete edits unmergeable', () => {
    expect(deletePlacementCommand(LEVEL, 'p1').mergeKey).toBeNull();
    expect(createReferencePointCommand(LEVEL, {
      id: 'rp1', kind: 'drain', position: { x: 0, y: 0 }, label: null,
    }).mergeKey).toBeNull();
    expect(createSpaceCommand(LEVEL, fixtureRoomBoundary(), fixtureSpace()).mergeKey).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Boundary vertex editing
// ---------------------------------------------------------------------------

describe('boundary vertex editing', () => {
  it('moves one vertex and undoes it exactly', () => {
    const before = withRoom();
    const after = expectRoundTrip(
      before,
      moveBoundaryVertexCommand(LEVEL, 'boundary-1', 2, { x: 12_000, y: 9_000 }),
    );
    expect(requireLevel(after, LEVEL).boundaries[0]?.vertices[2]).toEqual({
      x: 12_000,
      y: 9_000,
    });
  });

  it('coalesces a vertex drag but keeps two vertices apart', () => {
    expect(moveBoundaryVertexCommand(LEVEL, 'b', 0, { x: 0, y: 0 }).mergeKey).toBe(
      'boundary.vertex:b:0',
    );
    expect(moveBoundaryVertexCommand(LEVEL, 'b', 1, { x: 0, y: 0 }).mergeKey).not.toBe(
      moveBoundaryVertexCommand(LEVEL, 'b', 0, { x: 0, y: 0 }).mergeKey,
    );
  });

  it('inserts a vertex after the edge it was placed on', () => {
    // "After" rather than "at": the caller has hit-tested an edge, and an edge is
    // identified by the vertex it leaves.
    const before = withRoom();
    const after = expectRoundTrip(
      before,
      insertBoundaryVertexCommand(LEVEL, 'boundary-1', 0, { x: 4_000, y: 0 }),
    );

    const vertices = requireLevel(after, LEVEL).boundaries[0]?.vertices ?? [];
    expect(vertices).toHaveLength(5);
    expect(vertices[1]).toEqual({ x: 4_000, y: 0 });
  });

  it('inserts on the closing edge without a special case', () => {
    const before = withRoom();
    const last = (requireLevel(before, LEVEL).boundaries[0]?.vertices.length ?? 0) - 1;
    const after = insertBoundaryVertexCommand(LEVEL, 'boundary-1', last, {
      x: 0,
      y: 3_000,
    }).apply(before).document;

    const vertices = requireLevel(after, LEVEL).boundaries[0]?.vertices ?? [];
    expect(vertices).toHaveLength(5);
    expect(vertices[4]).toEqual({ x: 0, y: 3_000 });
  });

  it('removes a vertex and undoes it exactly', () => {
    const before = insertBoundaryVertexCommand(LEVEL, 'boundary-1', 0, {
      x: 4_000,
      y: 0,
    }).apply(withRoom()).document;

    const after = expectRoundTrip(before, removeBoundaryVertexCommand(LEVEL, 'boundary-1', 1));
    expect(requireLevel(after, LEVEL).boundaries[0]?.vertices).toHaveLength(4);
  });

  it('refuses to leave a ring that encloses nothing', () => {
    // A two-vertex "room" would report every machine in the building as outside it.
    const triangle = setBoundaryVerticesCommand(LEVEL, 'boundary-1', [
      { x: 0, y: 0 },
      { x: 1_000, y: 0 },
      { x: 1_000, y: 1_000 },
    ]).apply(withRoom()).document;

    const boundary = requireLevel(triangle, LEVEL).boundaries[0];
    expect(boundary && canRemoveBoundaryVertex(boundary)).toBe(false);

    const after = removeBoundaryVertexCommand(LEVEL, 'boundary-1', 0).apply(triangle).document;
    expect(requireLevel(after, LEVEL).boundaries[0]?.vertices).toHaveLength(3);
  });

  it('treats an out-of-range index as a no-op rather than corrupting the ring', () => {
    const before = withRoom();
    const after = moveBoundaryVertexCommand(LEVEL, 'boundary-1', 99, { x: 1, y: 1 }).apply(
      before,
    ).document;
    expect(after).toEqual(before);
  });
});

describe('describing an obstruction', () => {
  function withColumn(): MfdDocument {
    return createBoundaryCommand(
      LEVEL,
      createObstruction('column-1', 'other', [
        { x: 0, y: 0 },
        { x: 400, y: 0 },
        { x: 400, y: 400 },
        { x: 0, y: 400 },
      ]),
    ).apply(fixtureDocument()).document;
  }

  it('sets the label and the type in one undo step', () => {
    // An engineer correcting "obstruction 3" to "Column C4" is usually setting its
    // type in the same breath.
    const before = withColumn();
    const after = expectRoundTrip(
      before,
      describeBoundaryCommand(LEVEL, 'column-1', 'Column C4', 'column'),
    );

    const boundary = requireLevel(after, LEVEL).boundaries[0];
    expect(boundary?.label).toBe('Column C4');
    expect(boundary?.obstructionType).toBe('column');
  });
});

// ---------------------------------------------------------------------------
// Plan origin
// ---------------------------------------------------------------------------

describe('setting the drawing origin', () => {
  /** A calibrated level at 10 mm/px, with a machine and a room on it. */
  function calibrated(): MfdDocument {
    const mapping = calibrateFromTwoPoints({
      pointA: { x: 0, y: 0 },
      pointB: { x: 100, y: 0 },
      knownDistance: 1_000,
      now: FIXTURE_NOW,
    });
    return setCoordinateMapping(withRoom(), LEVEL, mapping);
  }

  it('records the new origin', () => {
    const after = setPlanOriginCommand(LEVEL, { x: 100, y: 50 }).apply(calibrated()).document;
    expect(requireLevel(after, LEVEL).coordinateMapping?.origin).toEqual({ x: 100, y: 50 });
  });

  it('renumbers the layout instead of sliding the plan out from under it', () => {
    // 10 mm/px, origin moved 100 px right and 50 px down: everything on the drawing
    // must keep its position relative to the drawing, so its coordinates drop by
    // 1,000 mm and 500 mm.
    const before = calibrated();
    const p1 = findPlacement(requireLevel(before, LEVEL), 'p1');
    expect(p1?.transform.position).toEqual({ x: 0, y: 0 });

    const after = setPlanOriginCommand(LEVEL, { x: 100, y: 50 }).apply(before).document;
    expect(findPlacement(requireLevel(after, LEVEL), 'p1')?.transform.position).toEqual({
      x: -1_000,
      y: -500,
    });
  });

  it('moves boundary vertices by the same amount, so the room stays on the room', () => {
    const after = setPlanOriginCommand(LEVEL, { x: 100, y: 50 }).apply(calibrated()).document;
    expect(requireLevel(after, LEVEL).boundaries[0]?.vertices[0]).toEqual({
      x: -1_000,
      y: -500,
    });
  });

  it('keeps every machine in the same room it was in', () => {
    // The whole point of translating rather than just re-datuming: the layout's
    // geometry relative to the building is unchanged, so no verdict changes.
    const before = calibrated();
    const after = setPlanOriginCommand(LEVEL, { x: 250, y: -75 }).apply(before).document;

    const beforeLevel = requireLevel(before, LEVEL);
    const afterLevel = requireLevel(after, LEVEL);
    const room = (level: typeof beforeLevel) => level.boundaries[0]?.vertices ?? [];

    for (const placement of beforeLevel.placements) {
      const moved = findPlacement(afterLevel, placement.id);
      expect(moved).not.toBeNull();
      // Position relative to the room's first vertex is preserved exactly.
      const beforeOffset = {
        x: placement.transform.position.x - (room(beforeLevel)[0]?.x ?? 0),
        y: placement.transform.position.y - (room(beforeLevel)[0]?.y ?? 0),
      };
      const afterOffset = {
        x: (moved?.transform.position.x ?? 0) - (room(afterLevel)[0]?.x ?? 0),
        y: (moved?.transform.position.y ?? 0) - (room(afterLevel)[0]?.y ?? 0),
      };
      expect(afterOffset).toEqual(beforeOffset);
    }
  });

  it('undoes exactly', () => {
    expectRoundTrip(calibrated(), setPlanOriginCommand(LEVEL, { x: 640, y: -120 }));
  });

  it('undoes exactly on a rotated plan', () => {
    const turned = setMappingRotation(calibrated(), LEVEL, 30_000);
    expectRoundTrip(turned, setPlanOriginCommand(LEVEL, { x: 400, y: 250 }));
  });

  /**
   * The invariant a round trip cannot check.
   *
   * `expectRoundTrip` is blind to a rotation-sign error here, because the inverse
   * command recomputes its own delta with the same convention — and
   * `delta(A→B) = −delta(B→A)` whichever way the rotation is applied, so the two
   * always cancel. Verified by temporarily flipping the sign: the round-trip tests
   * stayed green.
   *
   * What actually pins it down is the forward direction: an entity sitting over a
   * given pixel of the drawing must still be over that pixel afterwards. That is
   * checked against `pixelToModel` rather than against the command's own arithmetic.
   */
  function stillOverTheSamePixel(rotationMillidegrees: number, pixel: Vec2): void {
    const base = setMappingRotation(calibrated(), LEVEL, rotationMillidegrees);
    const oldTransform = planTransformOf(requireLevel(base, LEVEL));
    expect(oldTransform).not.toBeNull();
    if (!oldTransform) return;

    // Put a machine exactly over `pixel` on the drawing.
    const seated = movePlacementCommand(LEVEL, 'p1', pixelToModel(oldTransform, pixel)).apply(
      base,
    ).document;

    const newOriginPixel = { x: 137, y: -64 };
    const after = setPlanOriginCommand(LEVEL, newOriginPixel).apply(seated).document;
    const newTransform = planTransformOf(requireLevel(after, LEVEL));
    expect(newTransform).not.toBeNull();
    if (!newTransform) return;

    const expected = pixelToModel(newTransform, pixel);
    const actual = findPlacement(requireLevel(after, LEVEL), 'p1')?.transform.position;
    expect(actual).not.toBeUndefined();
    expect(equals(actual ?? { x: 0, y: 0 }, expected, 1e-6)).toBe(true);
  }

  it('leaves a machine over the same pixel of the drawing, square to the page', () => {
    stillOverTheSamePixel(0, { x: 820, y: 410 });
  });

  it('leaves a machine over the same pixel of the drawing, on a rotated plan', () => {
    // The case that catches a rotation-sign or ordering error.
    stillOverTheSamePixel(30_000, { x: 820, y: 410 });
    stillOverTheSamePixel(-137_500, { x: -220, y: 990 });
  });

  it('is a no-op on a level with no coordinate mapping', () => {
    // There is nothing to be the origin of until a scale exists.
    const before = withRoom();
    const after = setPlanOriginCommand(LEVEL, { x: 100, y: 100 }).apply(before).document;
    expect(after).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

describe('levels', () => {
  it('adds a level and undoes it exactly', () => {
    const before = fixtureDocument();
    const after = expectRoundTrip(before, createLevelCommand('level-2', '4F', 4_000));

    expect(after.project.levels.map((level) => level.id)).toEqual([LEVEL, 'level-2']);
    expect(after.project.levels[1]?.name).toBe('4F');
  });

  it('renames a level and undoes it exactly', () => {
    const before = fixtureDocument();
    const after = expectRoundTrip(before, renameLevelCommand(LEVEL, 'Third floor', 7_500));
    expect(after.project.levels[0]?.name).toBe('Third floor');
    expect(after.project.levels[0]?.elevation).toBe(7_500);
  });

  it('deletes a level whole, and restores it whole at its original position', () => {
    // The most destructive command in the set, which is exactly why it is a command:
    // a floor holding machines and a calibrated plan comes back intact.
    let before = createLevelCommand('level-2', '4F').apply(withRoom()).document;
    before = createLevelCommand('level-3', '5F').apply(before).document;

    const after = expectRoundTrip(before, deleteLevelCommand('level-2'));
    expect(after.project.levels.map((level) => level.id)).toEqual([LEVEL, 'level-3']);

    const restored = deleteLevelCommand('level-2').apply(before).inverse.apply(after).document;
    expect(restored.project.levels.map((level) => level.id)).toEqual([
      LEVEL,
      'level-2',
      'level-3',
    ]);
  });

  it('refuses to delete the last level', () => {
    // A project with no floor is not a project, and the schema requires at least one.
    // A no-op rather than a throw: the UI offering the control is the thing to fix.
    const before = withRoom();
    expect(canDeleteLevel(before)).toBe(false);
    expect(deleteLevelCommand(LEVEL).apply(before).document).toEqual(before);
  });

  it('allows deleting once a second level exists', () => {
    const two = createLevelCommand('level-2', '4F').apply(fixtureDocument()).document;
    expect(canDeleteLevel(two)).toBe(true);
  });
});
