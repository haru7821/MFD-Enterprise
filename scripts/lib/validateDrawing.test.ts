import { describe, expect, it } from 'vitest';

import { TEXT_OVERRIDE_TOLERANCE, isTextOverride } from './validateDrawing';

/**
 * The discrepancy taxonomy's one numeric boundary.
 *
 * > Owner decision, the five-way taxonomy: a discrepancy is filed **against the drawing** or
 * > **against this reader**, never vaguely against both.
 *
 * When a printed dimension disagrees with the geometry beneath it, that decision is made here and
 * nowhere else. Within tolerance it is `drawing_error` — a draughtsman typed a round number over an
 * awkward one, and the note tells whoever holds the drawing. Beyond it, it is `extraction_error`:
 * this reader paired the label with the wrong line, and saying otherwise would blame a hospital for
 * our mistake.
 *
 * The audit found it completely unguarded — reclassifying every `drawing_error` as
 * `extraction_error` left the entire suite green, because `scripts/**` was not in vitest's
 * `include`. It was also written twice, once to exclude outliers from the calibration and once to
 * classify them, which is one edit away from a discrepancy excluded under one rule and reported
 * under another.
 */
describe('isTextOverride — drawing_error or extraction_error', () => {
  it('calls a few per cent a text override, in both directions', () => {
    // The ordinary case this exists for: 3,000 typed over a line that measures 2,910.
    expect(isTextOverride(0.03)).toBe(true);
    expect(isTextOverride(-0.03)).toBe(true);
    expect(isTextOverride(0)).toBe(true);
  });

  it('calls an order of magnitude our own extraction error', () => {
    // A label paired with the wrong line. Ten times out is not a draughting slip.
    expect(isTextOverride(9)).toBe(false);
    expect(isTextOverride(-0.9)).toBe(false);
  });

  it('is symmetric about zero', () => {
    // A dimension reading high and one reading low are the same kind of mistake.
    for (const error of [0.05, 0.1, 0.11, 0.5, 2]) {
      expect(isTextOverride(error)).toBe(isTextOverride(-error));
    }
  });

  it('puts the boundary exactly at the stated tolerance, inclusive', () => {
    /*
     * The assertion that pins the number rather than the shape. Written against
     * `TEXT_OVERRIDE_TOLERANCE` so moving the constant has to come here and say so, and with an
     * explicit 0.1 beside it so moving *both* silently is not enough either.
     */
    expect(TEXT_OVERRIDE_TOLERANCE).toBe(0.1);
    expect(isTextOverride(TEXT_OVERRIDE_TOLERANCE)).toBe(true);
    expect(isTextOverride(TEXT_OVERRIDE_TOLERANCE + 1e-9)).toBe(false);
    expect(isTextOverride(0.1)).toBe(true);
    expect(isTextOverride(0.101)).toBe(false);
  });
});
