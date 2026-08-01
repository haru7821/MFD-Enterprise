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
 *
 * **{@link polygonContainsPolygon} no longer uses this**, and the reason is worth stating here
 * rather than only there: two outlines can interleave entirely through contact, changing which side
 * of each other they are on without a single transversal crossing. Absence of crossings is not
 * absence of escape. What this predicate is still good for is *saying so* — the containment tests
 * assert it returns false everywhere on a footprint that is nonetheless outside the room.
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
 * The positions along `edge`, as fractions of its length, where `boundary` meets it.
 *
 * Always includes both ends. Everything between them is a place the edge passes through, touches,
 * or stops running alongside the other outline — the three ways a boundary can change which side of
 * `boundary` the edge is on.
 *
 * The last of those is why the endpoints of `boundary`'s own edges are projected here and not only
 * the crossing points: {@link segmentIntersectionPoint} returns null for collinear segments, by
 * design, because an overlap has no single intersection point. An edge running along a wall and
 * then leaving it has its departure recorded nowhere else.
 */
function boundaryCrossingPositions(edge: Segment, boundary: Polygon): number[] {
  const dx = edge.b.x - edge.a.x;
  const dy = edge.b.y - edge.a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < GEOMETRY_EPSILON * GEOMETRY_EPSILON) return [];

  const positions = [0, 1];
  const record = (point: Vec2): void => {
    const t = ((point.x - edge.a.x) * dx + (point.y - edge.a.y) * dy) / lengthSquared;
    if (t <= 0 || t >= 1) return;
    // The projection only means something if the point is actually on this edge rather than
    // somewhere off to the side of it.
    const projected = { x: edge.a.x + t * dx, y: edge.a.y + t * dy };
    if (Math.hypot(point.x - projected.x, point.y - projected.y) <= GEOMETRY_EPSILON) {
      positions.push(t);
    }
  };

  for (const other of polygonEdges(boundary)) {
    const crossing = segmentIntersectionPoint(edge, other);
    if (crossing) record(crossing);
    record(other.a);
    record(other.b);
  }

  return positions.sort((a, b) => a - b);
}

/**
 * Does the whole of `inner`'s outline lie inside `outer`, contact included?
 *
 * Cut every edge of `inner` at each point where `outer`'s outline meets it, then test the midpoint
 * of each piece. Between two consecutive cuts the piece meets `outer`'s outline nowhere, so it is
 * wholly inside or wholly outside and its midpoint says which. That is a homogeneity argument that
 * holds, unlike testing a whole edge whose ends happen to be inside.
 *
 * Pieces shorter than {@link GEOMETRY_EPSILON} are skipped. Measured as a length in millimetres
 * rather than as a fraction of the edge, for the reason given on {@link segmentsProperlyCross}: a
 * parametric epsilon means one thing on an 800 mm footprint edge and twenty times more on a 17 m
 * wall.
 */
