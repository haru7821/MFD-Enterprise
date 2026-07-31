import type { Rect } from './rect';
import { type Vec2, equals } from './vec2';

/**
 * Polygon geometry.
 *
 * ## Why this is written here rather than pulled from a library
 *
 * Owner decision, Sprint 4: implement polygon geometry internally, no external CAD
 * geometry library. What the spatial model actually needs is small — containment,
 * area, segment intersection — and every general-purpose library brings a coordinate
 * convention, a tolerance policy and a floating-point epsilon of its own. Those three
 * decisions are exactly the ones a millimetre-accurate clearance verdict rests on, so
 * they are made here, in the open, rather than inherited.
 *
 * ## Why the room polygon cannot reuse `polygonsOverlap`
 *
 * The rule engine's separating axis test is **convex only**. Rooms are not convex —
 * an L-shaped treatment area is the ordinary case, not the exception, and SAT reports
 * a machine sitting in the notch of an L as inside the room. So containment here is
 * ray casting, which does not care about convexity.
 *
 * ## Conventions
 *
 * - A polygon is a **closed** ring given as its distinct vertices. The closing edge
 *   from the last vertex back to the first is implied, never stored. Storing it makes
 *   "is this ring closed" a question with two answers.
 * - Winding order is not significant. Both `signedArea` and containment are
 *   orientation-independent, so an engineer drawing a room clockwise and one drawing
 *   it anticlockwise get the same room.
 * - Millimetres, model space (AD-1).
 */

export type Polygon = readonly Vec2[];

/** A polygon needs three distinct vertices before it encloses anything. */
export const MIN_POLYGON_VERTICES = 3;

export interface Segment {
  readonly a: Vec2;
  readonly b: Vec2;
}

/**
 * Tolerance for treating two model coordinates as the same point, in millimetres.
 *
 * One micrometre: far below anything a facility drawing can express, far above the
 * floating-point noise of rotating a coordinate a few times.
 */
export const GEOMETRY_EPSILON = 1e-3;

export function isValidPolygon(polygon: Polygon): boolean {
  return polygon.length >= MIN_POLYGON_VERTICES;
}

/** The edges of a closed ring, including the implied closing edge. */
export function polygonEdges(polygon: Polygon): Segment[] {
  const edges: Segment[] = [];
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (a && b) edges.push({ a, b });
  }
  return edges;
}

/**
 * Twice the signed area — the shoelace sum.
 *
 * Positive for one winding direction and negative for the other, in a coordinate
 * system whose y axis points down (which is ours, matching the screen). Callers that
 * only want size should use {@link polygonArea}.
 */
