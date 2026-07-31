import { pixelToModel } from '@mfd/cad-engine';
import { describe, expect, it } from 'vitest';

import {
  FIXTURE_LEVEL_ID,
  FIXTURE_NOW,
  fixtureDocument,
  fixturePlanImage,
} from '../fixtures/index';
import { isCalibrated, requireLevel } from './document';
import type { PlanImage } from './schema';
import {
  calibrateFromStatedRatio,
  calibrateFromTwoPoints,
  clearPlanImage,
  planTransformOf,
  paperSizeDisagrees,
  recommendCalibration,
  setCoordinateMapping,
  setMappingOrigin,
  setMappingRotation,
  setPlanImage,
} from './plan';

const LEVEL = FIXTURE_LEVEL_ID;

function calibrated() {
  const mapping = calibrateFromTwoPoints({
    pointA: { x: 100, y: 100 },
    pointB: { x: 340, y: 100 },
    knownDistance: 2_400,
    now: FIXTURE_NOW,
  });
  const document = setPlanImage(fixtureDocument(), LEVEL, fixturePlanImage());
  return setCoordinateMapping(document, LEVEL, mapping);
}

describe('plan import', () => {
  it('attaches the drawing', () => {
    const level = requireLevel(setPlanImage(fixtureDocument(), LEVEL, fixturePlanImage()), LEVEL);
    expect(level.planImage?.sourceFileName).toBe('3f-dialysis.png');
  });

  it('leaves a newly imported level uncalibrated', () => {
    // Until step 2 the level cannot be measured against, and everything downstream
    // is required to notice.
    const document = setPlanImage(fixtureDocument(), LEVEL, fixturePlanImage());
    expect(isCalibrated(requireLevel(document, LEVEL))).toBe(false);
    expect(planTransformOf(requireLevel(document, LEVEL))).toBeNull();
  });

  it('discards the calibration when a different drawing is imported', () => {
    // A mapping describes a specific image. Keeping it across a re-import would apply
    // one drawing's scale to another's pixels, and every measurement taken afterwards
    // would be wrong while looking entirely normal.
    const replaced = setPlanImage(
      calibrated(),
      LEVEL,
      fixturePlanImage({ sourceFileName: '4f-dialysis.png' }),
    );
    expect(isCalibrated(requireLevel(replaced, LEVEL))).toBe(false);
  });

  it('clears both the drawing and its mapping', () => {
    const level = requireLevel(clearPlanImage(calibrated(), LEVEL), LEVEL);
    expect(level.planImage).toBeNull();
    expect(level.coordinateMapping).toBeNull();
  });
});

describe('two-point calibration', () => {
  it('derives millimetres per pixel and records the evidence', () => {
    const mapping = calibrateFromTwoPoints({
      pointA: { x: 100, y: 100 },
      pointB: { x: 340, y: 100 },
      knownDistance: 2_400,
      now: FIXTURE_NOW,
    });

    expect(mapping?.millimetresPerPixel).toBe(10);
    expect(mapping?.calibration.method).toBe('two-point');
    // Kept so a reviewer can see how the scale was established rather than trusting it.
    expect(mapping?.calibration.knownDistance).toBe(2_400);
    expect(mapping?.calibration.pointA).toEqual({ x: 100, y: 100 });
  });

  it('defaults the origin and rotation honestly', () => {
    // A plan measured from its own corner is still correctly measured.
    const mapping = calibrateFromTwoPoints({
      pointA: { x: 0, y: 0 },
      pointB: { x: 100, y: 0 },
      knownDistance: 1_000,
      now: FIXTURE_NOW,
    });
    expect(mapping?.origin).toEqual({ x: 0, y: 0 });
    expect(mapping?.rotation).toBe(0);
  });

  it('refuses to produce a degenerate mapping', () => {
    // A level that looks calibrated but measures nonsense is strictly worse than one
    // that is honestly uncalibrated.
    expect(
      calibrateFromTwoPoints({
        pointA: { x: 50, y: 50 },
        pointB: { x: 50, y: 50 },
        knownDistance: 2_400,
        now: FIXTURE_NOW,
      }),
    ).toBeNull();

    expect(
      calibrateFromTwoPoints({
        pointA: { x: 0, y: 0 },
        pointB: { x: 100, y: 0 },
        knownDistance: 0,
        now: FIXTURE_NOW,
      }),
    ).toBeNull();
  });
});

