import { describe, expect, it } from 'vitest';

import {
  type Calculation,
  EVIDENCE_INVARIANTS,
  type SourcedNumber,
  calculatedNumber,
  measuredNumber,
  statedNumber,
  statedRange,
  unknownNumber,
  unknownRange,
  unknownText,
} from './evidence';
import {
  installationRateSchema,
  sourcedNumberSchema,
  sourcedRangeSchema,
  sourcedTextSchema,
} from './schema';

/**
 * The seven evidence invariants, one test each, each verified by breaking it.
 *
 * These are the owner's Sprint 6 §§ 4–5 and decision B-7 in executable form. Every one of them
 * exists because a number that reaches an engineering document without its provenance is
 * indistinguishable from one that has it — and the whole difference between this product and a
 * spreadsheet is that a reader can tell which they are looking at.
 */

/** A valid starting point, spoiled one field at a time. */
function valid(): SourcedNumber {
  return statedNumber(2, 'person', 'sequence_set', 'dialysis_installation:equipment_set', 'planning');
}

/** A duration calculated exactly as B-7 defines it. */
function durationCalculation(): Calculation {
  return {
    formula: 'hoursFixed + (hoursPerStation × stationCount)',
    inputs: [
      { name: 'hoursFixed', value: 2, unit: 'hour', ref: 'rate_equipment_set' },
      { name: 'hoursPerStation', value: 1.5, unit: 'hour', ref: 'rate_equipment_set' },
      { name: 'stationCount', value: 12, unit: 'count', ref: 'measurement:placement_count' },
    ],
    rateId: 'rate_equipment_set',
    citation: 'KS B 0000:2026 § 7.3',
  };
}

describe('the invariants are stated once', () => {
  it('names all seven, so the schema and the prose cannot drift', () => {
    // If an eighth is added, this fails until it has been written down beside the others.
    expect(EVIDENCE_INVARIANTS.map((entry) => entry.id)).toEqual([
      'EV-1',
      'EV-2',
      'EV-3',
      'EV-4',
      'EV-5',
      'EV-6',
      'EV-7',
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
    expect(sourcedNumberSchema.safeParse({ ...valid(), value: null }).success).toBe(false);
  });

  it('keeps both crew figures absent together', () => {
    /*
     * B-7 defines manpower as `minimumPersons, recommendedPersons`. A range with one figure and not
     * the other leaves a reader unable to tell a floor from a recommendation, which is a worse
     * answer than Unknown.
     */
    const half = { ...unknownRange('person', 'no_rate'), minimum: 2 };
    expect(sourcedRangeSchema.safeParse(half).success).toBe(false);
  });

  it('rejects a recommended crew below the minimum', () => {
    // Not an evidence rule — a transcription error in the rate, caught where it enters.
    const backwards = { ...statedRange(4, 2, 'person', 'rate_x', 'KS B 0000 § 7'), };
    expect(sourcedRangeSchema.safeParse(backwards).success).toBe(false);
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
      source: { kind: 'not_supplied', ref: 'nothing', citation: null },
      calculation: null,
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
      source: { kind: 'manufacturer_manual', ref: 'AK98 §4', citation: 'AK98 rev C §4' },
      calculation: null,
    };
    expect(sourcedNumberSchema.safeParse(spoiled).success).toBe(false);
  });
});

describe('EV-3 and EV-4 — calculated means computed, with the arithmetic attached', () => {
  it('accepts a duration with its formula, inputs, rate and citation', () => {
    const figure = calculatedNumber(20, 'hour', 'equipment_set.duration', durationCalculation());
    expect(sourcedNumberSchema.safeParse(figure).success).toBe(true);
    // B-7's four disclosures, all present on one object.
    expect(figure.calculation?.formula).toContain('hoursPerStation × stationCount');
    expect(figure.calculation?.inputs).toHaveLength(3);
    expect(figure.calculation?.rateId).toBe('rate_equipment_set');
    expect(figure.calculation?.citation).toBe('KS B 0000:2026 § 7.3');
  });

  it('exposes the value of every input, not only its name', () => {
    // So a reader holding a printed plan can check 2 + (1.5 × 12) = 20 without a data file.
    const figure = calculatedNumber(20, 'hour', 'equipment_set.duration', durationCalculation());
    const inputs = Object.fromEntries(
      (figure.calculation?.inputs ?? []).map((entry) => [entry.name, entry.value]),
    );
    expect(inputs['hoursFixed']).toBe(2);
    expect(inputs['hoursPerStation']).toBe(1.5);
    expect(inputs['stationCount']).toBe(12);
    expect(
      (inputs['hoursFixed'] ?? 0) + (inputs['hoursPerStation'] ?? 0) * (inputs['stationCount'] ?? 0),
    ).toBe(figure.value);
  });

  it('refuses at construction to calculate from nothing', () => {
    expect(() =>
      calculatedNumber(24, 'hour', 'x', { ...durationCalculation(), inputs: [] }),
    ).toThrow(/formula and its input values/);
  });

  it('rejects a calculated status with no arithmetic attached', () => {
    const spoiled = { ...valid(), status: 'calculated' as const };
    const result = sourcedNumberSchema.safeParse(spoiled);
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/EV-3/);
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
    const figure = statedNumber(
      1_200,
      'mm',
      'manufacturer_manual',
      'AK98 §4.2',
      'verified',
      'AK98 Installation Manual rev C § 4.2',
    );
    expect(sourcedNumberSchema.safeParse(figure).success).toBe(true);
  });

  it('carries a draft catalogue figure through as draft', () => {
    // Not upgraded. A planning figure taken from a draft catalogue field is a draft figure, and
    // promoting it here would undo the object library's verification mechanism from one package over.
    const figure = statedNumber(800, 'mm', 'catalogue_field', 'vantive_ak98:dimensions', 'draft');
    expect(sourcedNumberSchema.safeParse(figure).success).toBe(true);
    expect(figure.status).toBe('draft');
  });
});

