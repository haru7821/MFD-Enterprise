import type { Millimetres } from './units';
import { type ScreenSize, type Viewport, visibleWorldRect } from './viewport';

/**
 * Adaptive millimetre grid.
 *
 * The grid is a measuring instrument, not decoration: its spacing is always a round
 * number of millimetres, so what the user sees on screen ("every line is 100 mm")
 * is a fact they can design against. As the view zooms out the engine steps up
 * through the 1–2–5 sequence so lines never crowd into a grey wash.
 */

/** Round steps in the 1–2–5 sequence, from 1 mm to 100 m. */
export const GRID_STEPS_MM: readonly Millimetres[] = [
  1, 2, 5, 10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000,
];

/** Below this on-screen spacing a minor grid stops being readable. */
export const MIN_MINOR_PIXEL_SPACING = 8;

/** Defensive cap: a pathological viewport size must not emit unbounded geometry. */
export const MAX_LINES_PER_AXIS = 2_000;

export interface GridSpec {
  /** Spacing between minor lines, in millimetres. */
  readonly step: Millimetres;
  /** A major line is drawn every N minor steps. */
  readonly majorEvery: number;
  /** Spacing between major lines, in millimetres. */
  readonly majorStep: Millimetres;
}

/**
 * Choose the finest round step whose on-screen spacing is still readable.
 *
 * Major lines land on the next decade: 1 mm steps major every 10, 2 mm every 5,
 * 5 mm every 2 — so a major line is always a whole power of ten.
 */
export function chooseGridSpec(
  scale: number,
  minPixelSpacing: number = MIN_MINOR_PIXEL_SPACING,
): GridSpec {
  const coarsest = GRID_STEPS_MM[GRID_STEPS_MM.length - 1] ?? 100_000;
  const step = GRID_STEPS_MM.find((candidate) => candidate * scale >= minPixelSpacing) ?? coarsest;

  const exponent = Math.floor(Math.log10(step));
  const mantissa = Math.round(step / 10 ** exponent);
  const majorEvery = mantissa === 1 ? 10 : mantissa === 2 ? 5 : 2;

  return { step, majorEvery, majorStep: step * majorEvery };
}

export interface GridLines {
  readonly spec: GridSpec;
  /** Model-space X positions of minor vertical lines (majors excluded). */
  readonly minorX: readonly Millimetres[];
  /** Model-space Y positions of minor horizontal lines (majors excluded). */
  readonly minorY: readonly Millimetres[];
  readonly majorX: readonly Millimetres[];
  readonly majorY: readonly Millimetres[];
}

function linePositions(from: number, to: number, step: number): number[] {
  const first = Math.floor(from / step) * step;
  const count = Math.floor((to - first) / step) + 1;
  if (count <= 0) return [];

  const positions: number[] = [];
  for (let index = 0; index < Math.min(count, MAX_LINES_PER_AXIS); index += 1) {
    positions.push(first + index * step);
  }
  return positions;
}

/** Is this position on a major line? Tolerant of floating-point drift. */
function isMajor(position: number, majorStep: number): boolean {
  const remainder = Math.abs(position % majorStep);
  return remainder < 1e-6 || Math.abs(remainder - majorStep) < 1e-6;
}

/**
 * Compute the grid lines covering the visible model-space rectangle.
 *
 * Returns model-space coordinates. The renderer applies the viewport transform —
 * this function never produces a pixel.
 */
export function computeGridLines(viewport: Viewport, screen: ScreenSize): GridLines {
  const spec = chooseGridSpec(viewport.scale);
  const visible = visibleWorldRect(viewport, screen);

  const allX = linePositions(visible.x, visible.x + visible.width, spec.step);
  const allY = linePositions(visible.y, visible.y + visible.height, spec.step);

  const minorX: number[] = [];
  const majorX: number[] = [];
  for (const x of allX) (isMajor(x, spec.majorStep) ? majorX : minorX).push(x);

  const minorY: number[] = [];
  const majorY: number[] = [];
  for (const y of allY) (isMajor(y, spec.majorStep) ? majorY : minorY).push(y);

  return { spec, minorX, minorY, majorX, majorY };
}
