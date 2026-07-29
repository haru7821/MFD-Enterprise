import { describe, expect, it } from 'vitest';

import {
  closestPointOnSegment,
  distanceToPolygonEdge,
  isValidPolygon,
  polygonArea,
  polygonBounds,
  polygonCentroid,
  polygonContains,
  polygonContainsPolygon,
  polygonEdges,
  polygonIntersections,
  polygonPerimeter,
  polygonSignedArea,
  polygonsIntersect,
  polygonsOverlapAnywhere,
  rectangleToPolygon,
  segmentIntersectionPoint,
  segmentsIntersect,
  simplifyPolygon,
} from './polygon';
import type { Vec2 } from './vec2';

/** A 4 × 3 m rectangular room. */
const ROOM = rectangleToPolygon({ x: 0, y: 0, width: 4_000, height: 3_000 });

/**
 * An L-shaped room — the case that makes ray casting necessary.
 *
 * ```
 *  (0,0) ───────── (6000,0)
 *    │                 │
 *    │            (6000,2000)
 *    │                 │
 *    │      ┌──────────┘
 *    │      │  ← the notch: outside the room, inside its convex hull
 * (0,5000) (3000,5000)
 * ```
 */
const L_ROOM: Vec2[] = [
  { x: 0, y: 0 },
  { x: 6_000, y: 0 },
  { x: 6_000, y: 2_000 },
  { x: 3_000, y: 2_000 },
  { x: 3_000, y: 5_000 },
  { x: 0, y: 5_000 },
];

