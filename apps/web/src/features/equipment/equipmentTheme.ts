/**
 * Canvas colours for equipment.
 *
 * Konva paints into a bitmap and cannot read CSS custom properties, so these cannot
 * live in styles.css. Keep them visually in step with the tokens there.
 *
 * The draft palette is deliberately louder than the verified one. A machine drawn
 * from placeholder figures must not look like a machine drawn from a manual.
 */
export const EQUIPMENT_THEME = {
  verified: {
    fill: 'rgba(74, 158, 255, 0.13)',
    stroke: '#5aa9ff',
    label: '#cfe4ff',
  },
  draft: {
    fill: 'rgba(232, 160, 62, 0.13)',
    stroke: '#e8a03e',
    label: '#f2c891',
    /** Dashes read as "provisional" before any text is read. */
    dash: [10, 6],
  },
  selected: {
    stroke: '#ffffff',
    handleFill: '#4a9eff',
  },
  clearance: {
    fill: 'rgba(74, 158, 255, 0.07)',
    stroke: 'rgba(90, 169, 255, 0.5)',
    dash: [4, 4],
  },
  port: {
    power: '#f2c94c',
    roWater: '#56ccf2',
    drain: '#a88bd6',
  },
  dimension: '#8695ab',
} as const;

/** Below this on-screen size, labels are dropped rather than overlapping. */
export const MIN_PIXELS_FOR_LABEL = 56;
/** Below this, the object is drawn as a plain block with no detail. */
export const MIN_PIXELS_FOR_DETAIL = 14;
