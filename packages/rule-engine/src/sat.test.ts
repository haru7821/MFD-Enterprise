import { describe, expect, it } from 'vitest';

import type { Vec2 } from '@mfd/cad-engine';
import { polygonsOverlapAnywhere } from '@mfd/cad-engine';

import { edgeNormals, gapAlongNormal, isConvexPolygon, polygonsOverlap, projectOnto } from './sat';

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

  it('measures only the part of a rotated, non-colliding neighbour actually in front of the face — not a corner standing beside it', () => {
    // An 800x800 station's rear face (`@mfd/object-library`'s `faceGeometry`, at rotation 0):
    // origin (400, 0), outward normal (0, -1), lateral extent [0, 800] along axis (1, 0). Against
    // it, a second 800x800 station at (-700, -900) rotated 10° — an ordinary, ten-degree tilt, not
    // a contrived shape — the exact scenario the sixth Critical 0 review round found reachable
    // with two placements the collision rule does not call touching.
    //
    // The seventh review round found this pair had been measuring the wrong thing: the corner at
    // roughly (-51, 27) sits laterally outside the face's own [0, 800] band — off to the side, not
    // in front of it — yet the unclipped implementation let it set the whole measurement, reading
    // -26.76 (clamped to 0 by the caller). Clipped to the band first, the true whole-face gap is
    // 262.88 mm: positive, and never clamped, because nothing in front of this face crosses its
    // plane at all.
    const rearFace = { origin: { x: 400, y: 0 }, normal: { x: 0, y: -1 } };
    const rearExtent = { axis: { x: 1, y: 0 }, min: 0, max: 800 };
    const subject = box(0, 0, 800, 800);
    const other = placedBox({ x: -700, y: -900 }, 10, 800, 800);

    // Not colliding: this is the pair `evaluateClearance`'s collision rule leaves alone.
    expect(polygonsOverlap(subject, other).overlapping).toBe(false);
    expect(gapAlongNormal(rearFace, rearExtent, other)).toBeCloseTo(262.88, 1);
  });

  it('still goes negative for a genuine in-band crossing — clipping narrows what is measured, it does not remove the clamp', () => {
    // A 300x300 box at (200, -50) rotated 15°: every corner's lateral (x) position already sits
    // within the face's own [0, 800] band, so clipping changes nothing here — and the box still
    // straddles the plane, entirely within the width the face actually owns. This is the case the
    // clamp at each caller exists for: a neighbour genuinely crossing the face in front of it, not
    // one merely reaching across a corner that was never in front of it to begin with.
    const rearFace = { origin: { x: 400, y: 0 }, normal: { x: 0, y: -1 } };
    const rearExtent = { axis: { x: 1, y: 0 }, min: 0, max: 800 };
    const other = placedBox({ x: 200, y: -50 }, 15, 300, 300);
    const xs = other.map((point) => point.x);

    expect(Math.min(...xs)).toBeGreaterThanOrEqual(rearExtent.min);
    expect(Math.max(...xs)).toBeLessThanOrEqual(rearExtent.max);
    expect(gapAlongNormal(rearFace, rearExtent, other)).toBeCloseTo(-317.42, 1);
  });
});

