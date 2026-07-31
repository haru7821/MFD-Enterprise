import { describe, expect, it } from 'vitest';

import { installationPlanSchema, planStaleness } from '@mfd/ai-contract';

import { dialysisSequenceSet } from '../sequences/index';
import { sequenceSetSchema } from './sequenceSet';
import {
  FIXTURE_CHECKLIST_IDS,
  fixtureEquipment,
  fixtureEvaluation,
  fixtureInput,
  fixtureRate,
  fixtureSequenceSet,
  fixtureStage,
} from '../fixtures/index';
import { CyclicSequenceError, orderStages } from './order';
import { deterministicPlanner, planInstallation } from './plan';
import { resolveStages } from './stages';

/**
 * The planner, against the owner's Sprint 6 requirements.
 *
 * The load-bearing ones are §§ 4–5 — every figure cited or `unknown` — because that is the
 * requirement a planner is most tempted to break. A plan with no durations looks unfinished; a plan
 * with plausible durations looks professional; and the difference between them is whether a hospital
 * resources a job against a number somebody made up.
 */

const plan = () => planInstallation(dialysisSequenceSet, fixtureInput());

describe('§ 1 — only validated layouts', () => {
  it('records which evaluation the plan was made from', () => {
    /*
     * `PlanInput.evaluation` is required, so "never plan from a raw drawing" is a compile error
     * rather than a runtime check — there is no test that can be written for a call that cannot be
     * written. What *is* testable is the other half: the plan says which evaluation it rests on, so
     * a copy found on a desk in six months can be checked rather than assumed current.
     */
    const result = planInstallation(
      dialysisSequenceSet,
      fixtureInput({
        evaluation: fixtureEvaluation([
          { ruleId: 'clearance', reasonCode: 'RC-110', level: 'YELLOW', placementId: 'station_1' },
        ]),
      }),
    );

    expect(result.provenance.ruleSet).toEqual({ id: 'dialysis', version: '0.1.0' });
    expect(result.provenance.evaluationVersion).toBe(2);
    expect(result.provenance.findingCounts).toEqual({ red: 0, yellow: 1, green: 0 });
    expect(result.provenance.placementCount).toBe(3);
  });

  it('carries the optimisation when the layout came from one, and null when it did not', () => {
    expect(plan().provenance.optimisation).toBeNull();
  });
});

describe('§ 3 — installation sequence', () => {
  it('validates against the contract schema', () => {
    // Including the printed-order check, the "all three services" check and every evidence
    // invariant on every figure in it.
    const result = installationPlanSchema.safeParse(plan());
    expect(result.success).toBe(true);
  });

  it('prints every stage after everything it depends on', () => {
    const result = plan();
    const order = new Map(result.stages.map((stage) => [stage.id, stage.order]));

    for (const stage of result.stages) {
      for (const dependency of stage.dependsOn) {
        expect(order.get(dependency)).toBeLessThan(stage.order);
      }
    }
  });

  it('breaks ties on the file, so an engineer can reorder by editing it', () => {
    /*
     * `ro_pressure_test` and `electrical_energisation` both depend only on the rough-in and on
     * nothing else — either could legitimately print first. The file lists the pressure test first,
     * so the plan does. Swapping them in the sequence file swaps them in the plan, which is the
     * only sense in which the tie-break is a decision rather than an accident.
     */
    const set = fixtureSequenceSet([
      fixtureStage({ id: 'first' }),
      fixtureStage({ id: 'beta', dependsOn: ['first'] }),
      fixtureStage({ id: 'alpha', dependsOn: ['first'] }),
    ]);
    expect(orderStages(set.stages).map((stage) => stage.id)).toEqual(['first', 'beta', 'alpha']);

    const swapped = fixtureSequenceSet([
      fixtureStage({ id: 'first' }),
      fixtureStage({ id: 'alpha', dependsOn: ['first'] }),
      fixtureStage({ id: 'beta', dependsOn: ['first'] }),
    ]);
    expect(orderStages(swapped.stages).map((stage) => stage.id)).toEqual(['first', 'alpha', 'beta']);
  });

  it('refuses to order a cycle rather than emitting a plausible sequence', () => {
    // Built by hand: the shipped file is checked for cycles at load, so this is what would happen
    // if the rewiring ever introduced one.
    const stages = [
      { ...fixtureStage({ id: 'a', dependsOn: ['b'] }) },
      { ...fixtureStage({ id: 'b', dependsOn: ['a'] }) },
    ] as never;
    expect(() => orderStages(stages)).toThrow(CyclicSequenceError);
    expect(() => orderStages(stages)).toThrow(/discovered on site/);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(plan())).toBe(JSON.stringify(plan()));
  });
});

