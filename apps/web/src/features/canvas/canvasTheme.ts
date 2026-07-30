/**
 * Drawing colours for the Konva canvas.
 *
 * Konva paints into a bitmap and cannot read CSS custom properties, so canvas
 * colours cannot live in styles.css. This file is the renderer's palette; keep it
 * visually in step with the tokens in styles.css.
 */
export const CANVAS_THEME = {
  /** Minor grid — present but never competing with the drawing. */
  gridMinor: '#1a2532',
  /** Major grid — every tenth line, the one you actually count against. */
  gridMajor: '#26364c',
  /** Model X axis (the y = 0 line). Muted red, the CAD convention. */
  axisX: '#8c4652',
  /** Model Y axis (the x = 0 line). Muted green, the CAD convention. */
  axisY: '#3f7d52',
  /** Amber, matching the report's reference-point mark. Distinct from every finding colour. */
  referencePoint: '#b45309',
  referencePointSelected: '#f59e0b',
  originDot: '#4a9eff',
  originLabel: '#5d6b80',
} as const;
