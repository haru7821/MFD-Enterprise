import type { Vec2 } from './vec2';

/**
 * A rigid placement transform in model space.
 *
 * Lives here rather than beside `Placement` because it is geometry: the equipment
 * library rotates footprints with it and the document model stores it, and neither
 * should have to depend on the other to name the same three numbers.
 */
export interface Transform {
  /** Position of the object's local origin, in model millimetres. */
  readonly position: Vec2;
  /**
   * Rotation in millidegrees.
   *
   * Millidegrees rather than radians so a quarter turn is exactly 90,000 — a value
   * that survives a save, a load and a JSON round trip unchanged. Radians would make
   * 90° an irrational number that drifts every time it is written out and read back.
   */
  readonly rotation: number;
  /** Some installations are handed. */
  readonly mirrored: boolean;
}

export const IDENTITY_TRANSFORM: Transform = Object.freeze({
  position: Object.freeze({ x: 0, y: 0 }),
  rotation: 0,
  mirrored: false,
});

/** A full turn, in millidegrees. */
export const FULL_TURN_MILLIDEGREES = 360_000;

/**
 * Fold a rotation into [0, 360,000).
 *
 * Rotating a machine four times by 90° must give back the transform it started with,
 * not 360,000 millidegrees — otherwise two identical layouts compare as different and
 * a document diff shows a change that is not there.
 */
export function normaliseRotation(millidegrees: number): number {
  if (!Number.isFinite(millidegrees)) return 0;
  const folded = millidegrees % FULL_TURN_MILLIDEGREES;
  return folded < 0 ? folded + FULL_TURN_MILLIDEGREES : folded;
}