describe('a stage the project does not call for', () => {
  it('drops it, and rewires what depended on it', () => {
    /*
     * No RO reference point means no loop to pressure test. `service_connection` depends on that
     * test, so dropping the test without rewiring would leave a stage naming a prerequisite that is
     * not in the plan — which the contract schema rejects, correctly.
     */
    const input = fixtureInput({
      referencePoints: [{ id: 'point_panel', kind: 'electrical_panel', position: { x: 0, y: 0 } }],
    });
    const result = planInstallation(dialysisSequenceSet, input);

    expect(result.stages.map((stage) => stage.id)).not.toContain('ro_pressure_test');
    const connection = result.stages.find((stage) => stage.id === 'service_connection');
    expect(connection?.dependsOn).not.toContain('ro_pressure_test');
    // It inherited the dropped stage's own prerequisite, so it still comes after the rough-in.
    expect(connection?.dependsOn).toContain('services_rough_in');
    expect(installationPlanSchema.safeParse(result).success).toBe(true);
  });

  it('says why it is missing rather than quietly shortening the plan', () => {
    // The half that makes exclusion safe. A silently shorter plan reads as a simpler job.
    const input = fixtureInput({
      referencePoints: [{ id: 'point_panel', kind: 'electrical_panel', position: { x: 0, y: 0 } }],
    });
    const result = planInstallation(dialysisSequenceSet, input);

    const blocker = result.blockers.find((entry) => entry.stageId === 'ro_pressure_test');
    expect(blocker).toEqual({
      kind: 'missing_reference_point',
      ref: 'ro_supply',
      stageId: 'ro_pressure_test',
    });
  });

  it('drops the equipment stages when there is nothing placed', () => {
    const result = planInstallation(dialysisSequenceSet, fixtureInput({ placements: [] }));
    expect(result.stages.map((stage) => stage.id)).not.toContain('equipment_set');
    expect(
      result.blockers.some(
        (entry) => entry.kind === 'missing_prerequisite' && entry.ref === 'placements',
      ),
    ).toBe(true);
  });

  it('still produces the stages that do apply', () => {
    // Not an all-or-nothing refusal: site preparation and handover apply to any project.
    const result = planInstallation(dialysisSequenceSet, fixtureInput({ placements: [] }));
    expect(result.stages.map((stage) => stage.id)).toContain('site_preparation');
    expect(result.stages.map((stage) => stage.id)).toContain('handover');
  });
});

