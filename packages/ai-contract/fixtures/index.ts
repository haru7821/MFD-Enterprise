import type { AiRequestContext } from '../src/context';
import type {
  AiAnswer,
  AiExplanation,
  ConnectionPlan,
  InstallationPlan,
  InstallationStage,
  PlanService,
  RetrievedPassage,
} from '../src/responses';
import { PLAN_SERVICES } from '../src/responses';
import { unknownNumber, unknownRange } from '../src/evidence';
import { AI_CONTRACT_VERSION } from '../src/context';
import type { CitationScope } from '../src/validate';
import type { CriterionConfig, ScoreBreakdown, ScoringCriterion, ScoringModel } from '../src/scoring';
import { SCORING_CRITERIA } from '../src/scoring';

/**
 * Fixtures for the contract's tests.
 *
 * Deliberately **valid** by default, with helpers that break one thing at a time. A test that
 * constructs its own near-valid payload tends to assert on the wrong failure; starting from
 * something that passes and spoiling exactly one field makes each test say what it means.
 */

export const fixtureContext: AiRequestContext = {
  projectId: 'project_1',
  levelId: 'level_3f',
  documentVersion: 4,
  evaluationResultVersion: 2,
  aiContractVersion: AI_CONTRACT_VERSION,
  ruleSetRef: { id: 'dialysis', version: '0.1.0' },
  language: 'both',
};

/** The weights the owner approved in B-5a, as the solver will load them. */
const APPROVED_WEIGHTS: Readonly<Record<ScoringCriterion, CriterionConfig>> = {
  compliance_margin: {
    weight: 0.4,
    direction: 'maximise',
    reference: { marginRatioTarget: 1.5 },
  },
  installation_feasibility: {
    weight: 0.2,
    direction: 'maximise',
    reference: { fractionTarget: 1 },
  },
  maintenance_access: {
    weight: 0.15,
    direction: 'maximise',
    reference: { fractionTarget: 1 },
  },
  ro_piping_length: { weight: 0.1, direction: 'minimise', reference: { perStation: 8000 } },
  electrical_routing: { weight: 0.05, direction: 'minimise', reference: { perStation: 10000 } },
  future_expansion: { weight: 0.05, direction: 'maximise', reference: { additionalStations: 4 } },
  walking_distance: { weight: 0.05, direction: 'minimise', reference: { perStation: 12000 } },
  drain_routing: {
    weight: 0,
    direction: 'minimise',
    reference: { perStation: 6000 },
    measuredOnly: true,
  },
};

export const fixtureScoringModel: ScoringModel = {
  id: 'dialysis_default',
  version: '1.0.0',
  criteria: APPROVED_WEIGHTS,
};

/**
 * A complete breakdown: every criterion measured, arithmetic consistent, coverage 1.
 *
 * Contributions are `normalised × weight` — with every criterion available, Σ available weights is
 * 1.00, so the renormalisation divisor is 1 and the numbers can be read directly.
 */
export function fixtureScoreBreakdown(): ScoreBreakdown {
  const criteria = SCORING_CRITERIA.map((criterion) => {
    const config = APPROVED_WEIGHTS[criterion];
    const normalised = 0.5;
    const weight = config.measuredOnly === true ? 0 : config.weight;
    return {
      criterion,
      measured: 0.5,
      unit: 'fraction',
      normalised,
      weight: config.weight,
      contribution: round(normalised * weight),
      measuredOnly: config.measuredOnly === true,
    };
  });

  return {
    scoringModel: { id: fixtureScoringModel.id, version: fixtureScoringModel.version },
    total: round(criteria.reduce((sum, c) => sum + c.contribution, 0)),
    coverage: 1,
    criteria,
    unavailable: [],
    constraints: [{ constraint: 'station_count', measured: 10, unit: 'count', target: 10 }],
  };
}

function round(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}

export const fixturePassage: RetrievedPassage = {
  id: 'P1',
  corpus: 'manufacturer_manual',
  text: 'A minimum clearance of 1200 mm shall be maintained at the front of the machine.',
  source: {
    document: 'AK 98 Operator Manual',
    revision: 'Rev 04',
    section: '15 Technical data',
    page: 153,
  },
  relevance: 0.91,
};

