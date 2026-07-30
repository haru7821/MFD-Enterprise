/**
 * Page geometry and the type scale — **data**, so A4/A3 and portrait/landscape are a
 * parameter rather than a rewrite.
 *
 * All dimensions are PDF points (1/72 inch), which is what `pdf-lib` speaks. Millimetres are
 * converted once, here, so no other file in the renderer mixes the two unit systems — the
 * single most likely source of a page that is subtly the wrong size.
 */

export const MM_PER_INCH = 25.4;
export const POINTS_PER_INCH = 72;

export function mmToPoints(millimetres: number): number {
  return (millimetres / MM_PER_INCH) * POINTS_PER_INCH;
}

export interface PageSpec {
  readonly width: number;
  readonly height: number;
}

/**
 * ISO page sizes, in points.
 *
 * Landscape for the wide tables is not a stylistic preference: a bilingual header is roughly
 * 1.7× the width of English alone, and the placement, validation and standards tables all
 * carry seven or eight columns. On A4 portrait those clip; the alternative would be shrinking
 * the type until a hospital cannot read it.
 */
export const PAGES = {
  A4_PORTRAIT: { width: mmToPoints(210), height: mmToPoints(297) },
  A4_LANDSCAPE: { width: mmToPoints(297), height: mmToPoints(210) },
  A3_LANDSCAPE: { width: mmToPoints(420), height: mmToPoints(297) },
} as const satisfies Record<string, PageSpec>;

export interface Margins {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export const MARGINS: Margins = {
  top: mmToPoints(18),
  right: mmToPoints(14),
  // Deeper, because the page number and the running footer live here.
  bottom: mmToPoints(20),
  left: mmToPoints(14),
};

/**
 * The type scale.
 *
 * Small, and deliberately so: this is an engineering document, and a table of forty findings
 * on four pages is more usable than the same table on nine. 8 pt is the floor — below that a
 * printed figure stops being reliably legible, which for a dimension is not a cosmetic
 * problem.
 */
export const TYPE = {
  title: 20,
  sectionHeading: 12,
  subHeading: 10,
  body: 8.5,
  tableHeader: 7,
  tableCell: 7.5,
  small: 6.5,
} as const;

/** Line height for a size, generous enough for Hangul, which is taller than Latin. */
export function leading(size: number): number {
  return size * 1.45;
}

export const RULE_WEIGHT = 0.6;
export const SECTION_GAP = 14;
export const ROW_PADDING = 3;
