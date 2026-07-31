import type {
  PlanEquipment,
  PlanFinding,
  PlanInput,
  ReferencePointSummary,
} from '@mfd/ai-contract';

import checklist from '../../../standards/checklists/dialysis.json';
import { type SequenceSet, sequenceSetSchema } from '../src/sequenceSet';

/**
 * Fixtures for the planner's tests.
 *
 * Deliberately **complete** by default — every reference point placed, every machine routed — with
 * overrides that take one thing away at a time. Most of what this package does is decide what to
 * say when something is missing, and starting from a project where nothing is missing is what makes
 * each test say which absence it is about.
 */

/**
 * The **shipped** checklist ids, read from the standards file rather than typed out here.
 *
 * The difference matters for one test in particular. "Every checklist item is allocated to a stage"
 * asserted against a hand-written list would only say that the plan covers a list in this file —
 * and the two would drift the first time somebody added a commissioning item, silently, in the
 * direction of an item nobody is scheduled to do. Read from the real file, it says what it means.
 */
export const FIXTURE_CHECKLIST_IDS: readonly string[] = checklist.categories.flatMap(
  (category) => category.items.map((item) => item.id),
);

export function fixtureEquipment(overrides: Partial<PlanEquipment> = {}): PlanEquipment {
  return {
    id: 'vantive_ak98',
    version: '0.1.0',
    model: 'AK98',
    dataStatus: 'draft',
    connections: [
      { service: 'power', required: true, specified: false, status: 'draft' },
      { service: 'ro_water', required: true, specified: false, status: 'draft' },
      { service: 'drain', required: true, specified: false, status: 'draft' },
    ],
    ...overrides,
  };
}

export const FIXTURE_POINTS: ReferencePointSummary[] = [
  { id: 'point_ro', kind: 'ro_supply', position: { x: 0, y: 0 } },
  { id: 'point_panel', kind: 'electrical_panel', position: { x: 8_000, y: 0 } },
  { id: 'point_drain', kind: 'drain', position: { x: 0, y: 6_000 } },
];

/**
 * A three-station project with every service marked and every run measured.
 *
 * The routed lengths are round numbers rather than anything the solver produced: this package does
 * not compute them, it reports them, and a fixture that ran the router would be testing the router.
 */
export function fixtureInput(overrides: Partial<PlanInput> = {}): PlanInput {
  const placements = ['station_1', 'station_2', 'station_3'].map((id, index) => ({
    placementId: id,
    equipmentObjectId: 'vantive_ak98',
    position: { x: 1_000 + index * 1_000, y: 1_000 },
    rotation: 0,
    spaceId: 'space_1',
  }));

  const routedLengths = placements.flatMap((placement, index) =>
    (['power', 'ro_water', 'drain'] as const).map((service) => ({
      service,
      placementId: placement.placementId,
      originPointId: originFor(service),
      millimetres: 1_000 * (index + 1),
    })),
  );

  return {
    projectId: 'project_1',
    levelId: 'level_1',
    spaceId: 'space_1',
    placements,
    equipment: [fixtureEquipment()],
    referencePoints: FIXTURE_POINTS,
    evaluation: fixtureEvaluation(),
    optimisation: null,
    routedLengths,
    checklistItemIds: FIXTURE_CHECKLIST_IDS,
    planStatus: 'none',
    ...overrides,
  };
}

export function fixtureEvaluation(findings: readonly PlanFinding[] = []): PlanInput['evaluation'] {
  return {
    version: 2,
    ruleSet: { id: 'dialysis', version: '0.1.0' },
    red: findings.filter((entry) => entry.level === 'RED').length,
    yellow: findings.filter((entry) => entry.level === 'YELLOW').length,
    green: findings.filter((entry) => entry.level === 'GREEN').length,
    openFindings: findings,
  };
}

/**
 * A minimal two-stage sequence set, for tests about ordering rather than about dialysis.
 *
 * Parsed through the real schema, so a fixture cannot be shaped in a way the shipped loader would
 * reject — which would let a test pass against data the application could never load.
 */
export function fixtureSequenceSet(stages: readonly unknown[]): SequenceSet {
  /*
   * Exactly one stage has to carry the service materials, and a test about ordering should not have
   * to say so. The first stage takes the job unless a test has already given it to somebody —
   * satisfying the invariant rather than working around it, so a fixture cannot be shaped in a way
   * the shipped loader would reject.
   */
  const anyCarrier = stages.some(
    (stage) => (stage as { carriesServiceMaterials?: boolean }).carriesServiceMaterials === true,
  );
  const withCarrier = anyCarrier
    ? stages
    : stages.map((stage, index) =>
        index === 0 ? { ...(stage as object), carriesServiceMaterials: true } : stage,
      );

  return sequenceSetSchema.parse({
    id: 'test_sequence',
    version: '1.0.0',
    title: { ko: '시험용', en: 'Test Sequence' },
    checklistSet: { id: 'dialysis_installation', version: '0.1.0' },
    authority: { note: 'fixture' },
    rateAuthority: { note: 'fixture' },
    stages: withCarrier,
  });
}

/** A stage with everything defaulted, so a test states only what it is about. */
export function fixtureStage(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    title: { ko: '단계', en: 'Stage' },
    dependsOn: [],
    appliesWhen: { kind: 'always' },
    checklistItemIds: [],
    tools: [],
    materials: [],
    risks: [],
    manpower: { persons: null },
    rate: { hoursFixed: null, hoursPerStation: null },
    carriesServiceMaterials: false,
    ...overrides,
  };
}

function originFor(service: 'power' | 'ro_water' | 'drain'): string {
  if (service === 'power') return 'point_panel';
  if (service === 'ro_water') return 'point_ro';
  return 'point_drain';
}
