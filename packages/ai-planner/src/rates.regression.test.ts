import { describe, expect, it } from 'vitest';

import { installationRateSchema } from '@mfd/ai-contract';

import { dialysisSequenceSet, parseSequenceSet } from '../sequences/index';
import { fixtureInput } from '../fixtures/index';
import { planInstallation } from './plan';
import { type SequenceSet, sequenceSetSchema } from './sequenceSet';

/**
 * The four regressions owner decision **B-7** names, in the order it names them.
 *
 * > 1. Incomplete rate → validation failure
 * > 2. Missing source → Unknown output
 * > 3. Complete sourced rate → calculated output
 * > 4. Changing JSON only changes calculation result
 *
 * A separate file from `plan.test.ts` on purpose. Those tests describe what the planner does; these
 * are a **contract with the owner** about four specific failure modes, and keeping them together
 * under their own numbers means a reader checking the decision has one place to look and a future
 * refactor cannot quietly disperse them.
 *
 * Every case is built from the **shipped** `standards/sequences/dialysis.json`, edited the way an
 * editor of that file would edit it. A test built from a hand-made fixture would prove the planner
 * works on fixtures.
 */

/** The shipped set with rates added — a data edit, expressed in code. */
function withRates(rates: readonly Record<string, unknown>[]): SequenceSet {
  return sequenceSetSchema.parse({ ...dialysisSequenceSet, installationRates: rates });
}

/** A complete, sourced rate for one stage. */
function rate(stage: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `rate_${stage}`,
    stage,
    hoursFixed: 2,
    hoursPerStation: 1.5,
    minimumPersons: 2,
    recommendedPersons: 3,
    source: 'KS B 0000:2026 § 7.3',
    ...overrides,
  };
}

/** Every stage of the shipped set, rated identically. */
function allRated(overrides: Record<string, unknown> = {}) {
  return dialysisSequenceSet.stages.map((stage) => rate(stage.id, overrides));
}

// ---------------------------------------------------------------------------
// 1. Incomplete rate → validation failure
// ---------------------------------------------------------------------------

describe('B-7 regression 1 — an incomplete rate fails validation', () => {
  /*
   * The four the owner names by hand, plus `recommendedPersons`, because "missing manpower values"
   * covers both halves of the range. Each is dropped from an otherwise valid rate, so the test says
   * *this field* rather than *this object is malformed*.
   */
  const required = [
    'hoursFixed',
    'hoursPerStation',
    'minimumPersons',
    'recommendedPersons',
    'source',
  ] as const;

  it.each(required)('rejects a rate with no %s', (field) => {
    const partial: Record<string, unknown> = rate('equipment_set');
    delete partial[field];
    expect(installationRateSchema.safeParse(partial).success).toBe(false);
  });

  it('rejects the whole sequence set rather than skipping the bad rate', () => {
    /*
     * The stronger half, and the one that matters operationally. If a malformed rate were merely
     * *skipped*, its stage would silently report Unknown and the person who typed it would believe
     * they had supplied it — the failure would be invisible on exactly the day somebody needed the
     * figure. The file fails to load instead, at application start.
     */
    const partial: Record<string, unknown> = rate('equipment_set');
    delete partial['source'];

    expect(() => withRates([partial])).toThrow();
    expect(() =>
      parseSequenceSet('test.json', {
        ...dialysisSequenceSet,
        installationRates: [partial],
      }),
    ).toThrow(/not a valid installation sequence set/);
  });

  it('rejects a rate naming a stage that does not exist', () => {
    // The likeliest real typo, and the most misleading: the intended stage keeps reporting Unknown
    // while a rate for a phantom stage sits in the file looking supplied.
    expect(() => withRates([rate('equipmnet_set')])).toThrow(/name a stage in this file/);
  });

  it('rejects two rates for one stage', () => {
    expect(() =>
      withRates([rate('equipment_set'), rate('equipment_set', { id: 'rate_duplicate' })]),
    ).toThrow(/at most one installation rate/);
  });
});

// ---------------------------------------------------------------------------
// 2. Missing source → Unknown output
// ---------------------------------------------------------------------------

