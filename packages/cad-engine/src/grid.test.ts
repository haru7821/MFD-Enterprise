import { describe, expect, it } from 'vitest';

import {
  GRID_STEPS_MM,
  MIN_MINOR_PIXEL_SPACING,
  chooseGridSpec,
  computeGridLines,
} from './grid';
import { createViewport, visibleWorldRect } from './viewport';
import { vec2 } from './vec2';

const SCREEN = { width: 1200, height: 800 };

describe('chooseGridSpec', () => {
  it('always picks a round step from the 1-2-5 sequence', () => {
    for (const scale of [0.01, 0.033, 0.07, 0.5, 1, 7.5, 32]) {
      expect(GRID_STEPS_MM).toContain(chooseGridSpec(scale).step);
    }
  });

  it('never lets minor lines crowd below the readable spacing', () => {
    for (const scale of [0.01, 0.02, 0.05, 0.1, 0.4, 1, 4, 32]) {
      const { step } = chooseGridSpec(scale);
      expect(step * scale).toBeGreaterThanOrEqual(MIN_MINOR_PIXEL_SPACING);
    }
  });

  it('gets finer as the view zooms in', () => {
    const zoomedOut = chooseGridSpec(0.02).step;
    const zoomedIn = chooseGridSpec(2).step;
    expect(zoomedIn).toBeLessThan(zoomedOut);
  });

  it('places major lines on a whole power of ten', () => {
    for (const scale of [0.01, 0.07, 0.5, 4, 32]) {
      const { majorStep } = chooseGridSpec(scale);
      const exponent = Math.log10(majorStep);
      expect(Math.abs(exponent - Math.round(exponent))).toBeLessThan(1e-9);
    }
  });
});

describe('computeGridLines', () => {
  it('covers the whole visible rectangle', () => {
    const viewport = createViewport(0.07, vec2(140, 90));
    const visible = visibleWorldRect(viewport, SCREEN);

    const lines = computeGridLines(viewport, SCREEN);
    const allX = [...lines.minorX, ...lines.majorX].sort((a, b) => a - b);

    expect(allX.length).toBeGreaterThan(1);
    expect(allX[0] ?? 0).toBeLessThanOrEqual(visible.x);
    expect(allX[allX.length - 1] ?? 0).toBeGreaterThanOrEqual(
      visible.x + visible.width - lines.spec.step,
    );
  });

  it('separates major from minor without overlap', () => {
    const lines = computeGridLines(createViewport(0.07), SCREEN);

    const overlap = lines.minorX.filter((x) => lines.majorX.includes(x));
    expect(overlap).toHaveLength(0);

    for (const x of lines.majorX) {
      expect(Math.abs(x % lines.spec.majorStep)).toBeLessThan(1e-6);
    }
  });

  it('includes the model origin when it is on screen', () => {
    const lines = computeGridLines(createViewport(0.07, vec2(600, 400)), SCREEN);
    expect(lines.majorX).toContain(0);
    expect(lines.majorY).toContain(0);
  });

  it('stays bounded at the coarsest zoom', () => {
    const lines = computeGridLines(createViewport(0.01), { width: 4000, height: 4000 });
    expect(lines.minorX.length + lines.majorX.length).toBeLessThan(2000);
  });
});
