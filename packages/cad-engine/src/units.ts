/**
 * Units.
 *
 * Architecture decision AD-1: every model-space length in MFD-E is a millimetre.
 * Clearance rules are written in millimetres, so the model speaks millimetres and
 * nothing else. Pixels exist only inside a {@link Viewport} transform and are never
 * persisted.
 */

/**
 * A length in model space, in millimetres.
 *
 * This is a documentation alias rather than a branded type: branding every
 * coordinate would make the geometry maths unreadable for no safety we do not
 * already get from keeping pixels out of the model entirely.
 */
export type Millimetres = number;

export const MM_PER_METRE = 1000;
export const MM_PER_CENTIMETRE = 10;

export function metresToMillimetres(metres: number): Millimetres {
  return metres * MM_PER_METRE;
}

export function millimetresToMetres(millimetres: Millimetres): number {
  return millimetres / MM_PER_METRE;
}

export interface FormatLengthOptions {
  /** Force a unit instead of choosing one from the magnitude. */
  readonly unit?: 'mm' | 'm';
  /** Decimal places used when rendering metres. Default 2. */
  readonly metreDecimals?: number;
}

/**
 * Render a length for display. Millimetres are shown whole — sub-millimetre
 * precision is meaningless for facility layout and reads as false accuracy.
 */
export function formatLength(millimetres: Millimetres, options: FormatLengthOptions = {}): string {
  const unit = options.unit ?? (Math.abs(millimetres) >= MM_PER_METRE ? 'm' : 'mm');

  if (unit === 'm') {
    return `${millimetresToMetres(millimetres).toFixed(options.metreDecimals ?? 2)} m`;
  }
  return `${Math.round(millimetres)} mm`;
}
