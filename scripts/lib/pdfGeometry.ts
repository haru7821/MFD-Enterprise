import { readFileSync } from 'node:fs';

import { foldAngle, type PageGeometry, type Segment, type TextRun } from '../../packages/layout-knowledge/src/index';

/**
 * Reading the vector content of a CAD-exported PDF.
 *
 * ## This is a verification instrument, not a product feature
 *
 * The importer does **not** do this. `apps/web/src/features/plan/planImport.ts` rasterises a PDF
 * page and treats it exactly like a scanned PNG; no line is extracted and no dimension is
 * recovered. That is the owner's Sprint 4 scope and nothing here changes it.
 *
 * What this file is for is checking the importer's arithmetic against the drawing itself. When an
 * engineer calibrates from a dimension line they click two points on a raster and type the printed
 * value; the accuracy of everything downstream rests on where those two clicks landed. This reads
 * the same two points out of the vector content **exactly**, so a verification run can state the
 * calibration error rather than estimate it, and can do so identically every time it runs.
 *
 * So: production calibrates from what a person saw. Verification calibrates from what the file
 * says, and the difference between the two is the number worth reporting.
 *
 * ## Coordinate space
 *
 * Everything returned is in **page points, y down from the top-left** — the space pdf.js hands out
 * once the page's own transform is applied, and the same space the text transforms arrive in. It is
 * not the PDF user space of the specification (y up from bottom-left); a CAD plot's content stream
 * usually opens with its own flip, and following the operator list rather than assuming a
 * convention is what keeps text and geometry in one frame.
 */

export type { PageGeometry, Segment, TextRun } from '../../packages/layout-knowledge/src/index';

type Matrix = readonly [number, number, number, number, number, number];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/**
 * Path operators, as pdf.js packs them.
 *
 * `constructPath` carries its points in a flat numeric run prefixed by op codes rather than as
 * objects, so the decode below is a hand-written cursor. Curves are followed to their end point and
 * their control points dropped: nothing in a dimension is a curve, and an arc that survives as a
 * chord cannot be mistaken for a straight run because it is never the right length.
 */
const MOVE_TO = 0;
const LINE_TO = 1;
const CUBIC_TO = 2;
const QUADRATIC_TO = 3;
const CLOSE_PATH = 4;

export async function readPageGeometry(path: string, pageIndex = 0): Promise<PageGeometry> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const OPS = pdfjs.OPS;

  const data = new Uint8Array(readFileSync(path));
  const document = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const page = await document.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: 1 });
  const operators = await page.getOperatorList();

  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  let stroke = '#000000';
  const stack: { ctm: Matrix; stroke: string }[] = [];
  const segments: Segment[] = [];

  const push = (a: [number, number], b: [number, number]): void => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length <= 0) return;
    segments.push({
      x1: a[0],
      y1: a[1],
      x2: b[0],
      y2: b[1],
      stroke,
      length,
      angle: foldAngle((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI),
    });
  };

  for (let index = 0; index < operators.fnArray.length; index += 1) {
    const fn = operators.fnArray[index];
    const args = operators.argsArray[index] as unknown;

    if (fn === OPS.save) {
      stack.push({ ctm, stroke });
    } else if (fn === OPS.restore) {
      const saved = stack.pop();
      if (saved) ({ ctm, stroke } = saved);
    } else if (fn === OPS.transform) {
      ctm = multiply(ctm, args as Matrix);
    } else if (fn === OPS.setStrokeRGBColor) {
      stroke = String((args as unknown[])[0]);
    } else if (fn === OPS.constructPath) {
      for (const chunk of (args as unknown[])[1] as ArrayLike<number>[]) {
        const values = Object.values(chunk).map(Number);
        let cursor = 0;
        let current: [number, number] | null = null;
        let start: [number, number] | null = null;

        while (cursor < values.length) {
          const op = values[cursor];
          if (op === MOVE_TO) {
            current = apply(ctm, values[cursor + 1]!, values[cursor + 2]!);
            start = current;
            cursor += 3;
          } else if (op === LINE_TO) {
            const next = apply(ctm, values[cursor + 1]!, values[cursor + 2]!);
            if (current) push(current, next);
            current = next;
            cursor += 3;
          } else if (op === CUBIC_TO) {
            current = apply(ctm, values[cursor + 5]!, values[cursor + 6]!);
            cursor += 7;
          } else if (op === QUADRATIC_TO) {
            current = apply(ctm, values[cursor + 3]!, values[cursor + 4]!);
            cursor += 5;
          } else if (op === CLOSE_PATH) {
            if (current && start) push(current, start);
            current = start;
            cursor += 1;
          } else {
            cursor += 1;
          }
        }
      }
    }
  }

  const content = await page.getTextContent();
  const texts: TextRun[] = [];
  for (const item of content.items) {
    if (!('str' in item)) continue;
    const transform = item.transform as number[];
    const a = transform[0]!;
    const b = transform[1]!;
    texts.push({
      text: item.str,
      x: transform[4]!,
      y: transform[5]!,
      angle: foldAngle((Math.atan2(b, a) * 180) / Math.PI),
      height: item.height,
    });
  }

  return { widthPt: viewport.width, heightPt: viewport.height, segments, texts };
}