describe('§ 3 — the commissioning checklist is referenced, never re-authored', () => {
  it('every stage names only ids the report checklist actually has', () => {
    /*
     * The property § C-3 of the architecture turns on: one source, two views. A planner with its
     * own commissioning text would give an engineer two lists that can disagree, and the one they
     * followed on site would be the one that is not in the signed report.
     */
    for (const stage of plan().stages) {
      for (const id of stage.checklistItemIds) {
        expect(FIXTURE_CHECKLIST_IDS).toContain(id);
      }
    }
  });

  it('drops an item a customer removed from their checklist rather than dangling', () => {
    const input = fixtureInput({
      checklistItemIds: FIXTURE_CHECKLIST_IDS.filter((id) => id !== 'loop_pressure'),
    });
    const stage = planInstallation(dialysisSequenceSet, input).stages.find(
      (entry) => entry.id === 'ro_pressure_test',
    );

    expect(stage?.checklistItemIds).not.toContain('loop_pressure');
    // And the rest of the stage survives — one deleted item does not delete the test.
    expect(stage?.checklistItemIds).toContain('water_quality');
  });

  it('covers the whole checklist across the plan', () => {
    /*
     * Every item in the shipped checklist is allocated to exactly one stage. An item in the signed
     * report that no stage verifies is an item nobody is scheduled to do, which is precisely the
     * gap a plan exists to close.
     */
    const allocated = plan().stages.flatMap((stage) => stage.checklistItemIds);
    expect(new Set(allocated).size).toBe(allocated.length);
    for (const id of FIXTURE_CHECKLIST_IDS) {
      expect(allocated).toContain(id);
    }
  });
});

