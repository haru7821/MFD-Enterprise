import { describe, expect, it } from 'vitest';

import {
  EVIDENCE_INVARIANTS,
  type SourcedNumber,
  calculatedNumber,
  measuredNumber,
  statedNumber,
  unknownNumber,
  unknownText,
} from './evidence';
import { sourcedNumberSchema, sourcedTextSchema } from './schema';

/**
 * The five evidence invariants, one test each, each verified by breaking it.
 *
 * These are the owner's Sprint 6 §§ 4–5 in executable form. Every one of them exists because a
 * number that reaches an engineering document without its provenance is indistinguishable from one
 * that has it — and the whole difference between this product and a spreadsheet is that a reader
 * can tell which they are looking at.
 */

/** A valid starting point, spoiled one field at a time. */
function valid(): SourcedNumber {
  return statedNumber(2, 'person', 'sequence_set', 'dialysis_installation:equipment_set', 'planning');
}

describe('the invariants are stated once', () => {
  it('names all five, so the schema and the prose cannot drift', () => {
    // If a sixth is added, this fails until it has been written down beside the other five.
    expect(EVIDENCE_INVARIANTS.map((entry) => entry.id)).toEqual([
      'EV-1',
      'EV-2',
      'EV-3',
      'EV-4',
      'EV-5',
    ]);
  });
});

describe('EV-1 — a value is null exactly when its status is unknown', () => {
  it('accepts an unknown with no value', () => {
    expect(sourcedNumberSchema.safeParse(unknownNumber('hour', 'no_rate')).success).toBe(true);
  });

  it('rejects an unknown that carries a number anyway', () => {
    // "16 hours (unknown)" is a guess wearing a disclaimer, and it is the shape an estimate takes
    // when somebody wants to ship one without owning it.
    const spoiled = { ...unknownNumber('hour', 'no_rate'), value: 16 };
    expect(sourcedNumberSchema.safeParse(spoiled).success).toBe(false);
  });

  it('rejects a stated figure that lost its number', () => {
    const spoiled = { ...valid(), value: null };
    expect(sourcedNumberSchema.safeParse(spoiled).success).toBe(false);
  });
});

describe('EV-2 — never generate uncited engineering values', () => {
  it('rejects a figure sourced to nothing', () => {
    /*
     * The load-bearing one. `not_supplied` is the only source kind that carries no authority, so
     * pairing it with a real number is precisely "an uncited engineering value" — and there is no
     * other way to express one, because every remaining kind names something a reader can look up.
     */
    const spoiled: SourcedNumber = {
      value: 16,
      unit: 'hour',
      status: 'planning',
      source: { kind: 'not_supplied', ref: 'nothing', inputs: [] },
    };
    const result = sourcedNumberSchema.safeParse(spoiled);
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/EV-2/);
  });

  it('rejects an unknown that claims a source', () => {
    // The mirror, and it matters: an unknown attributed to the manual reads as though the manual
    // said "unknown", which is a statement nobody made.
    const spoiled: SourcedNumber = {
      value: null,
      unit: 'hour',
      status: 'unknown',
      source: { kind: 'manufacturer_manual', ref: 'AK98 §4', inputs: [] },
    };
    expect(sourcedNumberSchema.safeParse(spoiled).success).toBe(false);
  });
});

describe('EV-3 and EV-4 — calculated means computed from something named', () => {
  it('accepts a calculation that names its inputs', () => {
    const figure = calculatedNumber(24, 'hour', 'equipment_set.duration', [
      'rate:equipment_set.hours_per_station',
      'measurement:station_count',
    ]);
    expect(sourcedNumberSchema.safeParse(figure).success).toBe(true);
  });

  it('refuses at construction to calculate from nothing', () => {
    expect(() => calculatedNumber(24, 'hour', 'equipment_set.duration', [])).toThrow(/uncited/);
  });

  it('rejects a calculated status without a derived source', () => {
    const spoiled = { ...valid(), status: 'calculated' as const };
    const result = sourcedNumberSchema.safeParse(spoiled);
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/EV-3/);
  });

  it('rejects inputs on something that was not derived', () => {
    // Inputs on a manual-sourced figure would suggest arithmetic that never happened.
    const spoiled = { ...valid(), source: { ...valid().source, inputs: ['something'] } };
    const result = sourcedNumberSchema.safeParse(spoiled);
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/EV-4/);
  });
});

describe('EV-5 — only a document can verify', () => {
  it('rejects a measurement claiming to be verified', () => {
    /*
     * A routed length measured off a drawing is a fact about the drawing. Calling it verified would
     * put a figure derived from somebody's tracing into the same column as one from the
     * manufacturer's manual, which is the specific confusion the report's provenance section
     * exists to prevent.
     */
    const spoiled = { ...measuredNumber(8_400, 'mm', 'route:ro'), status: 'verified' as const };
    const result = sourcedNumberSchema.safeParse(spoiled);
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/EV-5/);
  });

  it('accepts a manual-sourced figure as verified', () => {
    const figure = statedNumber(1_200, 'mm', 'manufacturer_manual', 'AK98 §4.2', 'verified');
    expect(sourcedNumberSchema.safeParse(figure).success).toBe(true);
  });

  it('carries a draft catalogue figure through as draft', () => {
    // Not upgraded. A planning figure taken from a draft catalogue field is a draft figure, and
    // promoting it here would undo the object library's verification mechanism from one package over.
    const figure = statedNumber(800, 'mm', 'catalogue_field', 'vantive_ak98:dimensions', 'draft');
    const parsed = sourcedNumberSchema.safeParse(figure);
    expect(parsed.success).toBe(true);
    expect(figure.status).toBe('draft');
  });
});

describe('sourced text holds the same line', () => {
  it('accepts an unknown requirement', () => {
    expect(sourcedTextSchema.safeParse(unknownText('AK98:power_inlet')).success).toBe(true);
  });

  it('rejects a statement with no source', () => {
    const spoiled = {
      value: { ko: '16A 전용 회로', en: '16 A dedicated circuit' },
      status: 'planning' as const,
      source: { kind: 'not_supplied' as const, ref: 'nothing', inputs: [] },
    };
    expect(sourcedTextSchema.safeParse(spoiled).success).toBe(false);
  });
});
