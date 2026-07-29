import { describe, expect, it } from 'vitest';

import {
  type PlanTransform,
  isUsableTransform,
  millimetresPerPixelFromRatio,
  millimetresPerPixelFromTwoPoints,
  modelLengthToPixel,
  modelToPixel,
  parseStatedRatio,
  pixelLengthToModel,
  pixelToModel,
  rotationFromReferenceLine,
} from './planTransform';
import { equals } from './vec2';

/** 10 mm per pixel, model origin at pixel (100, 50), square to the page. */
const SQUARE: PlanTransform = {
  millimetresPerPixel: 10,
  origin: { x: 100, y: 50 },
  rotation: 0,
};

const TURNED: PlanTransform = { ...SQUARE, rotation: 90_000 };

describe('pixel to model', () => {
  it('puts the origin pixel at model zero', () => {
    expect(pixelToModel(SQUARE, { x: 100, y: 50 })).toEqual({ x: 0, y: 0 });
  });

  it('scales offsets from the origin', () => {
    expect(pixelToModel(SQUARE, { x: 200, y: 50 })).toEqual({ x: 1_000, y: 0 });
    expect(pixelToModel(SQUARE, { x: 100, y: 150 })).toEqual({ x: 0, y: 1_000 });
  });

  it('rotates a plan that is not square to the page', () => {
    // A quarter turn clockwise sends +x to +y.
    const rotated = pixelToModel(TURNED, { x: 200, y: 50 });
    expect(equals(rotated, { x: 0, y: 1_000 }, 1e-6)).toBe(true);
  });

  it('leaves the origin fixed under rotation', () => {
    expect(equals(pixelToModel(TURNED, SQUARE.origin), { x: 0, y: 0 }, 1e-9)).toBe(true);
  });
});

describe('model to pixel', () => {
  it('inverts pixelToModel exactly, at any rotation', () => {
    const transform: PlanTransform = {
      millimetresPerPixel: 7.3,
      origin: { x: 412, y: -87 },
      rotation: 3_000,
    };

    for (const pixel of [
      { x: 0, y: 0 },
      { x: 1_920, y: 1_080 },
      { x: -300, y: 640 },
    ]) {
      const round = modelToPixel(transform, pixelToModel(transform, pixel));
      expect(equals(round, pixel, 1e-6)).toBe(true);
    }
  });
});

describe('lengths', () => {
  it('converts lengths without regard to rotation', () => {
    expect(pixelLengthToModel(SQUARE, 100)).toBe(1_000);
    expect(pixelLengthToModel(TURNED, 100)).toBe(1_000);
    expect(modelLengthToPixel(SQUARE, 1_000)).toBe(100);
  });
});

describe('two-point calibration', () => {
  it('derives the scale from a picked distance', () => {
    // The engineer picks the ends of a 2,400 mm dimension line 240 px apart.
    expect(millimetresPerPixelFromTwoPoints({ x: 10, y: 10 }, { x: 250, y: 10 }, 2_400)).toBe(10);
  });

  it('works along a diagonal', () => {
    const scale = millimetresPerPixelFromTwoPoints({ x: 0, y: 0 }, { x: 30, y: 40 }, 5_000);
    expect(scale).toBeCloseTo(100, 9);
  });

  it('refuses two identical points', () => {
    // A scale of infinity would make every later measurement meaningless while
    // still looking like a calibrated drawing.
    expect(millimetresPerPixelFromTwoPoints({ x: 10, y: 10 }, { x: 10, y: 10 }, 2_400)).toBeNull();
  });

  it('refuses a non-positive distance', () => {
    expect(millimetresPerPixelFromTwoPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 0)).toBeNull();
    expect(millimetresPerPixelFromTwoPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, -5)).toBeNull();
    expect(
      millimetresPerPixelFromTwoPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, Number.NaN),
    ).toBeNull();
  });
});

describe('stated ratio', () => {
  it('parses the denominator', () => {
    expect(parseStatedRatio('1:100')).toBe(100);
    expect(parseStatedRatio(' 1 : 50 ')).toBe(50);
    expect(parseStatedRatio('1:12.5')).toBe(12.5);
  });

  it('rejects anything that is not a 1:n ratio', () => {
    expect(parseStatedRatio('2:100')).toBeNull();
    expect(parseStatedRatio('100')).toBeNull();
    expect(parseStatedRatio('')).toBeNull();
    expect(parseStatedRatio('1:0')).toBeNull();
  });

  it('converts a ratio at a stated resolution', () => {
    // 1:100 at 300 dpi — one pixel is 25.4/300 inch of paper, 100× that on site.
    const scale = millimetresPerPixelFromRatio(100, 300);
    expect(scale).toBeCloseTo(8.4667, 3);
  });

  it('refuses a ratio without a resolution', () => {
    expect(millimetresPerPixelFromRatio(100, 0)).toBeNull();
    expect(millimetresPerPixelFromRatio(0, 300)).toBeNull();
  });
});

describe('rotation from a reference line', () => {
  it('is zero for a line already horizontal', () => {
    expect(rotationFromReferenceLine({ x: 0, y: 0 }, { x: 100, y: 0 })).toBe(0);
  });

  it('turns a wall back to horizontal', () => {
    const rotation = rotationFromReferenceLine({ x: 0, y: 0 }, { x: 100, y: 100 });
    expect(rotation).toBe(-45_000);

    const transform: PlanTransform = {
      millimetresPerPixel: 1,
      origin: { x: 0, y: 0 },
      rotation: rotation ?? 0,
    };
    const end = pixelToModel(transform, { x: 100, y: 100 });
    expect(Math.abs(end.y)).toBeLessThan(1e-6);
  });

  it('refuses a zero-length line', () => {
    expect(rotationFromReferenceLine({ x: 5, y: 5 }, { x: 5, y: 5 })).toBeNull();
  });
});

describe('usability', () => {
  it('accepts a complete transform', () => {
    expect(isUsableTransform(SQUARE)).toBe(true);
  });

  it('rejects an absent or degenerate transform', () => {
    // An uncalibrated plan must never be measured against — see PROJECT_MODEL.md.
    expect(isUsableTransform(null)).toBe(false);
    expect(isUsableTransform({ ...SQUARE, millimetresPerPixel: 0 })).toBe(false);
    expect(isUsableTransform({ ...SQUARE, millimetresPerPixel: Number.NaN })).toBe(false);
    expect(isUsableTransform({ ...SQUARE, rotation: Number.POSITIVE_INFINITY })).toBe(false);
  });
});