describe('polygon validity', () => {
  it('needs three vertices to enclose anything', () => {
    expect(isValidPolygon([])).toBe(false);
    expect(isValidPolygon([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(false);
    expect(isValidPolygon(ROOM)).toBe(true);
  });

  it('implies the closing edge rather than storing it', () => {
    // Four vertices, four edges — the last one closes the ring.
    expect(ROOM).toHaveLength(4);
    expect(polygonEdges(ROOM)).toHaveLength(4);
    expect(polygonEdges(ROOM)[3]).toEqual({ a: { x: 0, y: 3_000 }, b: { x: 0, y: 0 } });
  });
});

describe('measurement', () => {
  it('computes area in square millimetres', () => {
    expect(polygonArea(ROOM)).toBe(12_000_000);
  });

  it('reports the same area whichever way the room was drawn', () => {
    const reversed = [...ROOM].reverse();
    expect(polygonArea(reversed)).toBe(polygonArea(ROOM));
    // Only the sign differs — which is what makes winding order irrelevant here.
    expect(polygonSignedArea(reversed)).toBe(-polygonSignedArea(ROOM));
  });

  it('computes the L-shaped area as the two rectangles it is', () => {
    // 6000 × 2000 plus 3000 × 3000.
    expect(polygonArea(L_ROOM)).toBe(12_000_000 + 9_000_000);
  });

  it('computes perimeter including the closing edge', () => {
    expect(polygonPerimeter(ROOM)).toBe(14_000);
  });

  it('computes bounds', () => {
    expect(polygonBounds(L_ROOM)).toEqual({ x: 0, y: 0, width: 6_000, height: 5_000 });
    expect(polygonBounds([])).toBeNull();
  });

  it('computes the centroid of a rectangle as its middle', () => {
    expect(polygonCentroid(ROOM)).toEqual({ x: 2_000, y: 1_500 });
  });

  it('falls back to the vertex average for a degenerate ring', () => {
    const collinear = [
      { x: 0, y: 0 },
      { x: 1_000, y: 0 },
      { x: 2_000, y: 0 },
    ];
    expect(polygonCentroid(collinear)).toEqual({ x: 1_000, y: 0 });
  });
});

describe('containment', () => {
  it('finds points inside and outside a rectangle', () => {
    expect(polygonContains(ROOM, { x: 2_000, y: 1_500 })).toBe(true);
    expect(polygonContains(ROOM, { x: 5_000, y: 1_500 })).toBe(false);
    expect(polygonContains(ROOM, { x: 2_000, y: -1 })).toBe(false);
  });

  it('treats a point on the outline as inside', () => {
    // A machine flush against a wall is in the room. Whether it is too close to that
    // wall is a clearance question, answered by the rule engine.
    expect(polygonContains(ROOM, { x: 0, y: 1_500 })).toBe(true);
    expect(polygonContains(ROOM, { x: 4_000, y: 3_000 })).toBe(true);
  });

  it('excludes the notch of an L-shaped room', () => {
    // The case a separating-axis test gets wrong: this point is inside the convex
    // hull of the room and outside the room.
    expect(polygonContains(L_ROOM, { x: 4_500, y: 3_500 })).toBe(false);
    expect(polygonContains(L_ROOM, { x: 4_500, y: 1_000 })).toBe(true);
    expect(polygonContains(L_ROOM, { x: 1_500, y: 3_500 })).toBe(true);
  });

  it('does not double-count a vertex lying on the cast ray', () => {
    // The classic ray-casting bug: a horizontal ray through y = 2000 passes exactly
    // through two vertices of L_ROOM. Getting this wrong flips the answer.
    expect(polygonContains(L_ROOM, { x: 1_500, y: 2_000 })).toBe(true);
    expect(polygonContains(L_ROOM, { x: 7_000, y: 2_000 })).toBe(false);
  });

  it('rejects a polygon that cannot enclose anything', () => {
    expect(polygonContains([{ x: 0, y: 0 }, { x: 1, y: 1 }], { x: 0, y: 0 })).toBe(false);
  });
});

describe('polygon inside polygon', () => {
  const machine = rectangleToPolygon({ x: 1_000, y: 1_000, width: 900, height: 750 });

  it('accepts a machine wholly inside the room', () => {
    expect(polygonContainsPolygon(ROOM, machine)).toBe(true);
  });

  it('rejects a machine straddling a wall', () => {
    const straddling = rectangleToPolygon({ x: 3_800, y: 1_000, width: 900, height: 750 });
    expect(polygonContainsPolygon(ROOM, straddling)).toBe(false);
  });

  it('rejects a machine wholly outside', () => {
    const outside = rectangleToPolygon({ x: 9_000, y: 9_000, width: 900, height: 750 });
    expect(polygonContainsPolygon(ROOM, outside)).toBe(false);
  });

  it('rejects a machine spanning the mouth of a C-shaped room', () => {
    // A C opening east: the notch is x ∈ [1000, 4000], y ∈ [1000, 3000].
    const cRoom: Vec2[] = [
      { x: 0, y: 0 },
      { x: 4_000, y: 0 },
      { x: 4_000, y: 1_000 },
      { x: 1_000, y: 1_000 },
      { x: 1_000, y: 3_000 },
      { x: 4_000, y: 3_000 },
      { x: 4_000, y: 4_000 },
      { x: 0, y: 4_000 },
    ];
    // Corners land in the two arms; the middle passes straight through the notch.
    // Vertex testing alone says yes, which is why the edge test is also needed.
    const spanning = rectangleToPolygon({ x: 1_500, y: 500, width: 2_000, height: 3_000 });

    expect(spanning.every((vertex) => polygonContains(cRoom, vertex))).toBe(true);
    expect(polygonContainsPolygon(cRoom, spanning)).toBe(false);
  });
});

describe('segments', () => {
  it('finds a crossing point', () => {
    const point = segmentIntersectionPoint(
      { a: { x: 0, y: 0 }, b: { x: 100, y: 100 } },
      { a: { x: 0, y: 100 }, b: { x: 100, y: 0 } },
    );
    expect(point).toEqual({ x: 50, y: 50 });
  });

  it('returns null for parallel segments', () => {
    expect(
      segmentIntersectionPoint(
        { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } },
        { a: { x: 0, y: 10 }, b: { x: 100, y: 10 } },
      ),
    ).toBeNull();
  });

  it('returns null for collinear overlap rather than an arbitrary point', () => {
    expect(
      segmentIntersectionPoint(
        { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } },
        { a: { x: 50, y: 0 }, b: { x: 150, y: 0 } },
      ),
    ).toBeNull();
  });

  it('does not report a crossing beyond either endpoint', () => {
    expect(
      segmentsIntersect(
        { a: { x: 0, y: 0 }, b: { x: 10, y: 10 } },
        { a: { x: 50, y: 100 }, b: { x: 100, y: 50 } },
      ),
    ).toBe(false);
  });

  it('finds the closest point on a segment, clamped to its ends', () => {
    const segment = { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } };
    expect(closestPointOnSegment(segment, { x: 50, y: 40 })).toEqual({ x: 50, y: 0 });
    expect(closestPointOnSegment(segment, { x: -40, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(closestPointOnSegment(segment, { x: 400, y: 0 })).toEqual({ x: 100, y: 0 });
  });

  it('measures distance to the nearest wall', () => {
    expect(distanceToPolygonEdge(ROOM, { x: 200, y: 1_500 })).toBe(200);
    expect(distanceToPolygonEdge(ROOM, { x: 2_000, y: 2_800 })).toBe(200);
  });
});

describe('polygon intersection', () => {
  const overlapping = rectangleToPolygon({ x: 3_500, y: 1_000, width: 1_000, height: 1_000 });
  const separate = rectangleToPolygon({ x: 9_000, y: 9_000, width: 1_000, height: 1_000 });
  const enclosed = rectangleToPolygon({ x: 1_000, y: 1_000, width: 500, height: 500 });

  it('detects crossing outlines', () => {
    expect(polygonsIntersect(ROOM, overlapping)).toBe(true);
    expect(polygonsIntersect(ROOM, separate)).toBe(false);
  });

  it('reports every crossing point once', () => {
    expect(polygonIntersections(ROOM, overlapping)).toHaveLength(2);
  });

  it('reports no crossings for a wholly enclosed polygon', () => {
    expect(polygonsIntersect(ROOM, enclosed)).toBe(false);
  });

  it('still calls a wholly enclosed polygon an overlap', () => {
    // The reason polygonsOverlapAnywhere exists: a machine entirely inside a
    // structural column has no edge crossings at all.
    expect(polygonsOverlapAnywhere(ROOM, enclosed)).toBe(true);
    expect(polygonsOverlapAnywhere(enclosed, ROOM)).toBe(true);
    expect(polygonsOverlapAnywhere(ROOM, separate)).toBe(false);
  });
});

describe('simplify', () => {
  it('drops repeated vertices', () => {
    const traced = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 4_000, y: 0 },
      { x: 4_000, y: 3_000 },
      { x: 0, y: 3_000 },
    ];
    expect(simplifyPolygon(traced)).toHaveLength(4);
  });

  it('drops a vertex that merely sits along a wall', () => {
    const traced = [
      { x: 0, y: 0 },
      { x: 2_000, y: 0 },
      { x: 4_000, y: 0 },
      { x: 4_000, y: 3_000 },
      { x: 0, y: 3_000 },
    ];
    const simplified = simplifyPolygon(traced);
    expect(simplified).toHaveLength(4);
    expect(polygonArea(simplified)).toBe(polygonArea(ROOM));
  });

  it('drops a duplicated closing vertex', () => {
    expect(simplifyPolygon([...ROOM, { x: 0, y: 0 }])).toHaveLength(4);
  });

  it('leaves a real corner alone', () => {
    expect(simplifyPolygon(L_ROOM)).toHaveLength(6);
  });

  it('refuses to simplify a ring away entirely', () => {
    // Three collinear points have no corners at all. Returning nothing would turn a
    // recoverable drawing mistake into a vanished room.
    const collinear = [
      { x: 0, y: 0 },
      { x: 1_000, y: 0 },
      { x: 2_000, y: 0 },
    ];
    expect(simplifyPolygon(collinear)).toHaveLength(3);
  });
});
