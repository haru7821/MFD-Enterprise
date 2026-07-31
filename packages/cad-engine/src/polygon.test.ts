import { describe, expect, it } from 'vitest';

import {
  closestPointOnSegment,
  distanceToPolygonEdge,
  isOnPolygonEdge,
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
  segmentsProperlyCross,
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

  it('accepts a machine standing flush against a wall', () => {
    /*
     * > Owner decision, VD-5 / A-4: *"A footprint touching the room boundary is considered
     * > contained … Treat boundary contact as topological contact, not as a crossing."*
     *
     * The case that broke on a real drawing. This machine's south edge lies **along** the room's
     * south wall, so its west and east edges each *end* on that wall — two T-junctions. Read as
     * crossings, they refused containment for a machine every corner of which is inside the room.
     */
    const flush = rectangleToPolygon({ x: 1_000, y: 0, width: 900, height: 750 });

    expect(flush.every((vertex) => polygonContains(ROOM, vertex))).toBe(true);
    expect(polygonContainsPolygon(ROOM, flush)).toBe(true);
  });

  it('accepts a machine wedged into a corner, touching two walls at once', () => {
    // Two walls and a shared vertex with the room itself — the most contact a rectangle can make
    // without leaving. An engineer putting a machine in the corner of a room has not put it outside.
    const corner = rectangleToPolygon({ x: 0, y: 0, width: 900, height: 750 });

    expect(polygonContainsPolygon(ROOM, corner)).toBe(true);
  });

  it('accepts a machine that exactly fills its room', () => {
    // Every edge collinear, every vertex shared. Degenerate, and still inside: there is no point of
    // it anywhere outside the room.
    expect(polygonContainsPolygon(ROOM, rectangleToPolygon({ x: 0, y: 0, width: 4_000, height: 3_000 }))).toBe(
      true,
    );
  });

  it('still rejects a machine one millimetre over the wall', () => {
    /*
     * The other side of the decision, and the one that makes it safe. Touching is contained;
     * *crossing* is not, and the boundary between the two is exactly where it should be. A test
     * that only proved the flush case would pass just as well against a function that returned true
     * unconditionally.
     */
    const over = rectangleToPolygon({ x: 1_000, y: -1, width: 900, height: 750 });

    expect(polygonContainsPolygon(ROOM, over)).toBe(false);
  });

  it('rejects a machine covering the reflex corner of an L-shaped room', () => {
    // Caught by the crossing test: the footprint's top edge passes straight through the L's
    // vertical wall. Here for completeness — a machine over a notch is out, however it is detected.
    const overNotch = rectangleToPolygon({ x: 2_500, y: 1_500, width: 1_000, height: 1_000 });

    expect(polygonContains(overNotch, { x: 3_000, y: 2_000 })).toBe(true);
    expect(polygonContainsPolygon(L_ROOM, overNotch)).toBe(false);
  });

  it('rejects a machine that swallows a notch whole, touching it only at its own corners', () => {
    /*
     * The case neither of the other two checks can see, and the reason containment also asks whether
     * the *room* has a corner strictly inside the equipment.
     *
     * The room's boundary dips up into a triangular notch with its apex at (500, 500). The notch's
     * two edges leave the machine exactly through its bottom corners — so every meeting is at an
     * endpoint, no crossing is transversal, and all four machine corners lie on or inside the room.
     * By vertices and crossings alone this is contained. It is not: the whole notch is floor outside
     * the room, and the machine is standing on it.
     */
    const notchedRoom: Vec2[] = [
      { x: -2_000, y: 0 },
      { x: 0, y: 0 },
      { x: 500, y: 500 },
      { x: 1_000, y: 0 },
      { x: 3_000, y: 0 },
      { x: 3_000, y: 3_000 },
      { x: -2_000, y: 3_000 },
    ];
    const machine = rectangleToPolygon({ x: 0, y: 0, width: 1_000, height: 1_000 });

    // Everything the first two checks look at says yes.
    expect(machine.every((vertex) => polygonContains(notchedRoom, vertex))).toBe(true);
    for (const roomEdge of polygonEdges(notchedRoom)) {
      for (const machineEdge of polygonEdges(machine)) {
        expect(segmentsProperlyCross(roomEdge, machineEdge)).toBe(false);
      }
    }
    // And the notch's apex is a room corner sitting inside the machine, which is what gives it away.
    expect(polygonContains(machine, { x: 500, y: 500 })).toBe(true);
    expect(polygonContainsPolygon(notchedRoom, machine)).toBe(false);
  });

  it('rejects a machine filling an alcove outside the room, every corner on the outline', () => {
    /*
     * The false GREEN. Found by the standing review; the reason containment also asks where
     * `inner`'s **interior** is rather than only where its corners and crossings are.
     *
     * The room's east wall steps west for 800 mm, leaving a recess that is *not* room — the way a
     * plan draws a service duct or a stair core biting into a floor. Stand a machine in that recess,
     * exactly filling it:
     *
     *   - all four of its corners lie on the room's outline, so check 1 passes;
     *   - three of its edges are collinear with room edges and the fourth meets them only at their
     *     endpoints, so no meeting is transversal and check 2 passes;
     *   - the room's own corners sit on the machine's outline, never strictly inside, so check 3
     *     passes.
     *
     * Every one of the checks that existed said contained. The machine's entire 0.64 m² is outside
     * the room, and the report said GREEN.
     */
    const recessedRoom: Vec2[] = [
      { x: 0, y: 0 },
      { x: 4_000, y: 0 },
      { x: 4_000, y: 1_000 },
      { x: 3_200, y: 1_000 },
      { x: 3_200, y: 1_800 },
      { x: 4_000, y: 1_800 },
      { x: 4_000, y: 3_000 },
      { x: 0, y: 3_000 },
    ];
    const filler = rectangleToPolygon({ x: 3_200, y: 1_000, width: 800, height: 800 });

    // Everything the first three checks look at says yes.
    expect(filler.every((vertex) => polygonContains(recessedRoom, vertex))).toBe(true);
    for (const roomEdge of polygonEdges(recessedRoom)) {
      for (const fillerEdge of polygonEdges(filler)) {
        expect(segmentsProperlyCross(roomEdge, fillerEdge)).toBe(false);
      }
    }
    expect(
      recessedRoom.some(
        (vertex) => polygonContains(filler, vertex) && !isOnPolygonEdge(filler, vertex),
      ),
    ).toBe(false);

    // And not one point of it is in the room — its centre least of all.
    expect(polygonContains(recessedRoom, { x: 3_600, y: 1_400 })).toBe(false);
    expect(polygonContainsPolygon(recessedRoom, filler)).toBe(false);
  });

  it('rejects a machine half in the room and half in the alcove, whose centre is in the room', () => {
    /*
     * The counterexample that killed the first attempt at fixing the case above, and the reason
     * containment subdivides an edge instead of sampling a point.
     *
     * Slide the filler west until two thirds of it is genuinely in the room. Now:
     *
     *   - every corner is inside the room or on its outline;
     *   - no two edges cross transversally, still — the meetings are T-junctions and collinear runs;
     *   - no reflex vertex is swallowed;
     *   - **and the footprint's centroid, (3000, 1400), is in the room**, because most of it is.
     *
     * So a fourth check asking "is an interior point of the footprint in the room" answers yes, and
     * 0.64 m² is outside anyway. Sampling the interior cannot decide an area; only the outline can.
     *
     * What catches it is the east edge, which spans the mouth of the recess from (4000, 1000) to
     * (4000, 1800). Its midpoint (4000, 1400) is 400 mm outside the wall.
     */
    const recessedRoom: Vec2[] = [
      { x: 0, y: 0 },
      { x: 4_000, y: 0 },
      { x: 4_000, y: 1_000 },
      { x: 3_200, y: 1_000 },
      { x: 3_200, y: 1_800 },
      { x: 4_000, y: 1_800 },
      { x: 4_000, y: 3_000 },
      { x: 0, y: 3_000 },
    ];
    const straddling = rectangleToPolygon({ x: 2_000, y: 1_000, width: 2_000, height: 800 });

    expect(straddling.every((vertex) => polygonContains(recessedRoom, vertex))).toBe(true);
    for (const roomEdge of polygonEdges(recessedRoom)) {
      for (const machineEdge of polygonEdges(straddling)) {
        expect(segmentsProperlyCross(roomEdge, machineEdge)).toBe(false);
      }
    }
    expect(
      recessedRoom.some(
        (vertex) => polygonContains(straddling, vertex) && !isOnPolygonEdge(straddling, vertex),
      ),
    ).toBe(false);
    // The interior sample says yes. The outline says no, and the outline is right.
    expect(polygonContains(recessedRoom, { x: 3_000, y: 1_400 })).toBe(true);
    expect(polygonContains(recessedRoom, { x: 4_000, y: 1_400 })).toBe(false);

    expect(polygonContainsPolygon(recessedRoom, straddling)).toBe(false);
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

describe('proper crossings', () => {
  /*
   * The predicate containment now rests on. Each case below is a way two edges can meet, and only
   * one of them is geometry passing through geometry.
   */
  const wall = { a: { x: 0, y: 0 }, b: { x: 4_000, y: 0 } };

  it('a T-junction is contact, not a crossing', () => {
    // A machine's side edge ending on the wall it stands against. This is the whole finding.
    const standingOn = { a: { x: 1_000, y: 750 }, b: { x: 1_000, y: 0 } };

    expect(segmentIntersectionPoint(wall, standingOn)).toEqual({ x: 1_000, y: 0 });
    expect(segmentsProperlyCross(wall, standingOn)).toBe(false);
  });

  it('an edge lying along the wall is contact, not a crossing', () => {
    expect(segmentsProperlyCross(wall, { a: { x: 1_000, y: 0 }, b: { x: 1_900, y: 0 } })).toBe(false);
  });

  it('a shared endpoint is contact, not a crossing', () => {
    expect(segmentsProperlyCross(wall, { a: { x: 0, y: 0 }, b: { x: 0, y: 750 } })).toBe(false);
  });

  it('an edge passing through the wall is a crossing', () => {
    expect(segmentsProperlyCross(wall, { a: { x: 1_000, y: 750 }, b: { x: 1_000, y: -1 } })).toBe(
      true,
    );
  });

  it('measures contact as a distance, so it does not depend on the segments’ lengths', () => {
    /*
     * A parametric epsilon would call this a crossing on the 17 m wall and contact on the 800 mm
     * one, for the same 1 mm of geometry. Two identical touches, one length apart.
     */
    const longWall = { a: { x: 0, y: 0 }, b: { x: 17_600, y: 0 } };
    const shortEdge = { a: { x: 8_000, y: 800 }, b: { x: 8_000, y: 0 } };

    expect(segmentsProperlyCross(longWall, shortEdge)).toBe(false);
    expect(segmentsProperlyCross(wall, { a: { x: 1_000, y: 800 }, b: { x: 1_000, y: 0 } })).toBe(
      false,
    );
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