export const fixtureCitationScope: CitationScope = {
  ruleIds: ['ak98_front_clearance'],
  reasonCodes: ['RC-101'],
  catalogueFields: ['vantive_ak98.serviceClearance'],
  documents: [],
};

/**
 * A valid explanation.
 *
 * The spans matter: both texts state a figure, and each is covered by a citation whose span
 * encloses it. Getting that right in the fixture is what lets the uncited-number tests be about the
 * check rather than about arithmetic on offsets.
 */
export function fixtureExplanation(): AiExplanation {
  const ko = '요구 정비 공간은 1200 mm입니다. [P1]';
  const en = 'The required service clearance is 1200 mm. [P1]';
  return {
    subject: 'ak98_front_clearance',
    text: { ko, en },
    citations: [
      { kind: 'passage', ref: 'P1', span: spanOf(en, '1200') },
      { kind: 'passage', ref: 'P1', span: spanOf(ko, '1200') },
      { kind: 'rule', ref: 'ak98_front_clearance', span: null },
    ],
    retrieved: [fixturePassage],
  };
}

export function fixtureAnswer(): AiAnswer {
  return {
    text: {
      ko: '해당 내용은 색인된 문서에서 확인되었습니다.',
      en: 'That is covered by the indexed documentation.',
    },
    citations: [{ kind: 'passage', ref: 'P1', span: null }],
    insufficientGrounding: false,
    retrieved: [fixturePassage],
  };
}

function spanOf(text: string, needle: string): { start: number; end: number } {
  const start = text.indexOf(needle);
  if (start < 0) throw new Error(`fixture error: "${needle}" not present in "${text}"`);
  return { start, end: start + needle.length };
}

/**
 * A three-stage plan, printed in an order its dependencies allow.
 *
 * Every sourced figure is `unknown`, which is not laziness — it is what the shipped standards data
 * actually produces. No labour rate has been supplied for dialysis, so a fixture with a duration in
 * it would be testing against a world that does not exist yet.
 */
export function fixturePlan(): InstallationPlan {
  const stages: InstallationStage[] = [
    {
      ...blankStage('services_rough_in', 1, { ko: '설비 배관 선행', en: 'Services Rough-In' }),
      checklistItemIds: ['loop_pressure'],
    },
    {
      ...blankStage('equipment_set', 2, { ko: '장비 반입 및 설치', en: 'Equipment Set' }),
      dependsOn: ['services_rough_in'],
      placementIds: ['placement_1'],
      checklistItemIds: ['outlet_position'],
    },
    {
      ...blankStage('commissioning', 3, { ko: '시운전', en: 'Commissioning' }),
      dependsOn: ['equipment_set'],
      placementIds: ['placement_1'],
      checklistItemIds: ['earthing'],
    },
  ];

  return {
    sequenceSet: { id: 'dialysis_installation', version: '0.1.0' },
    stages,
    blockers: [],
    connections: PLAN_SERVICES.map(blankConnection),
    materials: [],
    risks: [],
    manpower: unknownRange('person', 'installation_rate:none'),
    duration: unknownNumber('hour', 'installation_rate:none'),
    ratesAvailable: false,
    provenance: {
      levelId: 'level_3f',
      placementCount: 1,
      ruleSet: { id: 'dialysis', version: '0.1.0' },
      evaluationVersion: 2,
      findingCounts: { red: 0, yellow: 4, green: 0 },
      optimisation: null,
    },
  };
}

function blankStage(
  id: string,
  order: number,
  title: { readonly ko: string; readonly en: string },
): InstallationStage {
  return {
    id,
    order,
    title,
    dependsOn: [],
    placementIds: [],
    checklistItemIds: [],
    tools: [],
    materials: [],
    risks: [],
    manpower: unknownRange('person', `installation_rate:${id}`),
    duration: unknownNumber('hour', `installation_rate:${id}`),
  };
}

function blankConnection(service: PlanService): ConnectionPlan {
  return {
    service,
    originPointId: null,
    runs: [],
    totalLength: unknownNumber('mm', `reference_point:${service}`),
  };
}
