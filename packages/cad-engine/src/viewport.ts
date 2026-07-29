import { type Vec2, ORIGIN } from './vec2';
import { type Rect, rect, rectCentre } from './rect';
import type { Millimetres } from './units';

/**
 * Viewport — the only place where millimetres become pixels.
 *
 * Architecture decision AD-2: the renderer consumes geometry, it does not own it.
 * Every screen coordinate in MFD-E is produced by {@link worldToScreen} and every
 * pointer position is converted back by {@link screenToWorld}. Konva never holds
 * the authoritative position of anything.
 *
 * Transform: `screen = world * scale + offset`
 */
export interface Viewport {
  /** Screen pixels per millimetre. */
  readonly scale: number;
  /** Screen-space translation in pixels, applied after scaling. */
  readonly offset: Vec2;
}

/** Size of the drawing surface in CSS pixels. */
export interface ScreenSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Zoom is reported to the user as a percentage where 100 % means one screen pixel
 * per millimetre — so a 1,000 mm dialysis machine is 1,000 px wide at 100 %.
 */
export const SCALE_AT_100_PERCENT = 1;

/** 1 % — roughly 100 m across a 1,000 px viewport. */
export const MIN_SCALE = 0.01;
/** 3200 % — millimetre-level detail. */
export const MAX_SCALE = 32;

/** Multiplier applied by the zoom-in / zoom-out toolbar buttons. */
export const ZOOM_STEP = 1.25;

/** Comfortable starting view: a ~14 m span fits a 1,000 px viewport. */
export const DEFAULT_SCALE = 0.07;

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return DEFAULT_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function createViewport(scale: number = DEFAULT_SCALE, offset: Vec2 = ORIGIN): Viewport {
  return { scale: clampScale(scale), offset };
}

export function zoomPercent(viewport: Viewport): number {
  return (viewport.scale / SCALE_AT_100_PERCENT) * 100;
}

export function scaleForZoomPercent(percent: number): number {
  return clampScale((percent / 100) * SCALE_AT_100_PERCENT);
}

export function worldToScreen(viewport: Viewport, point: Vec2): Vec2 {
  return {
    x: point.x * viewport.scale + viewport.offset.x,
    y: point.y * viewport.scale + viewport.offset.y,
  };
}

export function screenToWorld(viewport: Viewport, point: Vec2): Vec2 {
  return {
    x: (point.x - viewport.offset.x) / viewport.scale,
    y: (point.y - viewport.offset.y) / viewport.scale,
  };
}

/** Convert a screen-space length (px) to a model-space length (mm). */
export function screenToWorldLength(viewport: Viewport, pixels: number): Millimetres {
  return pixels / viewport.scale;
}

/** Convert a model-space length (mm) to a screen-space length (px). */
export function worldToScreenLength(viewport: Viewport, millimetres: Millimetres): number {
  return millimetres * viewport.scale;
}

/** Translate the view by a screen-space delta, in pixels. */
export function panBy(viewport: Viewport, deltaScreen: Vec2): Viewport {
  return {
    scale: viewport.scale,
    offset: { x: viewport.offset.x + deltaScreen.x, y: viewport.offset.y + deltaScreen.y },
  };
}

/**
 * Set an absolute zoom level while keeping the model point currently under
 * `anchorScreen` pinned to that same screen position.
 *
 * This anchoring is what makes wheel-zoom feel correct: the drawing grows around
 * the cursor rather than around an arbitrary corner.
 */
export function zoomTo(viewport: Viewport, anchorScreen: Vec2, nextScale: number): Viewport {
  const scale = clampScale(nextScale);
  if (scale === viewport.scale) return viewport;

  const anchorWorld = screenToWorld(viewport, anchorScreen);
  return {
    scale,
    offset: {
      x: anchorScreen.x - anchorWorld.x * scale,
      y: anchorScreen.y - anchorWorld.y * scale,
    },
  };
}

/** Multiply the current zoom, anchored at a screen position. */
export function zoomBy(viewport: Viewport, anchorScreen: Vec2, factor: number): Viewport {
  return zoomTo(viewport, anchorScreen, viewport.scale * factor);
}

/** The model-space rectangle currently visible on screen. */
export function visibleWorldRect(viewport: Viewport, screen: ScreenSize): Rect {
  const topLeft = screenToWorld(viewport, ORIGIN);
  const bottomRight = screenToWorld(viewport, { x: screen.width, y: screen.height });
  return rect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
}

/**
 * Fit a model-space rectangle into the viewport with padding, centred.
 *
 * Degenerate rectangles (zero width or height, e.g. an empty project) fall back to
 * {@link DEFAULT_SCALE} rather than dividing by zero.
 */
export function fitRect(target: Rect, screen: ScreenSize, paddingPixels = 48): Viewport {
  const usableWidth = Math.max(1, screen.width - paddingPixels * 2);
  const usableHeight = Math.max(1, screen.height - paddingPixels * 2);

  const scale =
    target.width > 0 && target.height > 0
      ? clampScale(Math.min(usableWidth / target.width, usableHeight / target.height))
      : DEFAULT_SCALE;

  const centre = rectCentre(target);
  return {
    scale,
    offset: {
      x: screen.width / 2 - centre.x * scale,
      y: screen.height / 2 - centre.y * scale,
    },
  };
}

/** Centre the view on a model-space point without changing zoom. */
export function centreOn(viewport: Viewport, point: Vec2, screen: ScreenSize): Viewport {
  return {
    scale: viewport.scale,
    offset: {
      x: screen.width / 2 - point.x * viewport.scale,
      y: screen.height / 2 - point.y * viewport.scale,
    },
  };
}
