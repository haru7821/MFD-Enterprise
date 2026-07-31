import { describe, expect, it } from 'vitest';

import {
  findDimensionLayer,
  readPrintedDimensions,
  reconcileScale,
  type PrintedDimension,
} from './dimensions';
import { foldAngle, type Segment, type TextRun } from './geometry';

/**
 * The dimension reader, against geometry built by hand.
 *
 * Synthetic on purpose. The drawings this runs on are a hospital's property and live outside this
 * repository, so a test that needed one could not run in CI — and the properties worth asserting are
 * not properties of any particular sheet. Each case below is a shape a real CAD dimension takes, and
 * the numbers are chosen so the right answer is exactly 1 : 100.
 */

const POINTS_PER_MM = 72 / 25.4;

function segment(x1: number, y1: number, x2: number, y2: number, stroke = '#00b8b8'): Segment {
  return {
    x1,
    y1,
    x2,
    y2,
    stroke,
    length: Math.hypot(x2 - x1, y2 - y1),
    angle: foldAngle((Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI),
  };
}

function label(text: string, x: number, y: number, angle = 0): TextRun {
  return { text, x, y, angle, height: 8 };
}

/** Page points a distance occupies when drawn at 1 : 100. */
function ptAt100(millimetres: number): number {
  return (millimetres / 100) * POINTS_PER_MM;
}

/**
 * One dimension as CAD actually draws it: two extension lines, a line between them **trimmed** by
 * the tick width at each end, and the text sitting above the line.
 */
function dimension(millimetres: number, trim = 1.8): Segment[] {
  const span = ptAt100(millimetres);
  return [
    segment(0, -18, 0, 4),
    segment(span, -18, span, 4),
    segment(trim, 0, span - trim, 0),
  ];
}

describe('reading a printed dimension', () => {
  it('measures between the extension lines, not along the drawn line', () => {
    /*
     * The whole reason this reader exists. The drawn line is 3.6 pt shorter than the distance being
     * measured, so a reader that took its length would report 1 : 96.0 — and would then find every
     * other dimension on the sheet "inconsistent" with it.
     */
    const segments = dimension(3_000);
    const drawnLine = segments[2]!;
    const [found] = readPrintedDimensions(segments, [label('3,000', ptAt100(1_500), 0)]);

    expect(found).toBeDefined();
    expect(found?.measuredPt).toBeCloseTo(ptAt100(3_000), 6);
    expect(found?.impliedScale).toBeCloseTo(100, 6);
    // The line really is shorter than the measurement, so the two are not the same number.
    expect(drawnLine.length).toBeLessThan(found!.measuredPt - 3);
  });

  it('reads a dimension whose measure points are oblique ticks rather than extension lines', () => {
    // Short dimensions get a slash centred on the line instead of a full extension line, and
    // AutoCAD's architectural tick is a 45° slash rather than a right angle. Both are members of
    // the dimension layer that cross the line, which is the property the rule actually tests.
    const span = ptAt100(2_500);
    const segments = [
      segment(-2, -2, 2, 2),
      segment(span - 2, -2, span + 2, 2),
      segment(1.8, 0, span - 1.8, 0),
    ];

    const [found] = readPrintedDimensions(segments, [label('2,500', span / 2, 0)]);

    expect(found?.impliedScale).toBeCloseTo(100, 1);
  });

  it('omits a dimension whose measure point is missing at one end', () => {
    /*
     * The failure that produced a 329 pt reading of a 59 pt dimension before this rule existed: with
     * no tick at one end, the nearest crossing was the *neighbouring* dimension's, five dimensions
     * away. Unread is a result an engineer can act on; a fabricated span is not.
     */
    const span = ptAt100(2_200);
    const segments = [
      segment(0, -18, 0, 4),
      segment(1.8, 0, span - 1.8, 0),
      // Somewhere else entirely on the same line, as a chained dimension's far tick would be.
      segment(span * 4, -18, span * 4, 4),
    ];

    expect(readPrintedDimensions(segments, [label('2,200', span / 2, 0)])).toEqual([]);
  });

  it('pairs a label with the shortest line it sits on, not the longest', () => {
    /*
     * A room note printed over a long chained dimension line. Preferring the longest host turned a
     * `2200` room note into an 11.6 m measurement on the reference drawing's companion sheet.
     */
    const short = ptAt100(2_200);
    const segments = [
      ...dimension(2_200),
      // A long line running under the same label, with its own measure points far away.
      segment(-ptAt100(9_000), -18, -ptAt100(9_000), 4),
      segment(ptAt100(9_000), -18, ptAt100(9_000), 4),
      segment(-ptAt100(9_000) + 1.8, 0, ptAt100(9_000) - 1.8, 0),
    ];

    const [found] = readPrintedDimensions(segments, [label('2,200', short / 2, 0)]);

    expect(found?.impliedScale).toBeCloseTo(100, 6);
  });

  it('is not confused by text that states a number but is not a dimension', () => {
    const segments = dimension(3_000);
    const texts = [
      label('3,000', ptAt100(1_500), 0),
      // A room number and a level, both numeric, neither a dimension.
      label('201', ptAt100(1_500), -40),
      label('150', ptAt100(1_500), -60),
    ];

    expect(readPrintedDimensions(segments, texts)).toHaveLength(1);
  });
});

describe('finding the dimension layer', () => {
  it('picks the colour whose geometry hosts the labels', () => {
    const segments = [
      ...dimension(3_000),
      // A wall, drawn parallel and nearby on a different layer. It hosts no label.
      segment(0, -200, ptAt100(3_000), -200, '#ffff00'),
    ];

    expect(findDimensionLayer(segments, [label('3,000', ptAt100(1_500), 0)])).toBe('#00b8b8');
  });

  it('returns null for a sheet that prints no dimensions', () => {
    // Not a guess at the likeliest layer: a drawing with nothing to read yields nothing to read.
    expect(findDimensionLayer(dimension(3_000), [label('ENT', 10, 10)])).toBeNull();
    expect(readPrintedDimensions(dimension(3_000), [label('ENT', 10, 10)])).toEqual([]);
  });
});

describe('reconciling a sheet to one scale', () => {
  function at(scale: number, statedMm: number, labelText = String(statedMm)): PrintedDimension {
    const measuredPt = (statedMm / scale) * POINTS_PER_MM;
    return {
      label: labelText,
      statedMm,
      measuredPt,
      impliedScale: scale,
      labelAt: { x: 0, y: 0 },
      from: { x: 0, y: 0 },
      to: { x: measuredPt, y: 0 },
    };
  }

  it('takes the median and names the dimension that disagrees', () => {
    const agreement = reconcileScale([
      at(100.03, 17_600, '17,600'),
      at(100.02, 4_900, '4,900'),
      at(100.06, 4_500, '4,500'),
      at(97.01, 3_000, '3000'),
      at(100.02, 2_000, '2,000'),
    ]);

    // Five readings; the median is the lower middle one, which is a scale the drawing produced.
    expect(agreement?.scale).toBeCloseTo(100.02, 2);
    expect(agreement?.inconsistent.map((entry) => entry.label)).toEqual(['3000']);
    expect(agreement?.primary.label).toBe('17,600');
  });

  it('does not let the outlier move the agreed scale', () => {
    /*
     * A mean would. With one dimension 3 % out, the mean of the five above lands near 99.4, which is
     * both wrong and — worse — closer to the outlier, so the outlier looks less anomalous for having
     * dragged the answer towards itself.
     */
    const withOutlier = reconcileScale([
      at(100.03, 17_600, '17,600'),
      at(100.02, 4_900, '4,900'),
      at(100.06, 4_500, '4,500'),
      at(97.01, 3_000, '3000'),
      at(100.02, 2_000, '2,000'),
    ]);
    const without = reconcileScale([
      at(100.03, 17_600, '17,600'),
      at(100.02, 4_900, '4,900'),
      at(100.06, 4_500, '4,500'),
      at(100.02, 2_000, '2,000'),
    ]);

    expect(withOutlier?.scale).toBe(without?.scale);
  });

  it('calibrates from the longest consistent dimension', () => {
    // Not the first, and not the outlier however long it is. A short dimension multiplies whatever
    // error there is in locating its two ends by the ratio of the two lengths.
    const agreement = reconcileScale([
      at(100.02, 2_000, '2,000'),
      at(100.03, 17_600, '17,600'),
      at(97.01, 30_000, '30000'),
    ]);

    expect(agreement?.primary.label).toBe('17,600');
  });

  it('refuses to call a single dimension an agreement', () => {
    // One dimension is one number. It may itself be a text override, and nothing would contradict it.
    expect(reconcileScale([at(100, 17_600, '17,600')])).toBeNull();
    // Two dimensions that disagree with each other are not an agreement either.
    expect(reconcileScale([at(100, 17_600, '17,600'), at(80, 2_000, '2,000')])).toBeNull();
  });
});