describe('B-7 — planning rates, or Unknown', () => {
  it('reports duration and manpower as unknown on the shipped data', () => {
    /*
     * `standards/sequences/dialysis.json` ships `installationRates: []`, because no installation
     * standard has been supplied. So there is nothing to calculate from, and the answer is
     * `unknown` naming the rate that would answer it — never a plausible number.
     */
    const result = plan();
    expect(result.ratesAvailable).toBe(false);
    expect(result.duration.status).toBe('unknown');
    expect(result.duration.value).toBeNull();
    expect(result.manpower.status).toBe('unknown');
    expect(result.manpower.minimum).toBeNull();
    expect(result.manpower.recommended).toBeNull();

    for (const stage of result.stages) {
      expect(stage.duration.value).toBeNull();
      expect(stage.duration.calculation).toBeNull();
      expect(stage.duration.source.ref).toContain('installation_rate');
    }
  });

  it('calculates the duration by the formula, and shows all four disclosures', () => {
    /*
     * B-7: *"Every calculated value must expose: calculation formula, input values, rate id, source
     * citation."* All four ride on the figure, so a printed plan can be checked without a data file.
     */
    const set = fixtureSequenceSet(
      [fixtureStage({ id: 'equipment_set', appliesWhen: { kind: 'has_placements' } })],
      [fixtureRate({ id: 'rate_equipment_set', stage: 'equipment_set' })],
    );
    const stage = planInstallation(set, fixtureInput()).stages[0];

    // 2 fixed + 1.5 × 3 stations.
    expect(stage?.duration.value).toBe(6.5);
    expect(stage?.duration.status).toBe('calculated');
    expect(stage?.duration.calculation?.formula).toBe(
      'hoursFixed + (hoursPerStation × stationCount)',
    );
    expect(stage?.duration.calculation?.rateId).toBe('rate_equipment_set');
    expect(stage?.duration.calculation?.citation).toBe('KS B 0000:2026 § 7.3');

    // The input *values*, so the arithmetic is checkable rather than merely attributed.
    const inputs = Object.fromEntries(
      (stage?.duration.calculation?.inputs ?? []).map((entry) => [entry.name, entry.value]),
    );
    expect(inputs).toEqual({ hoursFixed: 2, hoursPerStation: 1.5, stationCount: 3 });
  });

  it('reads manpower as the rate’s two figures, never derived', () => {
    // B-7: `Manpower = minimumPersons, recommendedPersons`. A range read from the rate, with the
    // rate id and its citation attached — and no calculation, because none happened.
    const set = fixtureSequenceSet(
      [fixtureStage({ id: 'equipment_set', appliesWhen: { kind: 'has_placements' } })],
      [
        fixtureRate({
          id: 'rate_equipment_set',
          stage: 'equipment_set',
          minimumPersons: 2,
          recommendedPersons: 4,
        }),
      ],
    );
    const stage = planInstallation(set, fixtureInput()).stages[0];

    expect(stage?.manpower.minimum).toBe(2);
    expect(stage?.manpower.recommended).toBe(4);
    expect(stage?.manpower.source.kind).toBe('installation_rate');
    expect(stage?.manpower.source.citation).toBe('KS B 0000:2026 § 7.3');
  });

  it('never evaluates half a formula', () => {
    /*
     * The heart of B-7. A rate missing any field is rejected at the schema, so it cannot reach the
     * planner at all — which is what stops a stage with only a per-station figure producing a
     * duration as though its fixed overhead were zero. Treating a missing component as zero is
     * interpolation, and the decision forbids it by name.
     */
    for (const field of ['hoursFixed', 'hoursPerStation', 'minimumPersons', 'source'] as const) {
      const partial: Record<string, unknown> = fixtureRate({ stage: 'equipment_set' });
      delete partial[field];
      expect(() =>
        fixtureSequenceSet(
          [fixtureStage({ id: 'equipment_set', appliesWhen: { kind: 'has_placements' } })],
          [partial],
        ),
      ).toThrow();
    }
  });

  it('reports an unknown total rather than the sum of the stages that had rates', () => {
    /*
     * The most dangerous number this package could produce: a total over the stages that happened
     * to have rates is smaller than the truth, looks complete, and is the one somebody quotes.
     */
    const set = fixtureSequenceSet(
      [
        fixtureStage({ id: 'timed' }),
        fixtureStage({ id: 'untimed', dependsOn: ['timed'] }),
      ],
      [fixtureRate({ id: 'rate_timed', stage: 'timed', hoursFixed: 8, hoursPerStation: 0 })],
    );
    const result = planInstallation(set, fixtureInput());

    expect(result.stages[0]?.duration.value).toBe(8);
    expect(result.stages[1]?.duration.value).toBeNull();
    expect(result.duration.status).toBe('unknown');
    expect(result.duration.source.ref).toContain('incomplete');
    // And the flag the report branches on says the same thing, once.
    expect(result.ratesAvailable).toBe(false);
  });

  it('totals the durations when every stage has a rate, naming every standard behind it', () => {
    const set = fixtureSequenceSet(
      [fixtureStage({ id: 'one' }), fixtureStage({ id: 'two', dependsOn: ['one'] })],
      [
        fixtureRate({ id: 'rate_one', stage: 'one', hoursFixed: 4, hoursPerStation: 0 }),
        fixtureRate({
          id: 'rate_two',
          stage: 'two',
          hoursFixed: 1,
          hoursPerStation: 2,
          source: 'KS B 1111:2026 § 3',
        }),
      ],
    );
    const result = planInstallation(set, fixtureInput());

    // 4 + (1 + 2 × 3).
    expect(result.duration.value).toBe(11);
    expect(result.ratesAvailable).toBe(true);
    // Both rates named, and both citations — one id would be a lie about where the other hours came
    // from, and EV-6 would not catch it because the field would be populated.
    expect(result.duration.calculation?.rateId).toBe('rate_one + rate_two');
    expect(result.duration.calculation?.citation).toContain('KS B 1111:2026 § 3');
  });

  it('takes the peak crew rather than the sum, because stages run in sequence', () => {
    const set = fixtureSequenceSet(
      [fixtureStage({ id: 'small' }), fixtureStage({ id: 'large', dependsOn: ['small'] })],
      [
        fixtureRate({ id: 'rate_small', stage: 'small', minimumPersons: 1, recommendedPersons: 2 }),
        fixtureRate({ id: 'rate_large', stage: 'large', minimumPersons: 3, recommendedPersons: 5 }),
      ],
    );
    const result = planInstallation(set, fixtureInput());

    expect(result.manpower.recommended).toBe(5);
    expect(result.manpower.minimum).toBe(3);
    // The peak keeps the citation of the stage that set it, so a reader can see which one did.
    expect(result.manpower.source.ref).toBe('rate_large');
  });

  it('rejects a rate for a stage that does not exist', () => {
    // The likeliest cause is a typo in a stage id, which would leave the real stage reporting
    // Unknown while somebody believed they had supplied its figures.
    expect(() =>
      fixtureSequenceSet([fixtureStage({ id: 'real' })], [fixtureRate({ stage: 'typo' })]),
    ).toThrow(/name a stage in this file/);
  });

  it('rejects two rates for one stage', () => {
    expect(() =>
      fixtureSequenceSet(
        [fixtureStage({ id: 'one' })],
        [fixtureRate({ id: 'a', stage: 'one' }), fixtureRate({ id: 'b', stage: 'one' })],
      ),
    ).toThrow(/at most one installation rate/);
  });
});

