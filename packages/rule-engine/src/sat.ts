import type { Vec2 } from '@mfd/cad-engine';

/**
 * Convex polygon overlap by the separating axis theorem.
 *
 * Equipment footprints rotate, so an axis-aligned bounds test is not merely
 * imprecise — it reports a collision between two machines that are turned 45° and
 * comfortably apart. Every test here works on the actual rotated polygon.
 *
 * The theorem: two convex polygons are disjoint exactly when some axis exists on
 * which their projections do not overlap. For polygons it suffices to test the
 * normals of their edges, so a pair of rectangles needs four axes.
 */

export interface Projection {
  readonly min: number;
  readonly max: number;
}

export function projectOnto(polygon: readonly Vec2[], axis: Vec2): Projection {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const point of polygon) {
    const value = point.x * axis.x + point.y * axis.y;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  return { min, max };
}

/** Unit normals of a polygon's edges. Duplicates are harmless, only slower. */
export function edgeNormals(polygon: readonly Vec2[]): Vec2[] {
  const normals: Vec2[] = [];

  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    if (!a || !b) continue;

    const edgeX = b.x - a.x;
    const edgeY = b.y - a.y;
    const length = Math.hypot(edgeX, edgeY);
    if (length === 0) continue;

    // Normal of (x, y) is (-y, x), normalised.
    normals.push({ x: -edgeY / length, y: edgeX / length });
  }

  return normals;
}

export interface OverlapResult {
  readonly overlapping: boolean;
  /**
   * How deeply the polygons interpenetrate, in millimetres — the smallest
   * translation that would separate them. Zero when they are apart.
   */
  readonly penetration: number;
}

/**
 * Do two convex polygons overlap, and by how much?
 *
 * Touching exactly along an edge is **not** an overlap: two machines pushed flat
 * against each other are a clearance question, not a collision, and reporting a
 * collision at exactly zero distance would fire on every tidy layout.
 */
export function polygonsOverlap(a: readonly Vec2[], b: readonly Vec2[]): OverlapResult {
  const axes = [...edgeNormals(a), ...edgeNormals(b)];
  let smallestOverlap = Number.POSITIVE_INFINITY;

  for (const axis of axes) {
    const projectionA = projectOnto(a, axis);
    const projectionB = projectOnto(b, axis);

    const overlap =
      Math.min(projectionA.max, projectionB.max) - Math.max(projectionA.min, projectionB.min);

    // A separating axis exists: the polygons are disjoint, and nothing else matters.
    if (overlap <= 0) return { overlapping: false, penetration: 0 };

    if (overlap < smallestOverlap) smallestOverlap = overlap;
  }

  return { overlapping: true, penetration: smallestOverlap };
}

/**
 * Clip a convex polygon to the closed band `axis · point ∈ [min, max]` — Sutherland-Hodgman
 * against two parallel half-planes.
 *
 * `gapAlongNormal` needs this because the lateral overlap test alone only decides *whether* to
 * look at a neighbour, not *which part* of it to measure: a corner can sit well outside a face's
 * own width and still belong to a polygon that clips the lateral test. Projecting the unclipped
 * polygon onto the face normal would let that far corner's distance stand for the whole
 * neighbour — measuring against geometry standing beside the face, not in front of it, exactly
 * what the lateral test exists to rule out.
 */
function clipToBand(polygon: readonly Vec2[], axis: Vec2, min: number, max: number): Vec2[] {
  return clipHalfPlane(clipHalfPlane(polygon, axis, min, false), axis, max, true);
}

/** Keep the part of `polygon` on one side of `axis · point = bound`. */
function clipHalfPlane(
  polygon: readonly Vec2[],
  axis: Vec2,
  bound: number,
  keepBelow: boolean,
): Vec2[] {
  if (polygon.length === 0) return [];

  const project = (p: Vec2) => p.x * axis.x + p.y * axis.y;
  const inside = (p: Vec2) => (keepBelow ? project(p) <= bound : project(p) >= bound);
  const intersect = (a: Vec2, b: Vec2): Vec2 => {
    const t = (bound - project(a)) / (project(b) - project(a));
    return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
  };

  const output: Vec2[] = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const previous = polygon[(index - 1 + polygon.length) % polygon.length];
    if (!current || !previous) continue;

    const currentIn = inside(current);
    if (currentIn !== inside(previous)) output.push(intersect(previous, current));
    if (currentIn) output.push(current);
  }

  return output;
}