describe('convexity', () => {
  it('accepts a plain rectangle', () => {
    expect(isConvexPolygon(box(0, 0, 800, 800))).toBe(true);
  });

  it('accepts a triangle', () => {
    expect(isConvexPolygon([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 200, y: 300 }])).toBe(true);
  });

  it('accepts a convex polygon wound either direction', () => {
    const clockwise = box(0, 0, 800, 800);
    const counterClockwise = [...clockwise].reverse();
    expect(isConvexPolygon(clockwise)).toBe(true);
    expect(isConvexPolygon(counterClockwise)).toBe(true);
  });

  it('accepts a rectangle with a collinear vertex on one edge', () => {
    // The midpoint of the bottom edge turns neither way — it must not be read as a concavity.
    expect(
      isConvexPolygon([
        { x: 0, y: 0 },
        { x: 400, y: 0 },
        { x: 800, y: 0 },
        { x: 800, y: 800 },
        { x: 0, y: 800 },
      ]),
    ).toBe(true);
  });

  it('rejects an L-shaped polygon', () => {
    expect(
      isConvexPolygon([
        { x: 0, y: 0 },
        { x: 800, y: 0 },
        { x: 800, y: 400 },
        { x: 400, y: 400 },
        { x: 400, y: 800 },
        { x: 0, y: 800 },
      ]),
    ).toBe(false);
  });

  it('rejects a staple-shaped riser — one arm in front of a face, the other reachable only by wrapping around', () => {
    // The shape the eighth CTO review round used to show `gapAlongNormal` picking up a
    // disconnected far arm instead of the near one: two arms joined by a crossbar, wrapping
    // around three sides of an 800x800 station.
    expect(
      isConvexPolygon([
        { x: -200, y: -300 },
        { x: 0, y: -300 },
        { x: 0, y: 900 },
        { x: 800, y: 900 },
        { x: 800, y: -300 },
        { x: 1_000, y: -300 },
        { x: 1_000, y: 1_100 },
        { x: -200, y: 1_100 },
      ]),
    ).toBe(false);
  });

  it('rejects a self-intersecting star polygon — the tenth review round found the sign check alone accepts one', () => {
    // A pentagram, traced through its five points in star order: every vertex turns the same way
    // (the sign check alone is fooled), but the shape winds around its own centre twice rather
    // than once. Only the total-turning check tells the two apart.
    expect(
      isConvexPolygon([
        { x: 0, y: -1_000 },
        { x: 588, y: 809 },
        { x: -951, y: -309 },
        { x: 951, y: -309 },
        { x: -588, y: 809 },
      ]),
    ).toBe(false);
  });

  it('rejects a zero-width inward slit whose surrounding turns still fail the turning-sum check on their own', () => {
    // An 800x800 rectangle with a degenerate dart cut into the top edge: out to (400, 400) and
    // straight back to the exact point it left, (400, 800). The cross product at the tip is zero —
    // the same as a true straight-through vertex — but the two edges point in opposite directions,
    // not the same one. This particular shape's five genuine corners already sum to more than one
    // full turn, so the turning-sum check alone rejects it even with the reversal branch disabled —
    // see the next test for a slit constructed so that only the reversal branch catches it.
    expect(
      isConvexPolygon([
        { x: 0, y: 0 },
        { x: 800, y: 0 },
        { x: 800, y: 800 },
        { x: 400, y: 800 },
        { x: 400, y: 400 },
        { x: 400, y: 800 },
        { x: 0, y: 800 },
      ]),
    ).toBe(false);
  });

  it('rejects a slit whose surrounding corners alone sum to exactly one full turn — the reversal branch is load-bearing here', () => {
    /*
     * The eleventh review round's finding: the previous slit test does not actually exercise the
     * reversal branch — its five genuine corners already exceed one full turn on their own, so the
     * turning-sum check rejects it whether or not the reversal branch fires. This shape is built so
     * that its four genuine corners sum to *exactly* 2π: an 800x800 rectangle with a zero-width
     * slit driven inward from the top-left corner straight down the left edge to (0, 400) and back
     * out to (0, 800). Deleting the reversal branch (treating the tip and its return as ordinary
     * collinear skips) leaves exactly the rectangle's own four corners — a false accept.
     */
    expect(
      isConvexPolygon([
        { x: 0, y: 0 },
        { x: 800, y: 0 },
        { x: 800, y: 800 },
        { x: 0, y: 800 },
        { x: 0, y: 400 },
        { x: 0, y: 800 },
      ]),
    ).toBe(false);
  });

  it('accepts a genuinely convex rectangle with a duplicated consecutive vertex', () => {
    // The eleventh review round's blocking finding: a duplicate point contributes a zero-length
    // edge on both sides of it, and skipping both index positions straddling the duplicate used to
    // drop the real corner sitting between them from the turning sum entirely — turning a genuinely
    // convex rectangle's total short of a full turn and rejecting it. Grid snapping makes two
    // neighbouring traced points coincide easily, so this is an ordinary shape, not a contrived one.
    expect(
      isConvexPolygon([
        { x: 0, y: 0 },
        { x: 800, y: 0 },
        { x: 800, y: 800 },
        { x: 800, y: 800 },
        { x: 0, y: 800 },
      ]),
    ).toBe(true);
  });

  it('accepts a rectangle traced as a redundantly closed ring', () => {
    // The eleventh review round's blocking finding, the wrap-around case: the last vertex repeats
    // the first, so the two are adjacent in the cyclic walk even though they are not adjacent
    // in the array — the same defect as the previous test, one step removed.
    expect(
      isConvexPolygon([
        { x: 0, y: 0 },
        { x: 800, y: 0 },
        { x: 800, y: 800 },
        { x: 0, y: 800 },
        { x: 0, y: 0 },
      ]),
    ).toBe(true);
  });
});

/**
 * The owner's *"every subsystem must use exactly the same predicate"*, enforced rather than stated.
 *
 * Three subsystems decide whether two footprints collide: `polygonsOverlap` here (equipment against
 * equipment, SAT, convex only), `polygonsOverlapAnywhere` in `@mfd/cad-engine` (equipment against an
 * obstruction, any simple ring), and `polygonContainsPolygon` (equipment against the room, VD-5).
 * The geometry audit found them giving three different answers at exactly zero distance.
 *
 * They cannot be one function — SAT needs convexity and returns a penetration depth the others have
 * no use for — so this pins them to one *answer* on the domain where both are defined. A future
 * edit that reintroduces an inclusive test on either side fails here rather than in a hospital.
 */
describe('one canonical collision definition', () => {
  const cases: [string, Vec2[], Vec2[]][] = [
    ['disjoint', box(0, 0, 800, 800), box(2_000, 0, 800, 800)],
    ['vertex-only contact', box(0, 0, 800, 800), box(800, 800, 800, 800)],
    ['edge-flush contact', box(0, 0, 800, 800), box(800, 0, 800, 800)],
    ['edge-flush, partly offset', box(0, 0, 800, 800), box(800, 400, 800, 800)],
    ['one millimetre of penetration', box(0, 0, 800, 800), box(799, 0, 800, 800)],
    ['half overlapped', box(0, 0, 800, 800), box(400, 400, 800, 800)],
    ['identical', box(0, 0, 800, 800), box(0, 0, 800, 800)],
    ['wholly enclosed', box(0, 0, 4_000, 4_000), box(1_000, 1_000, 800, 800)],
  ];

  for (const [name, a, b] of cases) {
    it(`agrees with polygonsOverlapAnywhere: ${name}`, () => {
      expect(polygonsOverlapAnywhere(a, b)).toBe(polygonsOverlap(a, b).overlapping);
    });
  }
});