describe('§ 3 — the connection plans', () => {
  it('always carries all three services', () => {
    const result = planInstallation(dialysisSequenceSet, fixtureInput({ referencePoints: [] }));
    expect(result.connections.map((entry) => entry.service)).toEqual([
      'power',
      'ro_water',
      'drain',
    ]);
    // With no origin marked, and saying so — rather than being absent, which would read as a
    // project with no drain requirement.
    for (const connection of result.connections) {
      expect(connection.originPointId).toBeNull();
      expect(connection.totalLength.status).toBe('unknown');
    }
  });

  it('totals the measured runs, naming each one', () => {
    const ro = plan().connections.find((entry) => entry.service === 'ro_water');
    expect(ro?.runs).toHaveLength(3);
    expect(ro?.totalLength.value).toBe(6_000);
    expect(ro?.totalLength.status).toBe('calculated');
    expect(ro?.totalLength.calculation?.inputs).toHaveLength(3);
    // Cites nothing, correctly: every input is a length measured off the drawing.
    expect(ro?.totalLength.calculation?.citation).toBeNull();
  });

  it('reports an unknown total when one machine could not be routed', () => {
    // Not the sum of what was measurable. Somebody orders pipe against this number.
    const full = fixtureInput();
    const input = fixtureInput({
      routedLengths: full.routedLengths.filter(
        (entry) => !(entry.service === 'ro_water' && entry.placementId === 'station_2'),
      ),
    });
    const ro = planInstallation(dialysisSequenceSet, input).connections.find(
      (entry) => entry.service === 'ro_water',
    );

    expect(ro?.totalLength.status).toBe('unknown');
    expect(ro?.runs.find((run) => run.placementId === 'station_2')?.length.value).toBeNull();
  });

  it('never states a connection specification the catalogue does not have', () => {
    // A-1: `connections.*.specification` is null on every record until the AK98 manual arrives, so
    // a buyer is told how many and told to ask what kind.
    for (const connection of plan().connections) {
      for (const run of connection.runs) {
        expect(run.requirement.status).toBe('unknown');
        expect(run.requirement.source.ref).toContain('connections');
      }
    }
  });

  it('measures rather than verifies, so a drawing cannot pass as a survey', () => {
    const ro = plan().connections.find((entry) => entry.service === 'ro_water');
    for (const run of ro?.runs ?? []) {
      expect(run.length.status).toBe('planning');
      expect(run.length.source.kind).toBe('measurement');
    }
  });
});