/**
 * Is a polygon convex?
 *
 * `gapAlongNormal` takes the single minimum projection across whatever survives its clip, on the
 * assumption that the nearest point of the clipped band is the nearest *material* — true only when
 * the polygon has no concavity to wrap a disconnected far piece into that same band. A staple- or
 * L-shaped obstruction can present a near arm and a far arm both inside a face's lateral extent;
 * `gapAlongNormal` cannot tell them apart, and reports whichever projects closer to the face
 * regardless of which arm it actually belongs to. Callers that cannot tolerate that — see
 * `@mfd/ai-local`'s `freeDistanceOnSide` — check this first and decline to measure otherwise.
 *
 * Orientation-agnostic: convexity is "every turn the same way", checked by the sign of the cross
 * product at each vertex, independent of whether the polygon winds clockwise or counter-clockwise.
 * A genuinely straight-through vertex (collinear, edges pointing the same way) turns neither way
 * and is skipped rather than failing the check.
 *
 * The sign check alone is necessary but not sufficient — the tenth review round found it accepts a
 * self-intersecting star polygon (five points of a pentagram, traced in star order): every vertex
 * turns the same way, yet the shape winds around its own centre twice rather than once. This also
 * sums the signed turning angle at every vertex (`atan2(cross, dot)`, the exterior angle) and
 * requires the total to be one full turn — true of any simple convex polygon, false of a shape
 * that winds more than once. It does not attempt full self-intersection detection (a slit that
 * neither reverses direction nor changes the winding number would still pass); that is a larger
 * geometry investment than this check is meant to be.
 *
 * Collinearity is judged by `sin(angle between edges)`, not the raw cross product: a raw
 * millimetre-scale threshold would misread a long, nearly-straight run — a level's outline can span
 * tens of metres — as a turn from floating-point noise alone, where the scale-invariant sine does
 * not. A vertex whose edges point in *opposite* directions (a zero-width spike or slit) has the
 * same near-zero sine as a genuine straight-through vertex, but the opposite dot product sign; that
 * case is treated as a concavity rather than skipped; a real straight run does not reverse.
 *
 * **The eleventh review round found a consecutive duplicate vertex — including a redundantly
 * closed ring, `vertices[0] === vertices[last]`, both reachable from an ordinary traced boundary
 * (grid snapping makes two neighbouring points coincide easily) — corrupted a genuinely convex
 * rectangle into a rejected one.** The zero-length-edge check above (`abLength === 0`) skips
 * *both* index positions straddling the duplicate, so the real corner sitting between them was
 * never added to `turning` and the sum landed short of a full turn. Duplicate points carry no
 * geometry of their own, so they are collapsed out of the vertex list before the corner walk
 * begins, rather than skipped mid-walk — the same corner is then seen exactly once, by its two
 * genuine neighbours, whichever positions in the original array those turned out to be.
 *
 * The deduplication is **exact-equality**, not a distance tolerance — deliberately: today's only
 * caller (`@mfd/ai-local`'s `freeDistanceOnSide`) passes an obstruction's traced vertices
 * untransformed (`runSolver.ts` reads `boundary.vertices` directly). Exact equality is what grid
 * snapping actually produces, and a distance tolerance would need a scale to compare against —
 * the same scale question `sinAngle`'s epsilon already answers for collinearity, not one this
 * function should answer twice with two different numbers. **If a caller ever feeds this rotated
 * or otherwise transformed geometry**, floating-point arithmetic can turn an exact duplicate into
 * a near-duplicate a fraction of a millimetre apart, which this check would then treat as two
 * genuine, very-short edges rather than one degenerate point — a convex obstruction could then
 * read as non-convex and needlessly void `compliance_margin`. Not a defect in what exists today,
 * only a constraint on what may be added without revisiting this function first.
 */