describe('EV-6 — a rate is named only with its citation', () => {
  it('rejects a calculation naming a rate and no source', () => {
    /*
     * B-7: *"Planning calculations may use only sourced installation rates."* A rate id with no
     * citation is a figure that looks traceable and is not — the reader follows the id into a data
     * file and finds a number somebody typed.
     */
    const spoiled = calculatedNumber(20, 'hour', 'x', durationCalculation());
    const result = sourcedNumberSchema.safeParse({
      ...spoiled,
      calculation: { ...durationCalculation(), citation: null },
    });
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/EV-6/);
  });

  it('refuses at construction too', () => {
    expect(() =>
      calculatedNumber(20, 'hour', 'x', { ...durationCalculation(), rateId: null }),
    ).toThrow(/only sourced installation rates/);
  });

  it('allows arithmetic that used no rate at all', () => {
    // A summed pipe length is calculated and cites no standard, because none of its inputs came
    // from one. Both fields null together is the legal form of that.
    const figure = calculatedNumber(6_000, 'mm', 'route:ro:total', {
      formula: 'Σ run lengths',
      inputs: [{ name: 'station_1', value: 6_000, unit: 'mm', ref: 'route:ro:station_1' }],
      rateId: null,
      citation: null,
    });
    expect(sourcedNumberSchema.safeParse(figure).success).toBe(true);
  });
});

describe('EV-7 — an outside authority names its document', () => {
  it('rejects an installation rate source with no citation', () => {
    const spoiled = {
      ...statedRange(2, 3, 'person', 'rate_equipment_set', 'KS B 0000 § 7'),
      source: { kind: 'installation_rate' as const, ref: 'rate_equipment_set', citation: null },
    };
    const result = sourcedRangeSchema.safeParse(spoiled);
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/EV-7/);
  });

  it('accepts a crew read from a cited rate', () => {
    const range = statedRange(2, 3, 'person', 'rate_equipment_set', 'KS B 0000:2026 § 7.3');
    expect(sourcedRangeSchema.safeParse(range).success).toBe(true);
    expect(range.minimum).toBe(2);
    expect(range.recommended).toBe(3);
  });
});

describe('an InstallationRate is whole or it is not a rate', () => {
  const rate = {
    id: 'rate_equipment_set',
    stage: 'equipment_set',
    hoursFixed: 2,
    hoursPerStation: 1.5,
    minimumPersons: 2,
    recommendedPersons: 3,
    source: 'KS B 0000:2026 § 7.3',
  };

  it('accepts a complete one', () => {
    expect(installationRateSchema.safeParse(rate).success).toBe(true);
  });

  it.each([
    'hoursFixed',
    'hoursPerStation',
    'minimumPersons',
    'recommendedPersons',
    'source',
  ] as const)('rejects one missing %s', (field) => {
    /*
     * B-7: *"If any required rate is missing: Duration = Unknown, Manpower = Unknown."* Enforced at
     * the door rather than downstream — a rate with four of six fields would otherwise reach the
     * planner and tempt it to evaluate half a formula, which is interpolation by another name.
     */
    const partial: Record<string, unknown> = { ...rate };
    delete partial[field];
    expect(installationRateSchema.safeParse(partial).success).toBe(false);
  });

  it('rejects a crew of zero people', () => {
    expect(installationRateSchema.safeParse({ ...rate, minimumPersons: 0 }).success).toBe(false);
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
      source: { kind: 'not_supplied' as const, ref: 'nothing', citation: null },
    };
    expect(sourcedTextSchema.safeParse(spoiled).success).toBe(false);
  });
});
