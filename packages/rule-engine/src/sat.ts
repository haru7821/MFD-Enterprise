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
