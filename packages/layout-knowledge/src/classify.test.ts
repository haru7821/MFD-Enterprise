import { describe, expect, it } from 'vitest';

import {
  MAX_PLAN_PIXELS,
  PDF_RENDER_DPI,
  PHOTOGRAPH_SUSPECT_BYTES,
  VECTOR_TEXT_THRESHOLD,
  classifyDrawing,
  effectiveDpiOf,
  isImportable,
  sheetSizeOf,
} from './classify';

/**
 * The drawing taxonomy, from `docs/verification/DRAWING_IMPORT_VERIFICATION.md`.
 *
 * These rules used to live only in an ingestion script, which meant they ran when somebody
 * remembered to run it. Moved into the package so CI exercises them, because the classification
 * decides which drawings an engineer is offered as candidates — and getting it wrong sends someone
 * to trace a photograph.
 */

const A4 = [595.28, 841.89] as const;
const A1 = [1683.78, 2383.94] as const;
const A0 = [2383.94, 3370.39] as const;

describe('sheet size', () => {
  it.each([
    ['A4', A4],
    ['A1', A1],
    ['A0', A0],
  ])('names a %s page', (name, [width, height]) => {
    expect(sheetSizeOf(width, height)).toBe(name);
  });

  it('names a landscape page the same as a portrait one', () => {
    // A drawing is as often landscape as portrait, and "A1" is the same sheet either way.
    expect(sheetSizeOf(A1[1], A1[0])).toBe('A1');
  });

  it('returns null for a page that is no standard size', () => {
    // Trimmed, custom or a fold-out. Null rather than the nearest guess: the size is used to warn
    // about resolution loss, and a wrong label would move the warning to the wrong sheet.
    expect(sheetSizeOf(1_000, 1_000)).toBeNull();
  });
});

describe('effective resolution', () => {
  it('leaves a small sheet at the full rendering resolution', () => {
    expect(effectiveDpiOf(...A4)).toBeCloseTo(PDF_RENDER_DPI, 6);
  });

  it('drops an A0 sheet to about 87 dpi, which is gap G-4', () => {
    /*
     * The number that decides whether a sheet is traceable. An A0 page wants 4,967 × 7,022 px at
     * 150 dpi and the importer caps the long side at 4,096, so fine dimension text stops being
     * legible. Asserted as arithmetic against the two constants rather than a magic 87, so it
     * follows if either constant moves.
     */
    const longestPx = (A0[1] / 72) * PDF_RENDER_DPI;
    expect(effectiveDpiOf(...A0)).toBeCloseTo(PDF_RENDER_DPI * (MAX_PLAN_PIXELS / longestPx), 6);
    expect(effectiveDpiOf(...A0)).toBeLessThan(90);
  });

  it('drops an A1 sheet, but far less', () => {
    // Between the two: A1 lands around 124 dpi, which is usually still traceable. The point of
    // computing this per sheet rather than assuming is that the answer differs by page size.
    expect(effectiveDpiOf(...A1)).toBeGreaterThan(110);
    expect(effectiveDpiOf(...A1)).toBeLessThan(PDF_RENDER_DPI);
  });
});

describe('classifying a drawing', () => {
  const readable = { fileBytes: 100_000, readable: true } as const;

  it('calls a text-bearing PDF a CAD export', () => {
    expect(
      classifyDrawing({ ...readable, format: 'pdf', textCharacters: VECTOR_TEXT_THRESHOLD }),
    ).toBe('vector_cad_export');
  });

  it('calls a PDF with almost no text a scan', () => {
    // A scan is one image and yields nothing extractable.
    expect(classifyDrawing({ ...readable, format: 'pdf', textCharacters: 0 })).toBe('scanned_pdf');
  });

  it('does not promote a stamped scan to a CAD export', () => {
    /*
     * The reason the threshold is 40 and not 1. A scan is routinely stamped, watermarked or has a
     * text annotation laid over it, and a handful of characters must not make it look like a
     * drawing whose dimensions can be read as text.
     */
    expect(
      classifyDrawing({ ...readable, format: 'pdf', textCharacters: VECTOR_TEXT_THRESHOLD - 1 }),
    ).toBe('scanned_pdf');
  });

  it('flags a large JPG as a suspected photograph', () => {
    /*
     * The most dangerous input this product can accept: perspective distortion is projective, the
     * coordinate mapping is scale + rotation + origin, so a photograph calibrates plausibly along
     * one line and measures wrongly everywhere else.
     *
     * Flagging generously is right. A false flag costs someone ten seconds; a missed one puts an
     * invented dimension into a report.
     */
    expect(
      classifyDrawing({
        format: 'jpg',
        textCharacters: null,
        fileBytes: PHOTOGRAPH_SUSPECT_BYTES + 1,
        readable: true,
      }),
    ).toBe('photograph_suspected');
  });

  it('leaves a small JPG as an ordinary raster', () => {
    // Scans of line drawings are mostly white and compress hard.
    expect(
      classifyDrawing({ format: 'jpg', textCharacters: null, fileBytes: 200_000, readable: true }),
    ).toBe('raster_image');
  });

  it('never flags a PNG as a photograph, whatever its size', () => {
    // Cameras produce JPGs. A large PNG is a high-resolution scan or an export, not a photograph,
    // and flagging it would train an engineer to dismiss the flag.
    expect(
      classifyDrawing({
        format: 'png',
        textCharacters: null,
        fileBytes: PHOTOGRAPH_SUSPECT_BYTES * 10,
        readable: true,
      }),
    ).toBe('raster_image');
  });

  it.each(['dwg', 'dxf'] as const)('records %s as native CAD rather than dropping it', (format) => {
    // Catalogued so the dataset is complete and an engineer can see what exists, even though
    // nothing will import it.
    expect(classifyDrawing({ ...readable, format, textCharacters: null })).toBe('native_cad');
  });

  it('calls an unopenable file unreadable rather than guessing what it was', () => {
    // Encrypted, truncated, or not really a PDF. The extension is not evidence about the contents.
    expect(classifyDrawing({ ...readable, format: 'pdf', textCharacters: null, readable: false }))
      .toBe('unreadable');
  });
});

describe('which drawings can actually be used', () => {
  it('admits the three the importer can read', () => {
    for (const classification of ['vector_cad_export', 'scanned_pdf', 'raster_image'] as const) {
      expect(isImportable(classification), classification).toBe(true);
    }
  });

  it('excludes native CAD, suspected photographs and unreadable files', () => {
    /*
     * Three different reasons, and only the first is about capability. A DWG is perfectly good
     * engineering this application does not read; a suspected photograph is a raster it *would*
     * happily import and must not; an unreadable file is a question mark.
     */
    for (const classification of ['native_cad', 'photograph_suspected', 'unreadable', 'unknown'] as const) {
      expect(isImportable(classification), classification).toBe(false);
    }
  });
});
