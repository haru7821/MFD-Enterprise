import type { Vec2 } from './vec2';

/** Axis-aligned rectangle. Model-space rectangles are in millimetres. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

/** Build a rectangle from two opposite corners, in any order. */
export function rectFromCorners(a: Vec2, b: Vec2): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

export function rectRight(r: Rect): number {
  return r.x + r.width;
}

export function rectBottom(r: Rect): number {
  return r.y + r.height;
}

export function rectCentre(r: Rect): Vec2 {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

export function rectContains(r: Rect, point: Vec2): boolean {
  return (
    point.x >= r.x && point.x <= rectRight(r) && point.y >= r.y && point.y <= rectBottom(r)
  );
}

/** Grow (or shrink, with a negative amount) a rectangle on every side. */
export function expandRect(r: Rect, amount: number): Rect {
  return {
    x: r.x - amount,
    y: r.y - amount,
    width: r.width + amount * 2,
    height: r.height + amount * 2,
  };
}
