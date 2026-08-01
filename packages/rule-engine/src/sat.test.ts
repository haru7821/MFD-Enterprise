import { describe, expect, it } from 'vitest';

import type { Vec2 } from '@mfd/cad-engine';

import { edgeNormals, gapAlongNormal, polygonsOverlap, projectOnto } from './sat';

/** Axis-aligned rectangle as a polygon. */
function box(x: number, y: number, width: number, height: number): Vec2[] {
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
}

/** Rotate a polygon about the origin, degrees. */
function rotate(polygon: readonly Vec2[], degrees: number): Vec2[] {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return polygon.map((point) => ({
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  }));
}

/**
 * A `width` x `height` rectangle whose own front-left corner sits at `position`, rotated about
 * that corner — the same mirror-free half of `@mfd/object-library`'s `localToModel` a placed
 * footprint actually uses, so a polygon built here is one a real, rotated placement could produce.
 */
function placedBox(position: Vec2, degrees: number, width: number, height: number): Vec2[] {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return box(0, 0, width, height).map((local) => ({
    x: position.x + local.x * cos - local.y * sin,
    y: position.y + local.x * sin + local.y * cos,
  }));
}

describe('projection', () => {
  it('projects a box onto the x axis', () => {
    expect(projectOnto(box(10, 20, 100, 50), { x: 1, y: 0 })).toEqual({ min: 10, max: 110 });
  });
});

describe('edge normals', () => {
  it('gives one normal per edge, unit length', () => {
    const normals = edgeNormals(box(0, 0, 900, 750));

    expect(normals).toHaveLength(4);
    for (const normal of normals) {
      expect(Math.hypot(normal.x, normal.y)).toBeCloseTo(1, 9);
    }
  });
});

describe('overlap of axis-aligned boxes', () => {
  it('detects a clear overlap and its depth', () => {
    const result = polygonsOverlap(box(0, 0, 1_000, 1_000), box(900, 0, 1_000, 1_000));

    expect(result.overlapping).toBe(true);
    expect(result.penetration).toBeCloseTo(100, 6);
  });

  it('reports no overlap for separated boxes', () => {
    expect(polygonsOverlap(box(0, 0, 900, 750), box(1_000, 0, 900, 750)).overlapping).toBe(
      false,
    );
  });

  it('treats exact edge contact as no collision', () => {
    // Two machines pushed flat against each other are a clearance question, not a
    // collision. Firing here would flag every tidy layout.
    expect(polygonsOverlap(box(0, 0, 900, 750), box(900, 0, 900, 750)).overlapping).toBe(
      false,
    );
  });

  it('detects full containment', () => {
    expect(polygonsOverlap(box(0, 0, 1_000, 1_000), box(100, 100, 200, 200)).overlapping).toBe(
      true,
    );
  });

  it('is symmetric', () => {
    const a = box(0, 0, 900, 750);
    const b = box(800, 100, 900, 750);

    expect(polygonsOverlap(a, b)).toEqual(polygonsOverlap(b, a));
  });
});

describe('overlap of rotated boxes', () => {
  it('separates boxes an axis-aligned test would call overlapping', () => {
    // Two long boxes turned 45° in opposite directions: their bounding boxes
    // intersect, the boxes themselves do not.
    const a = rotate(box(-1_500, -100, 3_000, 200), 45);
    const b = rotate(box(-1_500, 1_100, 3_000, 200), 45).map((point) => ({
      x: point.x + 2_400,
      y: point.y,
    }));

    expect(polygonsOverlap(a, b).overlapping).toBe(false);
  });

  it('detects a genuine overlap between rotated boxes', () => {
    const a = rotate(box(-450, -375, 900, 750), 30);
    const b = rotate(box(-450, -375, 900, 750), 30).map((point) => ({
      x: point.x + 200,
      y: point.y + 100,
    }));

    expect(polygonsOverlap(a, b).overlapping).toBe(true);
  });

  it('gives the same verdict when the whole pair is rotated', () => {
    const a = box(0, 0, 900, 750);
    const b = box(800, 100, 900, 750);
    const expected = polygonsOverlap(a, b).overlapping;

    for (const degrees of [7, 30, 45, 90, 137, 180, 271]) {
      expect(polygonsOverlap(rotate(a, degrees), rotate(b, degrees)).overlapping).toBe(
        expected,
      );
    }
  });
});

describe('gap along a face normal', () => {
  const face = { origin: { x: 0, y: 0 }, normal: { x: 0, y: 1 } };
  const extent = { axis: { x: 1, y: 0 }, min: 0, max: 900 };

  it('measures the free distance to something in front', () => {
    expect(gapAlongNormal(face, extent, box(0, 500, 900, 750))).toBeCloseTo(500, 6);
  });

  it('returns null for something behind the face', () => {
    // Behind is not a distance of zero; confusing the two would read as a machine
    // pressed against the face.
    expect(gapAlongNormal(face, extent, box(0, -1_000, 900, 750))).toBeNull();
  });

  it('returns null for something beside the face', () => {
    expect(gapAlongNormal(face, extent, box(2_000, 500, 900, 750))).toBeNull();
  });

  it('counts a partial lateral overlap as in front', () => {
    expect(gapAlongNormal(face, extent, box(800, 400, 900, 750))).toBeCloseTo(400, 6);
  });

  it('goes negative when something has crossed the face plane', () => {
    expect(gapAlongNormal(face, extent, box(0, -100, 900, 750))).toBeCloseTo(-100, 6);
  });

  it('goes negative for a rotated, non-colliding neighbour — the reachable real case, not only an axis-aligned one', () => {
    // An 800x800 station's rear face (`@mfd/object-library`'s `faceGeometry`, at rotation 0):
    // origin (400, 0), outward normal (0, -1), lateral extent [0, 800] along axis (1, 0). Against
    // it, a second 800x800 station at (-700, -900) rotated 10° — an ordinary, ten-degree tilt, not
    // a contrived shape — reproducing the exact scenario the sixth Critical 0 review round found
    // reachable with two placements the collision rule does not call touching.
    const rearFace = { origin: { x: 400, y: 0 }, normal: { x: 0, y: -1 } };
    const rearExtent = { axis: { x: 1, y: 0 }, min: 0, max: 800 };
    const subject = box(0, 0, 800, 800);
    const other = placedBox({ x: -700, y: -900 }, 10, 800, 800);

    // Not colliding: this is the pair `evaluateClearance`'s collision rule leaves alone, and the
    // gap below is not a distance the machines are pressed into — it is a plane crossed cleanly.
    expect(polygonsOverlap(subject, other).overlapping).toBe(false);
    expect(gapAlongNormal(rearFace, rearExtent, other)).toBeCloseTo(-26.76, 1);
  });
});
