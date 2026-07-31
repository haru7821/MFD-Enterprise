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

/** Straight runs per curve. See `flatten`. */
const CURVE_SEGMENTS = 8;

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

  /**
   * A curve becomes a chain of short straight runs.
   *
   * Curves used to be followed to their end point and dropped, on the grounds that nothing in a
   * dimension is a curve. True, and it cost the one thing curves are for on an architectural plan:
   * a **door swing**. A swing arc together with its leaf closes the opening it is drawn across, and
   * without them a region fill walks straight out of every room through its door — measured, on the
   * reference drawing, as a 17.6 m hall filling to 26.5 m.
   *
   * {@link CURVE_SEGMENTS} pieces per curve. Enough that a door arc is a barrier and few enough that
   * a hatch full of curves does not swamp the segment list; a chord alone would leave a gap between
   * the arc and the wall it meets.
   */
  const flatten = (
    from: [number, number],
    control1: [number, number],
    control2: [number, number],
    to: [number, number],
  ): void => {
    let previous = from;
    for (let step = 1; step <= CURVE_SEGMENTS; step += 1) {
      const t = step / CURVE_SEGMENTS;
      const u = 1 - t;
      const point: [number, number] = [
        u * u * u * from[0] + 3 * u * u * t * control1[0] + 3 * u * t * t * control2[0] + t * t * t * to[0],
        u * u * u * from[1] + 3 * u * u * t * control1[1] + 3 * u * t * t * control2[1] + t * t * t * to[1],
      ];
      push(previous, point);
      previous = point;
    }
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
            const next = apply(ctm, values[cursor + 5]!, values[cursor + 6]!);
            if (current) {
              flatten(
                current,
                apply(ctm, values[cursor + 1]!, values[cursor + 2]!),
                apply(ctm, values[cursor + 3]!, values[cursor + 4]!),
                next,
              );
            }
            current = next;
            cursor += 7;
          } else if (op === QUADRATIC_TO) {
            const control = apply(ctm, values[cursor + 1]!, values[cursor + 2]!);
            const next = apply(ctm, values[cursor + 3]!, values[cursor + 4]!);
            if (current) {
              // A quadratic is a cubic whose two controls sit two-thirds of the way to the control.
              flatten(
                current,
                [current[0] + (2 / 3) * (control[0] - current[0]), current[1] + (2 / 3) * (control[1] - current[1])],
                [next[0] + (2 / 3) * (control[0] - next[0]), next[1] + (2 / 3) * (control[1] - next[1])],
                next,
              );
            }
            current = next;
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
