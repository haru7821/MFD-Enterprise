import type { DrawingClass, DrawingRecord } from './schema';

/**
 * Classifying a drawing from what the file itself says.
 *
 * Implements the taxonomy in `docs/verification/DRAWING_IMPORT_VERIFICATION.md`. Pure, so the rules
 * can be tested without a PDF: the ingester reads the facts off the file, and this decides what
 * they mean. Splitting it that way is what stops the taxonomy living only inside a script nobody
 * runs in CI.
 *
 * ## The rules, and why each is where it is
 *
 * Every threshold below is a judgement, and they are gathered here so they can be argued with in
 * one place rather than found scattered through an ingestion loop.
 */

/** The importer's constants, mirrored so the catalogue predicts what the importer will do. */
export const PDF_RENDER_DPI = 150;
export const MAX_PLAN_PIXELS = 4_096;

/**
 * Extractable characters on page one, above which a PDF is a CAD export rather than a scan.
 *
 * A CAD export carries its room names, dimensions and title block as text objects and yields
 * hundreds of characters. A scan is one image and yields essentially nothing.
 *
 * Forty rather than one, because a scan is often stamped, watermarked or has a text-only cover
 * annotation laid over it, and a handful of characters must not promote it to "vector".
 */
export const VECTOR_TEXT_THRESHOLD = 40;

/**
 * Bytes above which a JPG is more likely a photograph than a scan.
 *
 * Scans of line drawings are mostly white and compress hard; photographs carry sensor noise across
 * every pixel and do not. One megabyte separates them in practice.
 *
 * This produces `photograph_suspected`, which is a **flag for a human**, not a verdict. Perspective
 * distortion cannot be detected from a raster, and it is the single most dangerous input this
 * product can accept — it calibrates plausibly and measures wrongly everywhere away from the
 * calibration line. Flagging generously is right: a false flag costs someone ten seconds, and a
 * missed one puts an invented dimension in a report.
 */
export const PHOTOGRAPH_SUSPECT_BYTES = 1_000_000;

/** ISO sheet sizes, short × long in millimetres. */
const SHEET_SIZES: readonly (readonly [string, number, number])[] = [
  ['A0', 841, 1189],
  ['A1', 594, 841],
  ['A2', 420, 594],
  ['A3', 297, 420],
  ['A4', 210, 297],
];

/** Nearest ISO sheet, or null when the page matches none within 5 %. */
export function sheetSizeOf(widthPt: number, heightPt: number): string | null {
  const widthMm = (widthPt / 72) * 25.4;
  const heightMm = (heightPt / 72) * 25.4;
  const shortSide = Math.min(widthMm, heightMm);
  const longSide = Math.max(widthMm, heightMm);

  for (const [name, short, long] of SHEET_SIZES) {
    // 5 % tolerance: real sheets carry trim margins and are rarely exact.
    if (Math.abs(shortSide - short) / short < 0.05 && Math.abs(longSide - long) / long < 0.05) {
      return name;
    }
  }
  return null;
}

/**
 * The resolution the importer will actually rasterise this page at.
 *
 * The number that decides whether a sheet is traceable. An A0 page wants 4,967 × 7,022 px at
 * 150 dpi and the importer caps the long side at 4,096, so it lands at about 87 dpi and fine
 * dimension text stops being legible. Computed per sheet rather than assumed, because the answer is
 * different for every page size — gap G-4.
 */
export function effectiveDpiOf(widthPt: number, heightPt: number): number {
  const longestPx = (Math.max(widthPt, heightPt) / 72) * PDF_RENDER_DPI;
  return PDF_RENDER_DPI * Math.min(1, MAX_PLAN_PIXELS / longestPx);
}

export interface ClassifyInput {
  readonly format: DrawingRecord['format'];
  /** Extractable characters on page one. Null when the file could not be opened. */
  readonly textCharacters: number | null;
  readonly fileBytes: number;
  /** False when the file could not be opened at all. */
  readonly readable: boolean;
}

export function classifyDrawing(input: ClassifyInput): DrawingClass {
  if (!input.readable) return 'unreadable';

  switch (input.format) {
    case 'pdf':
      return (input.textCharacters ?? 0) >= VECTOR_TEXT_THRESHOLD
        ? 'vector_cad_export'
        : 'scanned_pdf';
    case 'dwg':
    case 'dxf':
      // Not read by this application, by decision. Catalogued so the dataset is complete and an
      // engineer can see what exists, but nothing will import it.
      return 'native_cad';
    case 'jpg':
      return input.fileBytes > PHOTOGRAPH_SUSPECT_BYTES ? 'photograph_suspected' : 'raster_image';
    case 'png':
      return 'raster_image';
    case 'other':
      return 'unknown';
  }
}

/**
 * Whether this drawing can be imported and calibrated at all.
 *
 * Not the same question as its class, and the one an engineer picking a first verification drawing
 * actually asks. A native CAD file is perfectly good engineering and entirely unusable here; a
 * suspected photograph is a raster the application would happily import and must not.
 */
export function isImportable(classification: DrawingClass): boolean {
  return (
    classification === 'vector_cad_export' ||
    classification === 'scanned_pdf' ||
    classification === 'raster_image'
  );
}