function polygonOutlineWithin(outer: Polygon, inner: Polygon): boolean {
  for (const edge of polygonEdges(inner)) {
    const length = Math.hypot(edge.b.x - edge.a.x, edge.b.y - edge.a.y);
    const positions = boundaryCrossingPositions(edge, outer);

    for (let i = 1; i < positions.length; i += 1) {
      const from = positions[i - 1];
      const to = positions[i];
      if (from === undefined || to === undefined) continue;
      if ((to - from) * length < GEOMETRY_EPSILON) continue;

      const t = (from + to) / 2;
      const midpoint = {
        x: edge.a.x + t * (edge.b.x - edge.a.x),
        y: edge.a.y + t * (edge.b.y - edge.a.y),
      };
      if (!polygonContains(outer, midpoint)) return false;
    }
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
 * ## What it asks now — one question
 *
 * **Is every part of `inner`'s outline inside `outer`?** {@link polygonOutlineWithin} cuts each edge
 * of `inner` wherever `outer`'s outline meets it and tests each piece on its own.
 *
 * That is the whole test. It used to be three — every vertex inside, no transversal crossing, no
 * room vertex swallowed by the footprint — and the three of them together let a **false GREEN reach
 * a signed report**. The shape that did it is worth keeping.
 *
 * Where a room's wall steps inward — a duct, a stair core, a column bay — the recess is not room.
 * Stand a footprint so part of it is in the room and part fills that recess. Every corner is inside
 * or on the outline, so the vertex test passes. No two edges cross *transversally*, because the
 * footprint meets the outline only at T-junctions and along collinear runs, and VD-5 says contact is
 * not a crossing — so the crossing test passes. No reflex vertex is swallowed. And an *interior
 * sample* of it, its centroid, is in the room, because most of it is. Every one of those says
 * contained, and 0.64 m² is outside.
 *
 * What defeats them all is that the two outlines **interleave through contact**: they change sides
 * without ever crossing. So this does not ask whether an edge crosses; it cuts the edge wherever the
 * outlines meet at all and asks about each piece, and a piece between two consecutive meetings
 * cannot change sides part-way along. The footprint above is caught by the edge spanning the mouth
 * of the recess, whose midpoint is in the recess and not in the room.
 *
 * ## Why the outline settles the area
 *
 * The outline says nothing directly about `inner`'s *interior*, and yet it decides it. Suppose the
 * whole of `inner`'s outline is inside `outer` and some interior point `p` of `inner` is not. Then
 * `p` lies in a component of the region outside `outer`; a path from `p` to infinity stays in that
 * region, so it never touches `outer`'s closed area, so it never touches `inner`'s outline either —
 * yet it must cross that outline to leave `inner`. So the component is bounded. A simple polygon's
 * exterior has exactly one component and it is unbounded. There is no such `p`.
 *
 * That argument is why the other two checks are **gone rather than kept as insurance**. Both were
 * removed and the suite still passed — including the swallowed-notch case, which the outline test
 * catches on the edge that runs across the notch's mouth. A check no test can make fail is not
 * insurance, it is the thing this project keeps having to find later.
 *
 * It assumes what the conventions at the top of this file already state: `outer` is a **simple**
 * ring. A self-intersecting one has no well-defined inside for `polygonContains` to report either,
 * so this is not a new precondition.
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
  return polygonOutlineWithin(outer, inner);
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
 * Do two rings enclose any area in common — **contact excluded**?
 *
 * > Owner decision, following the geometry audit: *"Use one canonical geometry definition. Touching
 * > is NOT collision. Proper overlap is collision. Every subsystem must use exactly the same
 * > predicate. No separate interpretations."*
 *
 * This is that predicate. It answers one question — do the two **interiors** intersect — and it is
 * the question every collision rule in the product asks, whatever the two shapes happen to be.
 *
 * ## What was wrong before
 *
 * It used to be `polygonsIntersect(first, second)` plus a vertex-containment fallback, and
 * `polygonsIntersect` is built on {@link segmentIntersectionPoint}, whose parametric test accepts
 * `t, u ∈ [0, 1]` **inclusive**. A shared endpoint and a T-junction are therefore "intersections".
 *
 * So a machine standing flush against a column, or touching it at a single corner, was a collision:
 * a 600 mm column at `[4000, 4600]²` and a 900 x 750 footprint at `(3100, 3250)` share exactly the
 * point `(4000, 4000)` and reported `RED`, measured **0 mm** — *"overlaps Column C4 by 0 mm"*. One
 * millimetre clear reported GREEN.
 *
 * That made three predicates give three answers to the same question at zero distance:
 * equipment↔equipment GREEN ({@link polygonsOverlap} in the rule engine — *"touching exactly along
 * an edge is not an overlap"*), equipment↔room GREEN (VD-5, {@link polygonContainsPolygon}), and
 * equipment↔obstruction RED. It is the Hospital_044 false-RED reachable through a different
 * boundary kind, and it would also have made the solver discard every wall-hugging candidate.
 *
 * ## How it decides
 *
 * The same homogeneity argument {@link polygonContainsPolygon} rests on, asked the other way round.
 * Cut every edge of one ring wherever the other's outline meets it; between two consecutive
 * meetings a piece cannot change sides, so its midpoint speaks for the whole piece. If any such
 * midpoint is **strictly** inside the other ring — inside and not on its outline — the two
 * interiors share area. Both directions are tested, because the overlap region's boundary may be
 * made of either ring's edges.
 *
 * The two containment terms close the case the edge walk cannot see: identical rings, and one ring
 * wholly inside the other. There, no edge piece of either is strictly interior to the other — for
 * identical rings every piece lies *on* the outline — yet a simple polygon with positive area
 * inside another's closed region must share interior with it, because an outline has no area.
 *
 * Contact alone never satisfies any of the four terms, which is the property the decision asks for.
 */
export function polygonsOverlapAnywhere(first: Polygon, second: Polygon): boolean {
  if (!isValidPolygon(first) || !isValidPolygon(second)) return false;

  if (outlineEntersInterior(first, second)) return true;
  if (outlineEntersInterior(second, first)) return true;

  // Wholly inside, or identical. Contact-inclusive containment is the right test here: a footprint
  // sitting inside a column and touching its wall is a collision, not a near miss.
  return polygonContainsPolygon(second, first) || polygonContainsPolygon(first, second);
}

/**
 * Does any part of `outline`'s boundary run strictly inside `region`?
 *
 * Edge-by-edge, cut at every meeting with `region`'s outline — see
 * {@link boundaryCrossingPositions} — and each piece judged by its midpoint. Strict is the whole
 * point: a piece lying *along* `region`'s wall is contact, and contact is not overlap.
 */
function outlineEntersInterior(outline: Polygon, region: Polygon): boolean {
  for (const edge of polygonEdges(outline)) {
    const length = Math.hypot(edge.b.x - edge.a.x, edge.b.y - edge.a.y);
    const positions = boundaryCrossingPositions(edge, region);

    for (let i = 1; i < positions.length; i += 1) {
      const from = positions[i - 1];
      const to = positions[i];
      if (from === undefined || to === undefined) continue;
      if ((to - from) * length < GEOMETRY_EPSILON) continue;

      const t = (from + to) / 2;
      const midpoint = {
        x: edge.a.x + t * (edge.b.x - edge.a.x),
        y: edge.a.y + t * (edge.b.y - edge.a.y),
      };
      if (polygonContains(region, midpoint) && !isOnPolygonEdge(region, midpoint)) return true;
    }
  }
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