describe('§ 9 — the bill of materials', () => {
  it('derives a connection set per machine per required service', () => {
    const bom = plan().materials;
    const power = bom.find((entry) => entry.id === 'power_connection_set');

    expect(power?.quantity.value).toBe(3);
    expect(power?.quantity.status).toBe('calculated');
    // Both halves of the arithmetic named: the catalogue said power is required, the drawing holds
    // three machines.
    // The arithmetic is on the figure, line by line: which record contributed how many.
    expect(power?.quantity.calculation?.inputs).toEqual([
      {
        name: 'vantive_ak98',
        value: 3,
        unit: 'each',
        ref: 'catalogue_field:vantive_ak98.connections.power',
      },
    ]);
  });

  it('omits a service the equipment does not require', () => {
    const input = fixtureInput({
      equipment: [
        fixtureEquipment({
          connections: [
            { service: 'power', required: true, specified: false, status: 'draft' },
            { service: 'ro_water', required: false, specified: false, status: 'draft' },
            { service: 'drain', required: false, specified: false, status: 'draft' },
          ],
        }),
      ],
    });
    const bom = planInstallation(dialysisSequenceSet, input).materials;
    expect(bom.map((entry) => entry.id)).toEqual(['power_connection_set']);
  });

  it('lists the tools a check entails, with the check named', () => {
    const test = plan().stages.find((stage) => stage.id === 'ro_pressure_test');
    expect(test?.tools.map((tool) => tool.id)).toContain('pressure_test_rig');
    expect(test?.tools[0]?.quantity.source.ref).toContain('sequence_set:');
  });
});

describe('blockers and risks', () => {
  it('leads with a RED finding rather than sequencing past it', () => {
    const input = fixtureInput({
      evaluation: fixtureEvaluation([
        { ruleId: 'collision', reasonCode: 'RC-201', level: 'RED', placementId: 'station_1' },
      ]),
    });
    const result = planInstallation(dialysisSequenceSet, input);

    expect(result.blockers[0]).toEqual({
      kind: 'open_violation',
      ref: 'RC-201',
      stageId: null,
    });
    // Still produced. An engineer reasonably wants the sequence while resolving findings.
    expect(result.stages.length).toBeGreaterThan(0);
  });

  it('blocks on an uncalibrated plan drawing', () => {
    // Every routed length would be a number of pixels wearing a millimetre label.
    const result = planInstallation(
      dialysisSequenceSet,
      fixtureInput({ planStatus: 'uncalibrated' }),
    );
    expect(
      result.blockers.some(
        (entry) => entry.kind === 'uncalibrated_level' && entry.ref === 'level_1',
      ),
    ).toBe(true);
  });

  it('raises a risk for a machine with no route', () => {
    const full = fixtureInput();
    const input = fixtureInput({
      routedLengths: full.routedLengths.filter((entry) => entry.placementId !== 'station_3'),
    });
    const risks = planInstallation(dialysisSequenceSet, input).risks;
    expect(risks.some((risk) => risk.origin === 'unroutable' && risk.ref.includes('station_3'))).toBe(
      true,
    );
  });

  it('carries the sequence file’s own risks onto their stage', () => {
    const result = plan();
    const prep = result.stages.find((stage) => stage.id === 'site_preparation');
    expect(prep?.risks.map((risk) => risk.id)).toContain('site_preparation:floor_finish_unknown');
  });

  it('does not restate a finding’s prose', () => {
    /*
     * The rule engine composes a finding bilingually from its reason code. Repeating the sentence
     * here would give an engineer two wordings of one finding, and the one in the plan would be the
     * one nobody maintains.
     */
    const input = fixtureInput({
      evaluation: fixtureEvaluation([
        { ruleId: 'clearance', reasonCode: 'RC-110', level: 'YELLOW', placementId: 'station_1' },
      ]),
    });
    const risk = planInstallation(dialysisSequenceSet, input).risks.find(
      (entry) => entry.ref === 'RC-110',
    );
    expect(risk?.detail.value).toBeNull();
    expect(risk?.detail.source.ref).toBe('finding:RC-110');
  });
});

describe('§ 6 and § 7 — the planner boundary', () => {
  it('declares itself offline in a way an implementation cannot lie about', () => {
    /*
     * `requiresNetwork` is the literal type `false` on `AiPlanner`. An implementation that needed a
     * network could not set it to `true` and still satisfy the interface, so § 6 is held by the
     * compiler. The runtime assertion is a reminder of which property that is.
     */
    const planner = deterministicPlanner(dialysisSequenceSet);
    expect(planner.requiresNetwork).toBe(false);
    expect(planner.id).toBe('deterministic:dialysis_installation');
    expect(planner.sequenceSet).toEqual({ id: 'dialysis_installation', version: '0.1.0' });
  });

  it('produces the same plan through the interface as through the function', () => {
    const planner = deterministicPlanner(dialysisSequenceSet);
    expect(JSON.stringify(planner.plan(fixtureInput()))).toBe(JSON.stringify(plan()));
  });
});

