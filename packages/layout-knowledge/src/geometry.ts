/**
 * The shape of vector content read off a drawing.
 *
 * Plain data, deliberately. A PDF parser is a Node dependency and this package is imported by the
 * solver, which runs in the browser; keeping the *shape* here and the *reading* in
 * `scripts/lib/pdfGeometry.ts` is what lets the dimension reader be unit-tested in CI without a
 * megabyte of parser reaching a bundle.
 *
 * Coordinates are **page points, y down from the top-left**. A point is 1/72 inch, so a sheet
 * plotted at natural size converts to paper millimetres by 25.4/72 and needs no other information.
 */

/** A straight run of a path. */
export interface Segment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  /** Stroke colour, e.g. `#00b8b8`. CAD layers survive plotting as colours, and little else does. */
  readonly stroke: string;
  readonly length: number;
  /** Direction in degrees, folded into [0, 180) — a segment has no preferred end. */
  readonly angle: number;
}

/** A text run with the position and rotation it is drawn at. */
export interface TextRun {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  /** Baseline direction in degrees, folded into [0, 180). */
  readonly angle: number;
  readonly height: number;
}

/** Fold a direction into [0, 180). */
export function foldAngle(degrees: number): number {
  const folded = degrees % 180;
  return folded < 0 ? folded + 180 : folded;
}

/**
 * Smallest angle between two folded directions, degrees.
 *
 * Folded, so 179° and 1° are two degrees apart rather than 178. Getting this wrong makes a reader
 * fail on exactly the drawings that are nearly axis-aligned, which is most of them.
 */
export function angleGap(a: number, b: number): number {
  const raw = Math.abs(a - b) % 180;
  return Math.min(raw, 180 - raw);
}

/** One page's worth of readable content. */
export interface PageGeometry {
  readonly widthPt: number;
  readonly heightPt: number;
  readonly segments: readonly Segment[];
  readonly texts: readonly TextRun[];
}
