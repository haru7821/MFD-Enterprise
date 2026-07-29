/**
 * Immutable 2D vector.
 *
 * Used for both model-space points (millimetres) and screen-space points (pixels).
 * Which one a given value is comes from the function signature that produced it —
 * see {@link worldToScreen} and {@link screenToWorld}.
 */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export const ORIGIN: Vec2 = Object.freeze({ x: 0, y: 0 });

export function vec2(x: number, y: number): Vec2 {
  return { x, y };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function subtract(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(v: Vec2, factor: number): Vec2 {
  return { x: v.x * factor, y: v.y * factor };
}

export function magnitude(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Compare with a tolerance. Never compare floating-point coordinates with `===`. */
export function equals(a: Vec2, b: Vec2, epsilon = 1e-9): boolean {
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;
}

/** Snap a point to the nearest multiple of `step`. `step <= 0` disables snapping. */
export function snapToStep(point: Vec2, step: number): Vec2 {
  if (step <= 0) return point;
  return { x: Math.round(point.x / step) * step, y: Math.round(point.y / step) * step };
}