describe('B-7 regression 2 — no sourced rate means Unknown', () => {
  it('reports Unknown for a stage with no rate at all', () => {
    // The shipped state: `installationRates: []`, so no stage has one.
    const result = planInstallation(dialysisSequenceSet, fixtureInput());

    expect(result.ratesAvailable).toBe(false);
    for (const stage of result.stages) {
      expect(stage.duration.value).toBeNull();
      expect(stage.duration.status).toBe('unknown');
      expect(stage.duration.calculation).toBeNull();
      expect(stage.manpower.minimum).toBeNull();
      expect(stage.manpower.recommended).toBeNull();
    }
  });

  it('reports Unknown for the stages that have none, even when others do', () => {
    /*
     * A half-rated file. The rated stage calculates; the rest stay Unknown; and the **plan total**
     * is Unknown rather than a sum over the stages that happened to have figures — a partial total
     * is smaller than the truth, looks complete, and is the one somebody quotes.
     */
    const set = withRates([rate('equipment_set')]);
    const result = planInstallation(set, fixtureInput());

    const rated = result.stages.find((stage) => stage.id === 'equipment_set');
    const unrated = result.stages.find((stage) => stage.id === 'handover');

    expect(rated?.duration.value).toBe(6.5);
    expect(unrated?.duration.value).toBeNull();
    expect(result.duration.status).toBe('unknown');
    expect(result.manpower.status).toBe('unknown');
    expect(result.ratesAvailable).toBe(false);
  });

  it('never produces a figure whose citation is absent', () => {
    /*
     * The invariant behind the whole decision, asserted over a real plan rather than a fixture: no
     * number reaches an engineer without a document behind it. `unknown` figures carry no value, and
     * every value that exists names either a citation or nothing but measurements.
     */
    const result = planInstallation(withRates(allRated()), fixtureInput());

    for (const stage of result.stages) {
      if (stage.duration.value !== null) {
        expect(stage.duration.calculation?.citation).toBeTruthy();
        expect(stage.duration.calculation?.rateId).toBeTruthy();
      }
      if (stage.manpower.recommended !== null) {
        expect(stage.manpower.source.citation).toBeTruthy();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Complete sourced rate → calculated output
// ---------------------------------------------------------------------------

describe('B-7 regression 3 — a complete sourced rate calculates', () => {
  it('applies the formula the decision states', () => {
    // Duration = hoursFixed + (hoursPerStation × stationCount) = 2 + 1.5 × 3.
    const stage = planInstallation(withRates(allRated()), fixtureInput()).stages[0];

    expect(stage?.duration.value).toBe(6.5);
    expect(stage?.duration.status).toBe('calculated');
    expect(stage?.duration.calculation?.formula).toBe(
      'hoursFixed + (hoursPerStation × stationCount)',
    );
  });

  it('exposes all four disclosures on the figure', () => {
    // Formula, input values, rate id, source citation — B-7's four, on one object.
    const stage = planInstallation(withRates(allRated()), fixtureInput()).stages[0];
    const calculation = stage?.duration.calculation;

    expect(calculation?.formula).toBeTruthy();
    expect(Object.fromEntries((calculation?.inputs ?? []).map((i) => [i.name, i.value]))).toEqual({
      hoursFixed: 2,
      hoursPerStation: 1.5,
      stationCount: 3,
    });
    expect(calculation?.rateId).toBe(`rate_${stage?.id}`);
    expect(calculation?.citation).toBe('KS B 0000:2026 § 7.3');
  });

  it('reads manpower as the rate’s two figures', () => {
    // Manpower = minimumPersons, recommendedPersons. Read, never derived.
    const stage = planInstallation(
      withRates(allRated({ minimumPersons: 3, recommendedPersons: 5 })),
      fixtureInput(),
    ).stages[0];

    expect(stage?.manpower.minimum).toBe(3);
    expect(stage?.manpower.recommended).toBe(5);
    expect(stage?.manpower.source.kind).toBe('installation_rate');
  });

  it('flips the report from the B-7 sentence to figures', () => {
    // `ratesAvailable` is what the renderers branch on. One flag, so three renderers cannot each
    // decide differently why a figure is absent.
    expect(planInstallation(withRates(allRated()), fixtureInput()).ratesAvailable).toBe(true);
  });

  it('scales with the station count, and only with it', () => {
    const set = withRates(allRated());
    const three = planInstallation(set, fixtureInput());
    const one = planInstallation(set, {
      ...fixtureInput(),
      placements: fixtureInput().placements.slice(0, 1),
    });

    // 2 + 1.5 × 3 against 2 + 1.5 × 1.
    expect(three.stages[0]?.duration.value).toBe(6.5);
    expect(one.stages[0]?.duration.value).toBe(3.5);
  });
});

// ---------------------------------------------------------------------------
// 4. Changing JSON only changes the calculation result
// ---------------------------------------------------------------------------

describe('B-7 regression 4 — the data layer is the only place rates are maintained', () => {
  /*
   * > *"No code changes should be required when: adding new stages, updating installation rates,
   * > updating source references."*
   *
   * Three scenarios, one per clause. Each is a pure data edit expressed as an edit to the parsed
   * shipped set — nothing in `src/` names a stage, an hour, a person or a standard.
   */

  it('updating a rate changes the number and nothing else', () => {
    const before = planInstallation(withRates(allRated()), fixtureInput());
    const after = planInstallation(
      withRates(allRated({ hoursFixed: 4, hoursPerStation: 3 })),
      fixtureInput(),
    );

    // 2 + 1.5 × 3 = 6.5 becomes 4 + 3 × 3 = 13.
    expect(before.stages[0]?.duration.value).toBe(6.5);
    expect(after.stages[0]?.duration.value).toBe(13);
    // The plan is otherwise identical: same stages, same order, same connections, same materials.
    expect(after.stages.map((s) => s.id)).toEqual(before.stages.map((s) => s.id));
    expect(JSON.stringify(after.connections)).toBe(JSON.stringify(before.connections));
    expect(JSON.stringify(after.materials)).toBe(JSON.stringify(before.materials));
  });

  it('updating a source reference changes the citation and not the number', () => {
    /*
     * The clause most likely to be got wrong by an implementation that cached or derived citations:
     * re-citing a rate to a new revision of a standard must move the reference and leave the
     * arithmetic exactly where it was.
     */
    const before = planInstallation(withRates(allRated()), fixtureInput());
    const after = planInstallation(
      withRates(allRated({ source: 'KS B 9999:2027 § 12.1' })),
      fixtureInput(),
    );

    expect(after.stages[0]?.duration.value).toBe(before.stages[0]?.duration.value);
    expect(after.stages[0]?.duration.calculation?.citation).toBe('KS B 9999:2027 § 12.1');
    expect(after.stages[0]?.manpower.source.citation).toBe('KS B 9999:2027 § 12.1');
  });

  it('adding a stage adds it to the plan, in the order the file declares', () => {
    /*
     * A whole new stage, with its own rate, added as data. It appears in the sequence, it depends on
     * what the file says it depends on, and it contributes its hours to the total — with no code
     * change of any kind.
     */
    const added = {
      id: 'water_softener_commissioning',
      title: { ko: '연수기 시운전', en: 'Water Softener Commissioning' },
      dependsOn: ['ro_pressure_test'],
      appliesWhen: { kind: 'has_reference_point', referencePointKind: 'ro_supply' },
      checklistItemIds: ['water_quality'],
      tools: [],
      materials: [],
      risks: [],
      carriesServiceMaterials: false,
    };

    const set = sequenceSetSchema.parse({
      ...dialysisSequenceSet,
      stages: [...dialysisSequenceSet.stages, added],
      installationRates: [...allRated(), rate('water_softener_commissioning')],
    });
    const result = planInstallation(set, fixtureInput());

    const stage = result.stages.find((entry) => entry.id === 'water_softener_commissioning');
    expect(stage).toBeDefined();
    expect(stage?.dependsOn).toContain('ro_pressure_test');
    expect(stage?.duration.value).toBe(6.5);

    // And it prints after the test it depends on, because the topological sort read the file.
    const order = new Map(result.stages.map((entry) => [entry.id, entry.order]));
    expect(order.get('ro_pressure_test')).toBeLessThan(order.get('water_softener_commissioning') ?? 0);

    // The total grew by exactly the new stage's contribution.
    const without = planInstallation(withRates(allRated()), fixtureInput());
    expect(result.duration.value).toBe((without.duration.value ?? 0) + 6.5);
  });

  it('produces the same plan twice from the same data', () => {
    // Determinism, so "changing the JSON changed the result" is a statement about the JSON.
    const set = withRates(allRated());
    expect(JSON.stringify(planInstallation(set, fixtureInput()))).toBe(
      JSON.stringify(planInstallation(set, fixtureInput())),
    );
  });
});
