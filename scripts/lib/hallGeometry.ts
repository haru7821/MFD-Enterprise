import {
  angleGap,
  foldAngle,
  type PrintedDimension,
  type Segment,
} from '../../packages/layout-knowledge/src/index';

/**
 * Measuring a room the drawing does not dimension.
 *
 * > Owner principle, restated for the verification programme: *"도면 데이터에서 없는 값은 추정하지
 * > 않는다 … Dimension line이 없으면 measurement unavailable 표시."*
 *
 * Hospital_044 prints its hall's **length** and not its **width**. The pipeline needs both, so the
 * width has to come from somewhere, and there are only two honest options: report it unavailable
 * and stop, or measure it against the scale the dimension lines established. This does the second,
 * and the result is recorded as `calibrated_measurement` — the weakest method on the list, ranked
 * below `dimension_line` precisely because it inherits every uncertainty of the calibration.
 *
 * ## What this is not
 *
 * It is not wall detection, and the product still has none. It does not trace a room, find a door,
 * or produce a polygon. It answers one question — how far is it from one wall face to the other,
 * across a named cross-section — which is the question an engineer answers by clicking twice. The
 * rule is written out below so the answer can be checked rather than trusted.
 *
 * ## The rule, and the two things that make it safe
 *
 * A wall on an architectural plan is drawn as a **pair of parallel lines** a wall's thickness apart.
 * That pairing is the signal: a single line crossing a room is furniture, a zone boundary, a grid
 * or a dimension, and only a pair at plausible wall thickness is a wall.
 *
 * 1. **Both lines of a pair must be the same colour.** CAD layers survive plotting as colours, and
 *    the two faces of a wall are the same object on the same layer. Without this the reference
 *    drawing pairs a grey setting-out line with a red grid line 201 mm away and reports a wall
 *    where there is nothing at all — two unrelated lines that happen to pass close.
 * 2. **The outermost pairs bound the room**, not the nearest ones to some seed point. Furniture
 *    drawn as a double line — and the reference drawing has bed frames 202 mm across — is a
 *    plausible wall pair by every local test. It is never the outermost one.
 *
 * Where no such pair exists on both sides the answer is null. Null propagates to *measurement
 * unavailable*; it does not fall back to something.
 */

/** Plausible wall thickness, millimetres. Below is a single line, above is two walls with a gap. */
export const MIN_WALL_THICKNESS_MM = 90;
export const MAX_WALL_THICKNESS_MM = 350;

export interface RoomWidthMeasurement {
  readonly widthMm: number;
  /** The two inner faces, in page points — the two points an engineer would click. */
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
  /** The two wall thicknesses found, millimetres. Reported so the pairing can be checked. */
  readonly wallThicknessMm: readonly [number, number];
  /** Where the cross-section was taken, in page points. */
  readonly station: { readonly x: number; readonly y: number };
}

/**
 * Measure across a room, on a cross-section through the middle of a dimension running along it.
 *
 * @param axis a dimension running along the room, which fixes both the direction to measure across
 *   and where along the room to cut
 * @param scale the sheet's agreed scale denominator, for converting page points to millimetres
 */
export function measureRoomWidth(
  segments: readonly Segment[],
  axis: PrintedDimension,
  scale: number,
  angleTolerance = 1.5,
): RoomWidthMeasurement | null {
  const dx = axis.to.x - axis.from.x;
  const dy = axis.to.y - axis.from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;

  const ux = dx / length;
  const uy = dy / length;
  const axisAngle = foldAngle((Math.atan2(dy, dx) * 180) / Math.PI);
  const mmPerPt = (scale * 25.4) / 72;
  const station = { x: (axis.from.x + axis.to.x) / 2, y: (axis.from.y + axis.to.y) / 2 };

  /** Runs parallel to the room that cross the section, by colour, as offsets across it. */
  const byColour = new Map<string, number[]>();
  for (const segment of segments) {
    if (angleGap(segment.angle, axisAngle) > angleTolerance) continue;
    const a1 = (segment.x1 - station.x) * ux + (segment.y1 - station.y) * uy;
    const a2 = (segment.x2 - station.x) * ux + (segment.y2 - station.y) * uy;
    if (Math.min(a1, a2) > 0 || Math.max(a1, a2) < 0) continue;
    const offset =
      ((segment.x1 - station.x) * uy -
        (segment.y1 - station.y) * ux +
        ((segment.x2 - station.x) * uy - (segment.y2 - station.y) * ux)) /
      2;
    const found = byColour.get(segment.stroke);
    if (found) found.push(offset);
    else byColour.set(segment.stroke, [offset]);
  }

  const minPt = MIN_WALL_THICKNESS_MM / mmPerPt;
  const maxPt = MAX_WALL_THICKNESS_MM / mmPerPt;

  /** Every same-colour pair at plausible wall thickness, as [nearFace, farFace] offsets. */
  const walls: { inner: number; outer: number; thicknessMm: number }[] = [];
  for (const offsets of byColour.values()) {
    const sorted = [...offsets].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const gap = sorted[j]! - sorted[i]!;
        if (gap < minPt) continue;
        if (gap > maxPt) break;
        walls.push({ inner: sorted[j]!, outer: sorted[i]!, thicknessMm: gap * mmPerPt });
      }
    }
  }
  if (walls.length < 2) return null;

  // The outermost wall on each side. `inner`/`outer` are named from the low-offset side, so the
  // low-side wall's room-facing face is its larger offset and the high-side wall's is its smaller.
  const low = walls.reduce((best, next) => (next.outer < best.outer ? next : best));
  const high = walls.reduce((best, next) => (next.inner > best.inner ? next : best));
  const lowFace = low.inner;
  const highFace = high.outer;
  const widthPt = highFace - lowFace;
  if (widthPt <= 0) return null;

  return {
    widthMm: widthPt * mmPerPt,
    from: { x: station.x + uy * lowFace, y: station.y - ux * lowFace },
    to: { x: station.x + uy * highFace, y: station.y - ux * highFace },
    wallThicknessMm: [low.thicknessMm, high.thicknessMm],
    station,
  };
}
