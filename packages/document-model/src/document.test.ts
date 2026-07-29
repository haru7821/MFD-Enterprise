import { describe, expect, it } from 'vitest';

import { FIXTURE_LEVEL_ID, fixtureDocument, fixturePlacement } from '../fixtures/index';
import {
  createBoundary,
  createDocument,
  createSpace,
  findBoundary,
  isCalibrated,
  obstructionBoundaries,
  placementsInSpace,
  requireLevel,
  spaceArea,
  spaceAtPoint,
  spaceLabelAnchor,
  spacePolygon,
} from './document';
import { EntityNotFoundError } from './errors';
import type { Level } from './schema';

function room(id: string, x: number, y: number, width: number, height: number) {
  return createBoundary(id, 'space_outline', [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ]);
}

/** A treatment area with an isolation anteroom drawn inside it. */
function nestedLevel(): Level {
  return {
    ...requireLevel(fixtureDocument(), FIXTURE_LEVEL_ID),
    boundaries: [
      room('outer', 0, 0, 10_000, 8_000),
      room('inner', 1_000, 1_000, 3_000, 3_000),
      createBoundary('column', 'obstruction', [
        { x: 5_000, y: 5_000 },
        { x: 5_400, y: 5_000 },
        { x: 5_400, y: 5_400 },
        { x: 5_000, y: 5_400 },
      ]),
    ],
    spaces: [
      createSpace('outer-space', 'outer', 'Treatment area', 'hemodialysis_treatment'),
      createSpace('inner-space', 'inner', 'Isolation 1', 'isolation_treatment'),
    ],
    placements: [
      fixturePlacement('p1', { x: 2_000, y: 2_000 }, { spaceId: 'inner-space' }),
      fixturePlacement('p2', { x: 7_000, y: 2_000 }, { spaceId: 'outer-space' }),
      fixturePlacement('p3', { x: 7_000, y: 4_000 }),
    ],
  };
}

describe('creation', () => {
  it('gives a new project exactly one level', () => {
    // A project with no floor is not a project, and the first thing an engineer does
    // is import a drawing — which needs somewhere to go.
    const document = createDocument({ projectId: 'p', name: 'New review', now: '2026-07-29T00:00:00.000Z' });
    expect(document.project.levels).toHaveLength(1);
    expect(isCalibrated(document.project.levels[0] as Level)).toBe(false);
  });

  it('takes its timestamp from the caller', () => {
    const now = '2026-01-01T00:00:00.000Z';
    const document = createDocument({ projectId: 'p', name: 'x', now });
    expect(document.project.createdAt).toBe(now);
    expect(document.project.updatedAt).toBe(now);
  });
});

describe('lookup', () => {
  it('names the entity it could not find', () => {
    expect(() => requireLevel(fixtureDocument(), 'level-99')).toThrow(EntityNotFoundError);
    expect(() => requireLevel(fixtureDocument(), 'level-99')).toThrow(/level.*level-99/);
  });

  it('resolves a space to the polygon it is drawn as', () => {
    const level = nestedLevel();
    expect(spacePolygon(level, level.spaces[0] as never)).toHaveLength(4);
    expect(spaceArea(level, level.spaces[1] as never)).toBe(9_000_000);
  });

  it('returns null rather than guessing when a boundary has gone missing', () => {
    const level = { ...nestedLevel(), boundaries: [] };
    expect(spacePolygon(level, level.spaces[0] as never)).toBeNull();
    expect(spaceArea(level, level.spaces[0] as never)).toBeNull();
    expect(spaceLabelAnchor(level, level.spaces[0] as never)).toBeNull();
  });
});

describe('spaceAtPoint', () => {
  const level = nestedLevel();

  it('finds the room a point sits in', () => {
    expect(spaceAtPoint(level, { x: 7_000, y: 6_000 })?.id).toBe('outer-space');
  });

  it('prefers the smallest room when rooms nest', () => {
    // An anteroom drawn inside a treatment area is the more specific answer, and the
    // one an engineer means.
    expect(spaceAtPoint(level, { x: 2_000, y: 2_000 })?.id).toBe('inner-space');
  });

  it('returns null outside every room', () => {
    expect(spaceAtPoint(level, { x: 50_000, y: 50_000 })).toBeNull();
  });
});

describe('assignment', () => {
  it('lists equipment by room reference, not by geometry', () => {
    // Geometry and assignment are allowed to disagree: an engineer may place a
    // machine before drawing the room, or drag one across a wall mid-review.
    const level = nestedLevel();
    expect(placementsInSpace(level, 'inner-space').map((p) => p.id)).toEqual(['p1']);
    expect(placementsInSpace(level, 'outer-space').map((p) => p.id)).toEqual(['p2']);
  });

  it('keeps unassigned equipment on the drawing', () => {
    const level = nestedLevel();
    expect(level.placements.filter((p) => p.spaceId === null).map((p) => p.id)).toEqual(['p3']);
  });
});

describe('obstructions', () => {
  it('separates structural obstructions from room outlines', () => {
    // A column has no room-hood at all, which is why Boundary is its own entity.
    const level = nestedLevel();
    expect(obstructionBoundaries(level).map((b) => b.id)).toEqual(['column']);
    expect(findBoundary(level, 'column')?.kind).toBe('obstruction');
  });
});
