import type { Millimetres } from './units';
import type { Vec2 } from './vec2';

/**
 * Plan transform — the bridge between an imported drawing and model space.
 *
 * A hospital floor plan arrives as pixels with no notion of real-world size. This is
 * the complete transform that gives those pixels a millimetre meaning:
 *
 * ```
 * model_mm = rotate(image_px − origin, rotation) × millimetresPerPixel
 * ```
 *
 * ## Why all three parts, and not just scale
 *
 * Scale alone is not a coordinate system.
 *
 * - Without an **origin** there is nothing to measure *from*. Every position would be
 *   relative to whichever corner the scanner happened to produce.
 * - Without a **rotation** a plan scanned three degrees off square puts every
 *   clearance three degrees off — and hospital floor plans do not arrive square to
 *   the page.
 *
 * ## Why it lives in cad-engine
 *
 * It is geometry, not rendering (AD-2), and it is needed by the browser for live
 * feedback and by the server for the authoritative report (AD-3). Nothing here
 * touches the DOM, a file, or a clock.
 *
 * The `CoordinateMapping` record in `@mfd/document-model` is this interface plus its
 * provenance — the calibration evidence and the timestamp. Everything that computes
 * takes the bare transform.
 */
export interface PlanTransform {
  /** How large the drawing is: model millimetres per image pixel. */
  readonly millimetresPerPixel: number;
  /** The image pixel that is model (0, 0). */
  readonly origin: Vec2;
  /** Millidegrees, so a quarter turn stays exact. Positive turns clockwise on screen. */
  readonly rotation: number;
}

/** Smallest scale we accept. Below this the drawing is not a drawing. */
export const MIN_MM_PER_PIXEL = 1e-6;

export function millidegreesToRadians(millidegrees: number): number {
  return (millidegrees / 1000) * (Math.PI / 180);
}

export function radiansToMillidegrees(radians: number): number {
  return Math.round((radians * 180) / Math.PI) * 1000;
}

function rotate(v: Vec2, radians: number): Vec2 {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

/** Image pixel → model millimetres. */
export function pixelToModel(transform: PlanTransform, pixel: Vec2): Vec2 {
  const translated = { x: pixel.x - transform.origin.x, y: pixel.y - transform.origin.y };
  const rotated = rotate(translated, millidegreesToRadians(transform.rotation));
  return {
    x: rotated.x * transform.millimetresPerPixel,
    y: rotated.y * transform.millimetresPerPixel,
  };
}

/** Model millimetres → image pixel. Exact inverse of {@link pixelToModel}. */
export function modelToPixel(transform: PlanTransform, model: Vec2): Vec2 {
  const scaled = {
    x: model.x / transform.millimetresPerPixel,
    y: model.y / transform.millimetresPerPixel,
  };
  const rotated = rotate(scaled, -millidegreesToRadians(transform.rotation));
  return { x: rotated.x + transform.origin.x, y: rotated.y + transform.origin.y };
}

/** Convert a pixel length to millimetres. Rotation does not affect lengths. */
export function pixelLengthToModel(transform: PlanTransform, pixels: number): Millimetres {
  return pixels * transform.millimetresPerPixel;
}

export function modelLengthToPixel(transform: PlanTransform, millimetres: Millimetres): number {
  return millimetres / transform.millimetresPerPixel;
}

/**
 * Scale from two picked points and the real distance between them.
 *
 * This is the two-point calibration an engineer performs against a dimension line or
 * a known door width. Returns null rather than a scale when the two points are the
 * same pixel or the stated distance is not positive — a scale of zero or infinity
 * would silently make every later measurement meaningless.
 */
export function millimetresPerPixelFromTwoPoints(
  pointA: Vec2,
  pointB: Vec2,
  knownDistance: Millimetres,
): number | null {
  if (!(knownDistance > 0) || !Number.isFinite(knownDistance)) return null;

  const pixelDistance = Math.hypot(pointB.x - pointA.x, pointB.y - pointA.y);
  if (pixelDistance <= 0) return null;

  const scale = knownDistance / pixelDistance;
  return scale >= MIN_MM_PER_PIXEL && Number.isFinite(scale) ? scale : null;
}

/**
 * Scale from a drawing's stated ratio, e.g. "1:100", at a given output resolution.
 *
 * A 1:100 plan printed at 300 dpi has one pixel covering 100 / (300 / 25.4) mm. The
 * dpi has to come from the caller because a raster PDF page carries it while a
 * photograph of a printout does not.
 */
export function millimetresPerPixelFromRatio(ratio: number, dotsPerInch: number): number | null {
  if (!(ratio > 0) || !(dotsPerInch > 0)) return null;
  const scale = ratio * (25.4 / dotsPerInch);
  return scale >= MIN_MM_PER_PIXEL && Number.isFinite(scale) ? scale : null;
}

/** Parse "1:100" or "1 : 100" into its denominator. Null when it is not a ratio. */
export function parseStatedRatio(stated: string): number | null {
  const match = /^\s*1\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(stated);
  if (!match?.[1]) return null;
  const denominator = Number(match[1]);
  return denominator > 0 ? denominator : null;
}

/**
 * Rotation that makes the segment A→B horizontal in model space.
 *
 * The engineer picks two points along something they know runs straight — a corridor
 * wall, a dimension line — and the plan is turned until it does.
 */
export function rotationFromReferenceLine(pointA: Vec2, pointB: Vec2): number | null {
  const dx = pointB.x - pointA.x;
  const dy = pointB.y - pointA.y;
  if (Math.hypot(dx, dy) <= 0) return null;
  // `|| 0` folds negative zero away: a plan already square to the page must report a
  // rotation of exactly 0, not -0, or the saved document differs from the same
  // document calibrated the other way round.
  return -radiansToMillidegrees(Math.atan2(dy, dx)) || 0;
}

/** Is this transform usable for measurement? */
export function isUsableTransform(transform: PlanTransform | null): transform is PlanTransform {
  return (
    transform !== null &&
    Number.isFinite(transform.millimetresPerPixel) &&
    transform.millimetresPerPixel >= MIN_MM_PER_PIXEL &&
    Number.isFinite(transform.origin.x) &&
    Number.isFinite(transform.origin.y) &&
    Number.isFinite(transform.rotation)
  );
}
