import { pixelToModel } from '@mfd/cad-engine';
import { describe, expect, it } from 'vitest';

import {
  FIXTURE_LEVEL_ID,
  FIXTURE_NOW,
  fixtureDocument,
  fixturePlanImage,
} from '../fixtures/index';
import { isCalibrated, requireLevel } from './document';
import {
  calibrateFromStatedRatio,
  calibrateFromTwoPoints,
  clearPlanImage,
  planTransformOf,
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
