/**
 * Canvas colours for rooms and obstructions.
 *
 * Konva paints into a bitmap and cannot read CSS custom properties, so these cannot
 * live in styles.css. Keep them visually in step with the tokens there.
 *
 * Rooms are drawn cooler and fainter than equipment on purpose. The building is
 * context; the machines are the subject of the review, and the drawing should read
 * that way at a glance.
 */
export const SPACE_THEME = {
  outline: {
    fill: 'rgba(120, 168, 210, 0.06)',
    stroke: '#5f7f9c',
    label: '#9fb6cb',
  },
  selected: {
    fill: 'rgba(120, 168, 210, 0.12)',
    stroke: '#bcd6ec',
  },
  obstruction: {
    fill: 'rgba(180, 120, 120, 0.16)',
    stroke: '#a06a6a',
    /** Hatched-looking dash, so a column never reads as a small room. */
    dash: [6, 4],
  },
  draft: {
    stroke: '#4a9eff',
    /** The rubber-band segment back to the pointer. */
    guide: 'rgba(74, 158, 255, 0.55)',
    vertex: '#4a9eff',
    /** The first vertex, enlarged when closing the ring is possible. */
    closeTarget: '#7ee081',
  },
  vertexHandle: {
    fill: '#4a9eff',
    stroke: '#0b1017',
  },
} as const;

/** Below this on-screen size, a room label is dropped rather than overlapping. */
export const MIN_PIXELS_FOR_ROOM_LABEL = 90;

/** Screen-pixel radius within which clicking the first vertex closes the ring. */
export const CLOSE_TARGET_RADIUS_PX = 10;

/**
 * Screen-pixel radius for grabbing a vertex or a midpoint handle.
 *
 * In **screen** pixels, not millimetres: a target that shrank as the engineer zoomed
 * out would become ungrabbable at exactly the zoom where they are trying to reshape a
 * whole floor.
 */
export const VERTEX_GRAB_RADIUS_PX = 9;
