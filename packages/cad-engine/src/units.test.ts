import { describe, expect, it } from 'vitest';

import { formatLength, metresToMillimetres, millimetresToMetres } from './units';

describe('unit conversion', () => {
  it('converts metres to millimetres and back', () => {
    expect(metresToMillimetres(2.4)).toBe(2_400);
    expect(millimetresToMetres(8_400)).toBeCloseTo(8.4, 9);
  });
});

describe('formatLength', () => {
  it('shows short lengths in whole millimetres', () => {
    expect(formatLength(900)).toBe('900 mm');
    expect(formatLength(899.6)).toBe('900 mm');
  });

  it('switches to metres at one metre', () => {
    expect(formatLength(1_000)).toBe('1.00 m');
    expect(formatLength(12_600)).toBe('12.60 m');
  });

  it('honours a forced unit', () => {
    expect(formatLength(12_600, { unit: 'mm' })).toBe('12600 mm');
    expect(formatLength(500, { unit: 'm', metreDecimals: 3 })).toBe('0.500 m');
  });

  it('handles negative offsets', () => {
    expect(formatLength(-750)).toBe('-750 mm');
    expect(formatLength(-2_500)).toBe('-2.50 m');
  });
});
