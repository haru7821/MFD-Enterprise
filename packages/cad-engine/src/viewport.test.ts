import { describe, expect, it } from 'vitest';

import { rect } from './rect';
import { vec2 } from './vec2';
import {
  DEFAULT_SCALE,
  MAX_SCALE,
  MIN_SCALE,
  centreOn,
  clampScale,
  createViewport,
  fitRect,
  panBy,
  screenToWorld,
  visibleWorldRect,
  worldToScreen,
  zoomBy,
  zoomPercent,
  zoomTo,
} from './viewport';

const SCREEN = { width: 1200, height: 800 };

describe('scale clamping', () => {
  it('keeps zoom inside the supported range', () => {
    expect(clampScale(1000)).toBe(MAX_SCALE);
    expect(clampScale(0)).toBe(MIN_SCALE);
    expect(clampScale(-5)).toBe(MIN_SCALE);
  });

  it('falls back to the default rather than propagating NaN', () => {
    expect(clampScale(Number.NaN)).toBe(DEFAULT_SCALE);
    expect(clampScale(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SCALE);
  });
});

describe('coordinate conversion', () => {
  it('round-trips model space through screen space', () => {
    const viewport = createViewport(0.25, vec2(120, -40));
    const point = vec2(8_400, 12_600);

    const back = screenToWorld(viewport, worldToScreen(viewport, point));

    expect(back.x).toBeCloseTo(point.x, 6);
    expect(back.y).toBeCloseTo(point.y, 6);
  });

  it('reports zoom as pixels per millimetre expressed as a percentage', () => {
    expect(zoomPercent(createViewport(1))).toBeCloseTo(100);
    expect(zoomPercent(createViewport(0.05))).toBeCloseTo(5);
  });
});

describe('zooming', () => {
  it('pins the model point under the anchor', () => {
    const viewport = createViewport(0.1, vec2(30, 70));
    const anchor = vec2(640, 360);
    const worldBefore = screenToWorld(viewport, anchor);

    const zoomed = zoomBy(viewport, anchor, 2.5);
    const worldAfter = screenToWorld(zoomed, anchor);

    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
    expect(zoomed.scale).toBeCloseTo(0.25, 6);
  });

  it('still pins the anchor when the requested scale is clamped', () => {
    const viewport = createViewport(MAX_SCALE, vec2(0, 0));
    const anchor = vec2(500, 500);
    const worldBefore = screenToWorld(viewport, anchor);

    const zoomed = zoomTo(viewport, anchor, MAX_SCALE * 10);

    expect(zoomed.scale).toBe(MAX_SCALE);
    expect(screenToWorld(zoomed, anchor).x).toBeCloseTo(worldBefore.x, 6);
  });
});

describe('panning', () => {
  it('shifts the visible model rectangle by the inverse screen delta', () => {
    const viewport = createViewport(0.2, vec2(0, 0));
    const before = visibleWorldRect(viewport, SCREEN);

    const after = visibleWorldRect(panBy(viewport, vec2(100, 0)), SCREEN);

    expect(after.x).toBeCloseTo(before.x - 100 / 0.2, 6);
    expect(after.width).toBeCloseTo(before.width, 6);
  });
});

describe('fitRect', () => {
  it('makes the target rectangle visible and centred', () => {
    const room = rect(0, 0, 8_400, 12_600);

    const viewport = fitRect(room, SCREEN, 48);
    const visible = visibleWorldRect(viewport, SCREEN);

    expect(visible.x).toBeLessThanOrEqual(room.x);
    expect(visible.y).toBeLessThanOrEqual(room.y);
    expect(visible.x + visible.width).toBeGreaterThanOrEqual(room.x + room.width);
    expect(visible.y + visible.height).toBeGreaterThanOrEqual(room.y + room.height);

    const centre = worldToScreen(viewport, vec2(4_200, 6_300));
    expect(centre.x).toBeCloseTo(SCREEN.width / 2, 6);
    expect(centre.y).toBeCloseTo(SCREEN.height / 2, 6);
  });

  it('does not divide by zero on an empty project', () => {
    const viewport = fitRect(rect(0, 0, 0, 0), SCREEN);

    expect(Number.isFinite(viewport.offset.x)).toBe(true);
    expect(viewport.scale).toBe(DEFAULT_SCALE);
  });
});

describe('centreOn', () => {
  it('puts the requested model point at the screen centre without changing zoom', () => {
    const viewport = createViewport(0.3, vec2(11, 22));

    const centred = centreOn(viewport, vec2(5_000, 2_500), SCREEN);
    const screenPoint = worldToScreen(centred, vec2(5_000, 2_500));

    expect(centred.scale).toBe(viewport.scale);
    expect(screenPoint.x).toBeCloseTo(SCREEN.width / 2, 6);
    expect(screenPoint.y).toBeCloseTo(SCREEN.height / 2, 6);
  });
});