export function isConvexPolygon(polygon: readonly Vec2[]): boolean {
  const vertices: Vec2[] = [];
  for (const point of polygon) {
    const previous = vertices[vertices.length - 1];
    if (previous && previous.x === point.x && previous.y === point.y) continue;
    vertices.push(point);
  }
  while (
    vertices.length > 1 &&
    vertices[0]!.x === vertices[vertices.length - 1]!.x &&
    vertices[0]!.y === vertices[vertices.length - 1]!.y
  ) {
    vertices.pop();
  }

  if (vertices.length < 4) return true;

  let sign = 0;
  let turning = 0;

  for (let index = 0; index < vertices.length; index += 1) {
    const a = vertices[index];
    const b = vertices[(index + 1) % vertices.length];
    const c = vertices[(index + 2) % vertices.length];
    if (!a || !b || !c) continue;

    const abX = b.x - a.x;
    const abY = b.y - a.y;
    const bcX = c.x - b.x;
    const bcY = c.y - b.y;
    const abLength = Math.hypot(abX, abY);
    const bcLength = Math.hypot(bcX, bcY);
    if (abLength === 0 || bcLength === 0) continue;

    const cross = abX * bcY - abY * bcX;
    const dot = abX * bcX + abY * bcY;
    const sinAngle = cross / (abLength * bcLength);

    if (Math.abs(sinAngle) < 1e-9) {
      // Same near-zero sine as a straight-through vertex, but pointing backward: a zero-width
      // spike or slit, not an honest collinear pass-through.
      if (dot < 0) return false;
      continue;
    }

    const turn = cross > 0 ? 1 : -1;
    if (sign === 0) sign = turn;
    else if (turn !== sign) return false;

    turning += Math.atan2(cross, dot);
  }

  return Math.abs(Math.abs(turning) - 2 * Math.PI) < 1e-3;
}

/**
 * Free distance from a face to another polygon, measured along the face normal.
 *
 * Returns null when the other polygon does not lie in front of the face at all —
 * either behind it, or off to one side. That is a genuine "nothing there", not a
 * distance of zero, and the two must not be confused: zero would read as a machine
 * pressed against the face.
 *
 * The measurement is taken against the neighbour **clipped to the face's own lateral
 * extent** — `faceExtent.min`/`max` — not its whole footprint. A neighbour that only partly
 * overlaps the face's width can still have most of itself standing to one side, and that part
 * is not "in front of" the face any more than a neighbour the lateral test rejects outright is;
 * measuring against it read a machine standing beside the face as if it stood in front of it,
 * confirmed reachable with an ordinary rotated placement (owner decision, seventh Critical 0
 * review round, following the "minimum across the whole face" contract this function has always
 * documented — the clip is that contract applied to a corner, not a change to it).
 *
 * A negative result means the polygon — the clipped part actually in front of the face — has
 * crossed the face plane.
 */
export function gapAlongNormal(
  face: { readonly origin: Vec2; readonly normal: Vec2 },
  faceExtent: { readonly axis: Vec2; readonly min: number; readonly max: number },
  other: readonly Vec2[],
): number | null {
  // Ignore anything that does not overlap the face's own width — a machine beside
  // the one being checked is not in front of it.
  const lateral = projectOnto(other, faceExtent.axis);
  if (lateral.max <= faceExtent.min || lateral.min >= faceExtent.max) return null;

  const clipped = clipToBand(other, faceExtent.axis, faceExtent.min, faceExtent.max);
  if (clipped.length === 0) return null;

  const facePosition = face.origin.x * face.normal.x + face.origin.y * face.normal.y;
  const ahead = projectOnto(clipped, face.normal);

  // Entirely behind the face plane: not in front.
  if (ahead.max <= facePosition) return null;

  return ahead.min - facePosition;
}