describe('stated-ratio calibration', () => {
  it('derives a scale from the printed ratio and a resolution', () => {
    const mapping = calibrateFromStatedRatio({
      statedRatio: '1:100',
      dotsPerInch: 300,
      now: FIXTURE_NOW,
    });

    expect(mapping?.millimetresPerPixel).toBeCloseTo(8.4667, 3);
    expect(mapping?.calibration.method).toBe('stated-ratio');
    expect(mapping?.calibration.statedRatio).toBe('1:100');
    expect(mapping?.calibration.pointA).toBeNull();
  });

  it('refuses a ratio it cannot parse', () => {
    expect(
      calibrateFromStatedRatio({ statedRatio: 'about 1 to 100', dotsPerInch: 300, now: FIXTURE_NOW }),
    ).toBeNull();
  });
});

describe('origin and rotation', () => {
  it('moves the origin without disturbing the scale', () => {
    const moved = setMappingOrigin(calibrated(), LEVEL, { x: 500, y: 700 });
    const mapping = requireLevel(moved, LEVEL).coordinateMapping;

    expect(mapping?.origin).toEqual({ x: 500, y: 700 });
    expect(mapping?.millimetresPerPixel).toBe(10);
  });

  it('squares the drawing without disturbing the origin', () => {
    const turned = setMappingRotation(
      setMappingOrigin(calibrated(), LEVEL, { x: 500, y: 700 }),
      LEVEL,
      -3_000,
    );
    const mapping = requireLevel(turned, LEVEL).coordinateMapping;

    expect(mapping?.rotation).toBe(-3_000);
    expect(mapping?.origin).toEqual({ x: 500, y: 700 });
  });

  it('does nothing on an uncalibrated level rather than inventing a mapping', () => {
    const document = setPlanImage(fixtureDocument(), LEVEL, fixturePlanImage());
    expect(requireLevel(setMappingOrigin(document, LEVEL, { x: 1, y: 1 }), LEVEL)
      .coordinateMapping).toBeNull();
  });
});

describe('the transform handed to the geometry layer', () => {
  it('drops the provenance and keeps the maths', () => {
    const transform = planTransformOf(requireLevel(calibrated(), LEVEL));
    expect(transform).toEqual({
      millimetresPerPixel: 10,
      origin: { x: 0, y: 0 },
      rotation: 0,
    });
  });

  it('maps a picked pixel to the millimetres the engineer expects', () => {
    // Origin at pixel (100, 100), 10 mm per pixel: the second calibration point is
    // 2,400 mm away along x, which is the distance that was typed in.
    const document = setMappingOrigin(calibrated(), LEVEL, { x: 100, y: 100 });
    const transform = planTransformOf(requireLevel(document, LEVEL));
    expect(transform).not.toBeNull();
    if (!transform) return;

    expect(pixelToModel(transform, { x: 340, y: 100 })).toEqual({ x: 2_400, y: 0 });
  });
});

/**
 * Owner decision, Q-4.
 *
 * > *"Implement both calibration methods: dimension-line calibration (preferred), printed drawing
 * > scale calibration (fallback). The application should automatically recommend the most reliable
 * > method available for each drawing."*
 *
 * The recommendation has content only because the application genuinely knows something the
 * engineer would have to work out: whether a printed ratio can be converted at all. These assert
 * that it uses what it knows and does not guess at what it does not.
 */