describe('the shipped sequence set', () => {
  it('loads and validates, so a bad file stops the application starting', () => {
    expect(dialysisSequenceSet.id).toBe('dialysis_installation');
    expect(dialysisSequenceSet.stages.length).toBeGreaterThan(0);
  });

  it('supplies no installation rate, and says so where a reader will look', () => {
    // If this ever fails, somebody has supplied a rate — and B-7 requires it to carry a source,
    // which the schema enforces, so this failing means the feature became live rather than broken.
    expect(dialysisSequenceSet.installationRates).toEqual([]);
    expect(JSON.stringify(dialysisSequenceSet.rateAuthority)).toContain('Unknown');
    expect(JSON.stringify(dialysisSequenceSet.rateAuthority)).toContain('B-7');
  });

  it('turns on from a data edit alone, with no code change', () => {
    /*
     * Owner decision B-7: *"Future updates should require only editing
     * `standards/sequences/dialysis.json`. No code changes."*
     *
     * That promise is testable, and this is the test of it: take the **shipped** set, add rates the
     * way an editor of that file would, and the whole feature comes on — calculated durations with
     * their formula and citation, a crew range, and `ratesAvailable` flipping the report from the
     * B-7 sentence to figures. Nothing in `src/` names a stage, an hour or a person.
     */
    const withRates = sequenceSetSchema.parse({
      ...dialysisSequenceSet,
      installationRates: dialysisSequenceSet.stages.map((stage) => ({
        id: `rate_${stage.id}`,
        stage: stage.id,
        hoursFixed: 2,
        hoursPerStation: 1.5,
        minimumPersons: 2,
        recommendedPersons: 3,
        source: 'KS B 0000:2026 § 7.3',
      })),
    });

    const result = planInstallation(withRates, fixtureInput());

    expect(result.ratesAvailable).toBe(true);
    // Six applicable stages at 2 + 1.5 × 3 = 6.5 hours each.
    expect(result.stages.every((stage) => stage.duration.value === 6.5)).toBe(true);
    expect(result.duration.value).toBe(6.5 * result.stages.length);
    expect(result.manpower.minimum).toBe(2);
    expect(result.manpower.recommended).toBe(3);
    expect(result.duration.calculation?.citation).toContain('KS B 0000:2026');
  });

  it('marks exactly one stage as carrying the service connections', () => {
    const carriers = dialysisSequenceSet.stages.filter((stage) => stage.carriesServiceMaterials);
    expect(carriers).toHaveLength(1);
  });

  it('applies every stage of an empty project that has no equipment', () => {
    // A sanity check on `resolveStages` rather than on the plan: exactly the always-on stages.
    const { included } = resolveStages(
      dialysisSequenceSet,
      fixtureInput({ placements: [], referencePoints: [] }),
    );
    expect(included.map((stage) => stage.id)).toEqual([
      'site_preparation',
      'services_rough_in',
      'handover',
    ]);
  });
});