export function polygonSignedArea(polygon: Polygon): number {
  if (!isValidPolygon(polygon)) return 0;

  let sum = 0;
  for (const { a, b } of polygonEdges(polygon)) {
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** Enclosed area in square millimetres, whichever way the ring was drawn. */
export function polygonArea(polygon: Polygon): number {
  return Math.abs(polygonSignedArea(polygon));
}

/** Total edge length, including the closing edge. */
export function polygonPerimeter(polygon: Polygon): number {
  let total = 0;
  for (const { a, b } of polygonEdges(polygon)) {
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

export function polygonBounds(polygon: Polygon): Rect | null {
  const first = polygon[0];
  if (!first) return null;

  let minX = first.x;
  let maxX = first.x;
  let minY = first.y;
  let maxY = first.y;

  for (const point of polygon) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function polygonCentroid(polygon: Polygon): Vec2 | null {
  if (!isValidPolygon(polygon)) return polygon[0] ?? null;

  const twiceArea = polygonSignedArea(polygon) * 2;
  // A degenerate ring — all vertices collinear — has no centroid to speak of.
  // Averaging the vertices is the honest fallback rather than dividing by zero.
  if (Math.abs(twiceArea) < GEOMETRY_EPSILON) {
    const sum = polygon.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    return { x: sum.x / polygon.length, y: sum.y / polygon.length };
  }

  let x = 0;
  let y = 0;
  for (const { a, b } of polygonEdges(polygon)) {
    const cross = a.x * b.y - b.x * a.y;
    x += (a.x + b.x) * cross;
    y += (a.y + b.y) * cross;
  }

  return { x: x / (3 * twiceArea), y: y / (3 * twiceArea) };
}

/** Perpendicular distance from a point to a segment, and the closest point on it. */
export function closestPointOnSegment(segment: Segment, point: Vec2): Vec2 {
  const dx = segment.b.x - segment.a.x;
  const dy = segment.b.y - segment.a.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared < GEOMETRY_EPSILON * GEOMETRY_EPSILON) return segment.a;

  const t = ((point.x - segment.a.x) * dx + (point.y - segment.a.y) * dy) / lengthSquared;
  const clamped = Math.max(0, Math.min(1, t));
  return { x: segment.a.x + clamped * dx, y: segment.a.y + clamped * dy };
}

export function distanceToSegment(segment: Segment, point: Vec2): number {
  const closest = closestPointOnSegment(segment, point);
  return Math.hypot(point.x - closest.x, point.y - closest.y);
}

/** Shortest distance from a point to the polygon's outline, ignoring inside/outside. */
export function distanceToPolygonEdge(polygon: Polygon, point: Vec2): number {
  let best = Number.POSITIVE_INFINITY;
  for (const edge of polygonEdges(polygon)) {
    best = Math.min(best, distanceToSegment(edge, point));
  }
  return Number.isFinite(best) ? best : 0;
}

/** Is the point within `tolerance` of the outline? Treated as neither in nor out. */
export function isOnPolygonEdge(
  polygon: Polygon,
  point: Vec2,
  tolerance = GEOMETRY_EPSILON,
): boolean {
  return distanceToPolygonEdge(polygon, point) <= tolerance;
}

/**
 * Point-in-polygon by ray casting (the crossing-number rule).
 *
 * Cast a ray from the point in +x and count edge crossings: odd is inside. This works
 * on concave rings, which is the whole reason it exists — see the note at the top of
 * this file.
 *
 * A point exactly on the outline is reported as **inside**. A machine flush against a
 * wall is in the room; whether it is too close to that wall is a clearance question,
 * and answering it here would put the same fact in two places.
 *
 * The half-open comparison `(a.y > y) !== (b.y > y)` is what stops a vertex lying on
 * the ray being counted twice — the classic ray-casting bug, and one that shows up as
 * a room that occasionally reports its own interior as outside.
 */
export function polygonContains(polygon: Polygon, point: Vec2): boolean {
  if (!isValidPolygon(polygon)) return false;
  if (isOnPolygonEdge(polygon, point)) return true;

  let inside = false;
  for (const { a, b } of polygonEdges(polygon)) {
    const straddles = a.y > point.y !== b.y > point.y;
    if (!straddles) continue;

    const crossingX = a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x);
    if (point.x < crossingX) inside = !inside;
  }
  return inside;
}

/**
 * Do two segments cross **transversally** — meeting away from every endpoint?
 *
 * The distinction between geometry passing *through* geometry and geometry merely *touching* it.
 * A shared endpoint is not a crossing, collinear overlap is not a crossing, and — the case this
 * function exists for — an endpoint landing on the interior of the other segment is not a crossing
 * either. That last shape is a **T-junction**, and it is what a rectangle standing flush against a
 * wall makes: two of its edges end on the wall, touching it without passing through it.
 *
 * Measured as a distance from each endpoint rather than as a tolerance on the parametric position,
 * because a parametric epsilon means one thing on an 800 mm machine edge and something 20 times
 * larger on a 17 m room wall. Contact is contact at whatever length.
 */
export function segmentsProperlyCross(
  first: Segment,
  second: Segment,
  tolerance = GEOMETRY_EPSILON,
): boolean {
  const point = segmentIntersectionPoint(first, second);
  if (!point) return false;

  for (const endpoint of [first.a, first.b, second.a, second.b]) {
    if (Math.hypot(point.x - endpoint.x, point.y - endpoint.y) <= tolerance) return false;
  }
  return true;
}

/**
 * Is `inner` inside `outer`, with **contact counting as inside**?
 *
 * > Owner decision, VD-5 / A-4: *"A footprint touching the room boundary is considered contained.
 * > Only geometry extending outside the boundary is a containment failure. Treat boundary contact
 * > as topological contact, not as a crossing. Clearance evaluation remains completely separate
 * > from containment evaluation."*
 *
 * ## What was wrong before
 *
 * This used to refuse containment whenever any two edges met at all. `polygonContains` has always
 * counted a point on the outline as inside — its own comment says a machine flush against a wall is
 * in the room — but the polygon-level test then contradicted it: standing a rectangle against a wall
 * makes two T-junctions, those read as crossings, and containment was refused for equipment whose
 * every corner was inside the room.
 *
 * The cost was not theoretical. Found by placing a real layout on a real hospital drawing
 * (`docs/verification/HOSPITAL_044_VERIFICATION.md`), where equipment against a wall is not an edge
 * case but the ordinary arrangement: **every** machine on a wall reported *"extends beyond the
 * room"*, and a sound layout came out `not_acceptable`. It had never shown up because every test
 * room until then was traced with clearance around its equipment.
 *
 * ## What it asks now
 *
 * Three questions, and a failure of any one is geometry outside the room:
 *
 * 1. **Every vertex of `inner` is inside `outer`** — on the outline included.
 * 2. **No edge crosses another transversally.** Vertices alone are not enough: a rectangle can have
 *    all four corners inside a C-shaped room while its middle bulges out through the opening, and
 *    that bulge is a genuine crossing rather than a touch.
 * 3. **No vertex of `outer` is strictly inside `inner`.** The case (1) and (2) can both miss — a
 *    reflex corner of the room swallowed by the footprint, where the equipment covers a notch. On
 *    the outline is not strictly inside, so a machine filling its room exactly still passes.
 *
 * ## What this deliberately does not decide
 *
 * Whether a machine flush against a wall has enough room to be *serviced* is a clearance question,
 * answered by the clearance rules against thresholds with documents behind them. Containment answers
 * "is it in the room". Two questions, two evaluators, two findings — and neither borrows the other's
 * answer.
 */
export function polygonContainsPolygon(outer: Polygon, inner: Polygon): boolean {
  if (!isValidPolygon(outer) || !isValidPolygon(inner)) return false;
  if (!inner.every((vertex) => polygonContains(outer, vertex))) return false;

  for (const edgeOuter of polygonEdges(outer)) {
    for (const edgeInner of polygonEdges(inner)) {
      if (segmentsProperlyCross(edgeOuter, edgeInner)) return false;
    }
  }

  return !outer.some(
    (vertex) => polygonContains(inner, vertex) && !isOnPolygonEdge(inner, vertex),
  );
}

/** Do two segments properly cross? Shared endpoints and collinear overlap are not crossings. */
export function segmentsIntersect(first: Segment, second: Segment): boolean {
  return segmentIntersectionPoint(first, second) !== null;
}

/**
 * Where two segments cross, or null.
 *
 * Parallel and collinear segments return null. Collinear overlap is a real geometric
 * relationship but it has no single intersection *point*, and returning an arbitrary
 * one of the infinitely many would be worse than saying nothing.
 */
export function segmentIntersectionPoint(first: Segment, second: Segment): Vec2 | null {
  const r = { x: first.b.x - first.a.x, y: first.b.y - first.a.y };
  const s = { x: second.b.x - second.a.x, y: second.b.y - second.a.y };

  const denominator = r.x * s.y - r.y * s.x;
  if (Math.abs(denominator) < GEOMETRY_EPSILON) return null;

  const qp = { x: second.a.x - first.a.x, y: second.a.y - first.a.y };
  const t = (qp.x * s.y - qp.y * s.x) / denominator;
  const u = (qp.x * r.y - qp.y * r.x) / denominator;

  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: first.a.x + t * r.x, y: first.a.y + t * r.y };
}

/** Does any edge of one polygon cross any edge of the other? */
export function polygonsIntersect(first: Polygon, second: Polygon): boolean {
  for (const edgeA of polygonEdges(first)) {
    for (const edgeB of polygonEdges(second)) {
      if (segmentsIntersect(edgeA, edgeB)) return true;
    }
  }
  return false;
}

/** Every point where the two outlines cross. Ordering follows `first`'s edges. */
export function polygonIntersections(first: Polygon, second: Polygon): Vec2[] {
  const points: Vec2[] = [];
  for (const edgeA of polygonEdges(first)) {
    for (const edgeB of polygonEdges(second)) {
      const point = segmentIntersectionPoint(edgeA, edgeB);
      if (point && !points.some((existing) => equals(point, existing, GEOMETRY_EPSILON))) {
        points.push(point);
      }
    }
  }
  return points;
}

/**
 * Do two rings overlap at all — crossing outlines, or one wholly inside the other?
 *
 * The containment half matters: a machine entirely inside a column's footprint has no
 * edge crossings whatsoever, and an intersection-only test calls it clear.
 */
export function polygonsOverlapAnywhere(first: Polygon, second: Polygon): boolean {
  if (!isValidPolygon(first) || !isValidPolygon(second)) return false;
  if (polygonsIntersect(first, second)) return true;

  const firstVertex = first[0];
  const secondVertex = second[0];
  if (firstVertex && polygonContains(second, firstVertex)) return true;
  if (secondVertex && polygonContains(first, secondVertex)) return true;
  return false;
}

/**
 * Drop vertices that add nothing: repeats, and points collinear with their neighbours.
 *
 * An engineer tracing a wall produces both. Neither changes the room, and both make
 * every later edge loop slower and every vertex handle harder to grab.
 */
export function simplifyPolygon(polygon: Polygon, tolerance = GEOMETRY_EPSILON): Vec2[] {
  const distinct: Vec2[] = [];
  for (const point of polygon) {
    const previous = distinct[distinct.length - 1];
    if (previous && equals(point, previous, tolerance)) continue;
    distinct.push(point);
  }

  const firstPoint = distinct[0];
  const lastPoint = distinct[distinct.length - 1];
  if (distinct.length > 1 && firstPoint && lastPoint && equals(firstPoint, lastPoint, tolerance)) {
    distinct.pop();
  }

  if (distinct.length < MIN_POLYGON_VERTICES) return distinct;

  const kept: Vec2[] = [];
  for (let i = 0; i < distinct.length; i += 1) {
    const previous = distinct[(i - 1 + distinct.length) % distinct.length];
    const current = distinct[i];
    const next = distinct[(i + 1) % distinct.length];
    if (!previous || !current || !next) continue;

    const cross =
      (current.x - previous.x) * (next.y - previous.y) -
      (current.y - previous.y) * (next.x - previous.x);
    // Cross product is an area, so the tolerance is compared in mm²: a vertex that
    // bulges a micrometre off a ten-metre wall is noise, not a corner.
    if (Math.abs(cross) > tolerance) kept.push(current);
  }

  return kept.length >= MIN_POLYGON_VERTICES ? kept : distinct;
}

/** A closed rectangular ring, clockwise on screen. Convenience for boundary defaults. */
export function rectangleToPolygon(r: Rect): Vec2[] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ];
}