describe('recommending a calibration method', () => {
  function image(renderDpi: number | null): PlanImage {
    return { ...fixturePlanImage(), renderDpi };
  }

  it('prefers the dimension line whenever the drawing has one', () => {
    // It measures the drawing as it actually is. A printed scale describes the sheet as its author
    // intended, before somebody printed it at 94 % to fit A3.
    const advice = recommendCalibration({ planImage: image(150), hasDimensionLine: true });

    expect(advice.recommended).toBe('two-point');
    expect(advice.code).toBe('prefer_two_point');
    // The fallback is still listed — the engineer may want to cross-check one against the other.
    expect(advice.available).toEqual(['two-point', 'stated-ratio']);
  });

  it('falls back to the printed scale when there is no dimension line but the resolution is known', () => {
    const advice = recommendCalibration({ planImage: image(150), hasDimensionLine: false });

    expect(advice.recommended).toBe('stated-ratio');
    expect(advice.code).toBe('fallback_stated_ratio');
    expect(advice.available).toEqual(['stated-ratio']);
  });

  it('offers nothing at all for a scan with no dimension line', () => {
    /*
     * The outcome that matters most, and the one a helpful implementation would get wrong by
     * nudging the engineer towards the weaker method anyway. A raster import's resolution is
     * unknown, so "1:100" cannot be converted to millimetres per pixel by any honest arithmetic.
     *
     * Uncalibrated is a state this application already handles properly — every rule YELLOW, never
     * GREEN — and it is a better answer than a scale derived from a resolution nobody recorded.
     */
    const advice = recommendCalibration({ planImage: image(null), hasDimensionLine: false });

    expect(advice.recommended).toBeNull();
    expect(advice.available).toEqual([]);
    expect(advice.code).toBe('no_method_available');
  });

  it('does not offer the printed scale for a raster import, even before the question is answered', () => {
    // A scanned PNG carries no trustworthy statement of the size it was scanned at, so the route is
    // withheld rather than offered and then failed at the last step.
    const advice = recommendCalibration({ planImage: image(null), hasDimensionLine: null });

    expect(advice.available).toEqual(['two-point']);
    expect(advice.code).toBe('awaiting_dimension_line_answer');
  });

  it('recommends nothing when there is no drawing', () => {
    expect(recommendCalibration({ planImage: null, hasDimensionLine: true })).toEqual({
      recommended: null,
      available: [],
      code: 'no_plan_image',
    });
  });

  it('never infers a dimension line, because it cannot', () => {
    /*
     * A PDF's vector content is never read, so nothing in the file says whether a dimension is
     * printed on it. `null` means "nobody has looked" and stays distinct from `false`, which means
     * "somebody looked and there is none" — and the two lead to different advice.
     */
    const unanswered = recommendCalibration({ planImage: image(150), hasDimensionLine: null });
    const answeredNo = recommendCalibration({ planImage: image(150), hasDimensionLine: false });

    expect(unanswered.recommended).toBe('two-point');
    expect(answeredNo.recommended).toBe('stated-ratio');
  });
});

describe('the printed-scale route produces a real mapping', () => {
  it('converts a stated ratio at a known resolution', () => {
    /*
     * 1:100 at 150 dpi. One pixel is 1/150 inch = 0.169333 mm on the sheet, and the sheet is at
     * 1:100, so one pixel is 16.9333 mm in the building. Asserted as arithmetic rather than against
     * a recorded constant, because the whole point of the route is that the number is derived.
     */
    const mapping = calibrateFromStatedRatio({
      statedRatio: '1:100',
      dotsPerInch: 150,
      now: FIXTURE_NOW,
    });

    expect(mapping?.millimetresPerPixel).toBeCloseTo((25.4 / 150) * 100, 6);
    expect(mapping?.calibration.method).toBe('stated-ratio');
    // The evidence is kept, so a reviewer can see which of the two methods produced the scale.
    expect(mapping?.calibration.statedRatio).toBe('1:100');
    expect(mapping?.calibration.dotsPerInch).toBe(150);
    expect(mapping?.calibration.knownDistance).toBeNull();
  });

  it('refuses a ratio it cannot parse rather than guessing one', () => {
    for (const ratio of ['one to a hundred', '1:', '', '1:0']) {
      expect(
        calibrateFromStatedRatio({ statedRatio: ratio, dotsPerInch: 150, now: FIXTURE_NOW }),
        ratio,
      ).toBeNull();
    }
  });
});