describe('Hardening 1 — the plan carries its own fingerprint', () => {
  it('records all four dependencies plus when it was made', () => {
    const result = planInstallation(
      dialysisSequenceSet,
      fixtureInput({ documentRevision: 'doc:7', generatedAt: '2026-03-01T00:00:00.000Z' }),
    );

    expect(result.provenance.fingerprint.documentRevision).toBe('doc:7');
    expect(result.provenance.fingerprint.layoutRevision).toBeTruthy();
    expect(result.provenance.fingerprint.equipmentLibraryRevision).toBeTruthy();
    expect(result.provenance.fingerprint.ruleSetRevision).toBe('dialysis@0.1.0');
    expect(result.provenance.generatedAt).toBe('2026-03-01T00:00:00.000Z');
  });

  it('passes `document.revision` straight through without interpreting it', () => {
    // This package has no opinion about what a document revision is — it is the caller's string,
    // carried the same way `evaluation.ruleSet` is.
    const result = planInstallation(dialysisSequenceSet, fixtureInput({ documentRevision: 'x' }));
    expect(result.provenance.fingerprint.documentRevision).toBe('x');
  });

  it('changes the layout revision when the layout the plan was built from changes', () => {
    const first = planInstallation(dialysisSequenceSet, fixtureInput());
    const moved = planInstallation(
      dialysisSequenceSet,
      fixtureInput({
        placements: fixtureInput().placements.map((placement, index) =>
          index === 0
            ? { ...placement, position: { x: placement.position.x + 500, y: placement.position.y } }
            : placement,
        ),
      }),
    );

    expect(moved.provenance.fingerprint.layoutRevision).not.toBe(
      first.provenance.fingerprint.layoutRevision,
    );
    // And everything else about the two calls was identical, so nothing else should have moved.
    expect(moved.provenance.fingerprint.documentRevision).toBe(
      first.provenance.fingerprint.documentRevision,
    );
    expect(moved.provenance.fingerprint.ruleSetRevision).toBe(
      first.provenance.fingerprint.ruleSetRevision,
    );
  });

  it('changes the rule set revision when the rule set version changes', () => {
    const first = planInstallation(dialysisSequenceSet, fixtureInput());
    const revised = planInstallation(
      dialysisSequenceSet,
      fixtureInput({
        evaluation: { ...fixtureInput().evaluation, ruleSet: { id: 'dialysis', version: '0.2.0' } },
      }),
    );

    expect(revised.provenance.fingerprint.ruleSetRevision).not.toBe(
      first.provenance.fingerprint.ruleSetRevision,
    );
  });

  it('carries the library revision it was given, rather than deriving one from the subset', () => {
    /*
     * The distinction a browser test caught. `input.equipment` holds only the records **in use**, so
     * deriving from it fingerprints the subset a plan happens to touch — and a catalogue that gained
     * a machine would leave every plan reading as current while `projectFingerprint`, which sees the
     * whole library, said otherwise. Every fresh plan was marked outdated the instant it was made.
     */
    const first = planInstallation(dialysisSequenceSet, fixtureInput());
    const upgraded = planInstallation(
      dialysisSequenceSet,
      fixtureInput({ equipmentLibraryRevision: 'lib:2' }),
    );

    expect(first.provenance.fingerprint.equipmentLibraryRevision).toBe('lib:1');
    expect(upgraded.provenance.fingerprint.equipmentLibraryRevision).toBe('lib:2');

    // And it does *not* move when only the in-use subset changes, because that is not the library.
    const fewerRecords = planInstallation(
      dialysisSequenceSet,
      fixtureInput({ equipment: [fixtureEquipment({ version: '9.9.9' })] }),
    );
    expect(fewerRecords.provenance.fingerprint.equipmentLibraryRevision).toBe('lib:1');
  });

  it('reports no staleness against itself, and exactly the moved dependency against an edit', () => {
    const original = planInstallation(dialysisSequenceSet, fixtureInput());
    expect(planStaleness(original.provenance.fingerprint, original.provenance.fingerprint)).toEqual(
      [],
    );

    const editedLayout = planInstallation(
      dialysisSequenceSet,
      fixtureInput({
        placements: [
          ...fixtureInput().placements,
          {
            placementId: 'station_4',
            equipmentObjectId: 'vantive_ak98',
            position: { x: 5_000, y: 1_000 },
            rotation: 0,
            spaceId: 'space_1',
          },
        ],
      }),
    );
    expect(
      planStaleness(original.provenance.fingerprint, editedLayout.provenance.fingerprint),
    ).toEqual(['layout']);
  });
});
