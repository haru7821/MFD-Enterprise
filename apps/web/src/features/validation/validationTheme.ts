import type { ResultLevel } from '@mfd/rule-engine';

/**
 * Result colours.
 *
 * Konva paints into a bitmap and cannot read CSS custom properties, so canvas
 * colours cannot live in styles.css.
 *
 * Colour alone never carries a verdict here: every result also states its level in
 * words and gives a reason. Roughly one man in twelve has some red-green colour
 * deficiency, and a validator whose output such an engineer cannot read is not a
 * validator.
 */
export const RESULT_THEME: Record<
  ResultLevel,
  { readonly stroke: string; readonly text: string; readonly label: string }
> = {
  RED: { stroke: '#ff5f56', text: '#ffb4ae', label: 'Not acceptable' },
  YELLOW: { stroke: '#e8a03e', text: '#f2c891', label: 'Review required' },
  GREEN: { stroke: '#4caf7d', text: '#8fd8b4', label: 'OK' },
};

/** Worst-first, so a placement showing several results is drawn at its worst. */
export const LEVEL_ORDER: Record<ResultLevel, number> = { RED: 0, YELLOW: 1, GREEN: 2 };