/**
 * Owner decision — the calibration safety rule.
 *
 * > *"If a title block specifies a paper size, compare it against the actual PDF page size. If they
 * > do not match, the printed-scale calibration path must be rejected automatically and the
 * > application should recommend dimension-line calibration instead."*
 *
 * The case is real and measured: three of the six sheets in the hospital dataset whose title block
 * names a paper size name one the file is not. `Hospital_026` prints `A3 : 1/200` on A4 pages.
 */
describe('a title block that disagrees with the page', () => {
  function image(renderDpi: number | null): PlanImage {
    return { ...fixturePlanImage(), renderDpi };
  }

  it('refuses the printed scale outright, rather than warning about it', () => {
    /*
     * Calibrating Hospital_026 from its stated 1/200 would make every measurement ~41 % too large,
     * and nothing on the drawing contradicts it: the plan looks right and a clearance that is
     * really 850 mm reads as 1,200. A warning gets dismissed by the third drawing; a refusal does
     * not.
     */
    const advice = recommendCalibration({
      planImage: image(150),
      hasDimensionLine: false,
      claimedSheetSize: 'A3',
      actualSheetSize: 'A4',
    });

    expect(advice.available).not.toContain('stated-ratio');
    expect(advice.available).toEqual([]);
    expect(advice.recommended).toBeNull();
    expect(advice.code).toBe('paper_size_mismatch');
  });

  it('still recommends measuring a dimension when the drawing has one', () => {
    // The owner's instruction exactly: reject the printed scale, recommend dimension-line instead.
    // A mismatched title block says nothing about the dimension lines, which measure the file as it
    // actually is and are unaffected by any rescaling in its history.
    const advice = recommendCalibration({
      planImage: image(150),
      hasDimensionLine: true,
      claimedSheetSize: 'A3',
      actualSheetSize: 'A4',
    });

    expect(advice.recommended).toBe('two-point');
    expect(advice.available).toEqual(['two-point']);
    // Reported even though two-point was going to win anyway — an engineer who learns this sheet's
    // printed scale is wrong knows something they would otherwise discover by trusting it.
    expect(advice.code).toBe('paper_size_mismatch');
  });

  it('leaves an agreeing title block alone', () => {
    // Hospital_044: claims A3, is A3. Both routes stay available and can be cross-checked, which is
    // exactly why it was chosen as the first verification drawing.
    const advice = recommendCalibration({
      planImage: image(150),
      hasDimensionLine: true,
      claimedSheetSize: 'A3',
      actualSheetSize: 'A3',
    });

    expect(advice.available).toEqual(['two-point', 'stated-ratio']);
    expect(advice.code).toBe('prefer_two_point');
  });

  it('treats silence as silence, not as disagreement', () => {
    /*
     * 212 of the 229 analysed sheets state no scale or paper size at all. If an absent claim
     * counted as a mismatch, the rule would refuse the printed-scale route on nearly every drawing
     * in the dataset — including the ones it was built to serve.
     */
    expect(paperSizeDisagrees(null, 'A4')).toBe(false);
    expect(paperSizeDisagrees('A3', null)).toBe(false);
    expect(paperSizeDisagrees(null, null)).toBe(false);

    const advice = recommendCalibration({
      planImage: image(150),
      hasDimensionLine: false,
      claimedSheetSize: null,
      actualSheetSize: 'A4',
    });
    expect(advice.recommended).toBe('stated-ratio');
  });

  it('compares sizes as written, ignoring case and padding', () => {
    // The claim is typed by a person reading a title block; "a3 " and "A3" are the same sheet.
    expect(paperSizeDisagrees(' a3 ', 'A3')).toBe(false);
    expect(paperSizeDisagrees('A3', 'A4')).toBe(true);
  });

  it('applies before the resolution check, so a scan with a bad title block says why', () => {
    // Two independent reasons the ratio is unusable. The mismatch is the more specific one and is
    // the one worth telling the engineer, because it is a fact about their drawing rather than
    // about our importer.
    const advice = recommendCalibration({
      planImage: image(null),
      hasDimensionLine: false,
      claimedSheetSize: 'A3',
      actualSheetSize: 'A4',
    });

    expect(advice.code).toBe('paper_size_mismatch');
  });
});
