import type { Bilingual } from '@mfd/rule-engine';

import type { RefWithVersion } from './context';

/**
 * The weighted engineering scoring model.
 *
 * Owner decisions B-5 (a weighted scoring engine, replacing station-count-only optimisation) and
 * B-5a (the weights, and three policies about them). The weights themselves are **not here** —
 * they are data in `standards/scoring/dialysis.json`, and this file is the shape they load into.
 *
 * ## Two things are deliberately kept out of the weighted sum
 *
 * Both for the same reason: **anything inside a weighted sum can be outvoted by the rest of it.**
 *
 * 1. **Hard compliance.** `compliance_margin` — headroom *above* a requirement — is scored. A
 *    *violation* is a filter applied before scoring, so no weight configuration can rank a
 *    non-compliant layout at all (AD-17). The owner's requirement is that rule compliance "may
 *    never be outweighed by optimization metrics", and its 40 % weight does not deliver that: 40 %
 *    is a minority of the model. The filter does.
 *
 * 2. **Station count.** See {@link SCORING_CONSTRAINTS}. This is the one part of B-5a that could
 *    not be implemented literally, and the reason is arithmetic rather than preference.
 *
 * See docs/architecture/AI_SYSTEM_ARCHITECTURE.md §§ C-4, C-4a.
 */

/**
 * The scored criteria.
 *
 * Seven carry weight under B-5a; `drain_routing` carries none. It was named in the owner's
 * criterion list and left out of the approved weight table, so it is **measured, normalised and
 * printed** at weight 0 — visible in every breakdown, and weightable by changing one number in a
 * data file. Dropping it would have discarded a named criterion; weighting it would have invented
 * a number the owner did not give.
 */
export const SCORING_CRITERIA = [
  /**
   * **Two roles, and only one of them is this.** A rule *violation* excludes a candidate at
   * Gate 2, before scoring. This criterion weights the *quality* of the margin among candidates
   * that already comply — headroom above a requirement — and its 40 % is never permission to
   * trade a violation against an optimisation score (owner clarification, Step 4).
   */
  'compliance_margin',
  'installation_feasibility',
  'maintenance_access',
  'ro_piping_length',
  'electrical_routing',
  'future_expansion',
  /** Walking Distance / Staff Workflow Efficiency. */
  'walking_distance',
  'drain_routing',
] as const;
export type ScoringCriterion = (typeof SCORING_CRITERIA)[number];

/**
 * Measured, printed, and **never traded against a criterion**.
 *
 * ## Why station count is a constraint and not a criterion with weight 0
 *
 * Every other criterion *improves as machines are removed*. One machine in a large room has the
 * most clearance margin, the best maintenance access, the shortest pipe run, the shortest staff
 * walk and the most expansion room. So a weight of 0 does not make station count neutral in a
 * model that maximises a total — it makes the emptiest room the winner:
 *
 * | Layout | total |
 * | --- | --- |
 * | 1 station | 1.00 |
 * | 12 stations | 0.65 |
 *
 * A solver told to "maximise total engineering score" would empty the room, which is the opposite
 * of the feature. So the engineer states a target, the solver satisfies it, and the weights rank
 * the arrangements that *meet* it — the same shape as the compliance filter, one level down.
 *
 * Kept in its own list rather than as a `weight: 0` criterion so that no weight edit can reach it.
 */
export const SCORING_CONSTRAINTS = ['station_count'] as const;
export type ScoringConstraint = (typeof SCORING_CONSTRAINTS)[number];

/**
 * What to call a criterion in front of an engineer.
 *
 * Beside the criterion list rather than in the web app, because a criterion is named in the panel,
 * in an `AR-` rationale and in the report, and three copies of "maintenance access" drift. A
 * `Record` over the union, so adding a criterion fails to compile until it has a name in both
 * languages.
 */
export const CRITERION_LABELS: Readonly<Record<ScoringCriterion, Bilingual>> = {
  compliance_margin: { ko: '규정 여유', en: 'compliance margin' },
  installation_feasibility: { ko: '설치 용이성', en: 'installation feasibility' },
  maintenance_access: { ko: '정비 접근성', en: 'maintenance access' },
  ro_piping_length: { ko: 'RO 배관 길이', en: 'RO piping' },
  electrical_routing: { ko: '전기 배선', en: 'electrical routing' },
  future_expansion: { ko: '증설 여유', en: 'future expansion' },
  walking_distance: { ko: '동선 효율', en: 'walking distance' },
  drain_routing: { ko: '배수 경로', en: 'drain routing' },
};

export const CRITERION_DIRECTIONS = ['maximise', 'minimise'] as const;
export type CriterionDirection = (typeof CRITERION_DIRECTIONS)[number];

export interface CriterionConfig {
  /** 0…1. The set need not sum to 1 — contributions are normalised by the available total. */
  readonly weight: number;
  readonly direction: CriterionDirection;
  /**
   * What counts as a full score, in the criterion's own unit.
   *
   * Without this the weights are meaningless: a weighted sum over a count and a length in
   * millimetres is not a quantity. Every criterion normalises to 0…1 against an explicit
   * reference, and the reference is configuration rather than a constant in a solver.
   *
   * **Still an open question (B-5b).** B-5a settled the weights; these are a developer's estimate
   * of what "bad" looks like, and a weighted sum is only as meaningful as its normalisation. A
   * reference set too generously scores near 1.0 for every layout and stops discriminating, which
   * makes its weight decorative whatever the table says.
   */
  readonly reference: Readonly<Record<string, number>>;
  /** True for a weight-0 criterion measured for information only — `drain_routing`. */
  readonly measuredOnly?: boolean;
}

export interface ScoringModel {
  readonly id: string;
  readonly version: string;
  readonly criteria: Readonly<Record<ScoringCriterion, CriterionConfig>>;
  /**
   * How much of the model must be measurable before a total is offered at all, 0…1.
   *
   * > Owner decision D1: *"If coverage is below the required threshold, suppress the total
   * > ranking. … Do not display a misleading '#1 score' when candidates have different evidence."*
   *
   * **Configuration, not code.** It sets what the product will and will not put a number on, which
   * makes it the owner's to tune — the same reason the weights live in `standards/scoring/` rather
   * than in the solver, and the same rule the project applies to every engineering threshold.
   *
   * Measured on the shipped data before this was chosen. Three criteria are unmeasurable on every
   * project today — `compliance_margin` (0.40, `SC-904`), `installation_feasibility` (0.20,
   * `SC-905`) and `maintenance_access` (0.15) — which is **0.75 of the model**. So an engineer who
   * places all five reference points reaches 0.25, and one who places none reaches 0.20. Any floor
   * above 0.25 suspends ranking entirely until the AK98 manual arrives and drawings are observed:
   * a decision about the feature, not a detail of the arithmetic, which is why it is configuration.
   */
  readonly minimumCoverage: number;
}

/**
 * One criterion's contribution to a total, with every step of the arithmetic shown.
 *
 * `measured`, `normalised`, `weight` and `contribution` are all present because a reader has to be
 * able to check the sum. A breakdown that showed only contributions would be as unarguable-with as
 * a bare total, one level down.
 */
export interface CriterionScore {
  readonly criterion: ScoringCriterion;
  /** In the criterion's own unit — 8,400 mm of pipe, 0.9 of machines reachable. */
  readonly measured: number;
  readonly unit: string;
  /** 0…1, after normalising `measured` against {@link CriterionConfig.reference}. */
  readonly normalised: number;
  readonly weight: number;
  /** `normalised × weight ÷ Σ available weights`. */
  readonly contribution: number;
  readonly measuredOnly: boolean;
}

/**
 * A criterion that could not be measured.
 *
 * Non-empty is normal rather than an error: four weighted criteria need a reference point the
 * document may not have, which is 40 % of the approved model.
 */
export interface UnavailableCriterion {
  readonly criterion: ScoringCriterion;
  /** Language-independent, so the panel and the report say the same thing. */
  readonly reasonCode: ScoreReasonCode;
}

export interface ConstraintMeasurement {
  readonly constraint: ScoringConstraint;
  readonly measured: number;
  readonly unit: string;
  /** The target it was solved against, or null for "as many as fit". */
  readonly target: number | null;
}

export interface ScoreBreakdown {
  readonly scoringModel: RefWithVersion;
  /**
   * 0…1, the weighted sum over the **whole** model — or **null** when too little was measurable.
   *
   * > Owner decision D1: *"Do NOT renormalize away unavailable criteria. If coverage is below the
   * > required threshold, suppress the total ranking. … Unknown must never become perfect."*
   *
   * Two things changed together, and both matter. The divisor is the model's total weight, so an
   * unmeasured criterion contributes nothing and a total can only be earned — it used to be the
   * *available* weight, which meant deleting evidence raised the score, up to a perfect 1.0000 at
   * coverage 0.20. And below `MINIMUM_COVERAGE` there is no total at all, because a number that
   * rests mostly on silence invites a comparison it cannot support.
   *
   * Null is not zero. Zero is a score; null is the engine saying it will not offer one. Every
   * consumer has to say so rather than print a dash — see `LayoutPanel`.
   */
  readonly total: number | null;
  /**
   * The fraction of the model's total weight that `total` was computed over. 1.0 when complete.
   *
   * Carried because two totals over different evidence both read 0…1 and mean different things.
   * With the B-5a weights, a level with no reference points scores over 0.60 of the model, and a
   * reader shown only the number cannot tell which they have. It is also what decides whether
   * `total` is offered at all.
   */
  readonly coverage: number;
  readonly criteria: readonly CriterionScore[];
  readonly unavailable: readonly UnavailableCriterion[];
  readonly constraints: readonly ConstraintMeasurement[];
}

/**
 * Why a criterion could not be measured.
 *
 * `SC-` rather than `RC-`: these are scoring codes, not rule findings, and a reader who sees
 * `RC-` should be able to assume the rule engine produced it.
 */
export const SCORE_REASON_CODES = {
  'SC-901': {
    title: { ko: '기준점 없음', en: 'No Reference Point' },
    template: {
      ko: '{kind} 기준점이 배치되지 않아 {criterion} 항목을 측정할 수 없습니다.',
      en: '{criterion} cannot be measured: no {kind} reference point has been placed.',
    },
  },
  'SC-902': {
    title: { ko: '측정 대상 없음', en: 'Nothing To Measure' },
    template: {
      ko: '이 층에 해당 장비가 없어 {criterion} 항목을 측정할 수 없습니다.',
      en: '{criterion} cannot be measured: this level holds no equipment of the relevant kind.',
    },
  },
  'SC-903': {
    title: { ko: '경로 없음', en: 'No Route' },
    template: {
      ko: '장애물을 피하는 경로를 찾을 수 없어 {criterion} 항목을 측정할 수 없습니다.',
      en: '{criterion} cannot be measured: no route avoiding the obstructions was found.',
    },
  },
  'SC-904': {
    title: { ko: '규정 기준 없음', en: 'No Requirement To Compare' },
    template: {
      ko: '적용 가능한 기준값이 없어 {criterion} 여유를 계산할 수 없습니다.',
      en: '{criterion} cannot be computed: no applicable threshold exists to measure headroom above.',
    },
  },
  /*
   * The code that replaced an invented constant.
   *
   * `installation_feasibility` used a 150 mm delivery allowance written into the solver — a
   * planning assumption with nothing behind it, whose own comment admitted it wanted a citation.
   * The owner's layout-knowledge decision says the optimiser must consume observed knowledge rather
   * than embed assumptions, so the allowance now comes from drawings or the criterion is not
   * measured. Until drawings are observed, this is what an engineer sees — which is the honest
   * report of what the dataset can currently support.
   */
  'SC-905': {
    title: { ko: '관측 자료 없음', en: 'No Observed Figure' },
    template: {
      ko: '{criterion} 항목에 필요한 값이 도면 관측 자료에 없어 측정할 수 없습니다.',
      en: '{criterion} cannot be measured: no figure for it has been observed in the drawing dataset.',
    },
  },
  /*
   * Something in the room has no catalogue entry, so its size is unknown.
   *
   * Every geometric criterion needs the footprint of everything it has to work around. Two helpers
   * used to answer this differently and silently — one substituted the *measured* object's
   * footprint, inventing a dimension for equipment nothing knows the size of; the other dropped the
   * placement, so it blocked nothing and the room measured emptier than it is. Both were reachable
   * once the scored population and the blocking population came apart.
   *
   * > Owner: *"Unknown must remain Unknown. Never interpolate. Never estimate. Never replace
   * > missing data with assumptions."*
   *
   * Neither substituting nor ignoring survives that sentence, so the criterion is not measured.
   */
  'SC-906': {
    title: { ko: '카탈로그에 없는 장비', en: 'Uncatalogued Equipment' },
    template: {
      ko: '도면의 장비 중 카탈로그에 없는 것이 있어 {criterion} 항목을 측정할 수 없습니다.',
      en: '{criterion} cannot be measured: the room holds equipment that is not in the catalogue, so its size is unknown.',
    },
  },
  /*
   * The ninth review round's finding, resolved by owner decision (option 1 of three presented):
   * report the face unavailable rather than measure it.
   *
   * `gapAlongNormal` takes a single global minimum across whatever survives its lateral clip, on
   * the assumption that the nearest projected point is the nearest connected material — true only
   * when the obstruction is convex. A non-convex obstruction (a riser or duct run wrapping around a
   * machine) can present a disconnected far arm inside the same clipped band as a genuine near arm,
   * and the function cannot tell them apart. Giving it that notion is a real geometry investment
   * (convex decomposition) the owner has not asked for, so until it exists, this code marks the
   * specific face `SC-904` would otherwise have silently reported a number for.
   */
  'SC-907': {
    title: { ko: '비볼록 장애물 형상', en: 'Non-Convex Obstruction Geometry' },
    template: {
      ko: '해당 면을 막고 있는 장애물이 비볼록 형상이어서 {criterion} 여유를 신뢰성 있게 측정할 수 없습니다.',
      en: '{criterion} cannot be measured for this face: the obstruction in front of it is not convex, and its true nearest distance cannot be trusted.',
    },
  },
} as const;
export type ScoreReasonCode = keyof typeof SCORE_REASON_CODES;

/**
 * Normalise a measurement to 0…1 against a reference.
 *
 * Two directions, and the `minimise` case is the one that matters:
 *
 * - `maximise`: `measured / reference`, clamped. Half the target scores 0.5.
 * - `minimise`: `1 - measured / reference`, clamped. **At or above the reference, 0.** A pipe run
 *   twice the reference is as bad as one exactly at it, which is deliberate — the alternative is a
 *   negative contribution that could drag a total below zero and make the scale meaningless.
 *
 * Callers must not pass a reference of zero: a full score of "zero millimetres of pipe" is not a
 * statement about anything, and dividing by it would produce Infinity rather than an error.
 */
export function normaliseCriterion(
  measured: number,
  reference: number,
  direction: CriterionDirection,
): number {
  if (!Number.isFinite(measured) || !Number.isFinite(reference)) {
    throw new Error(`normaliseCriterion: measured and reference must be finite`);
  }
  if (reference <= 0) {
    throw new Error(
      `normaliseCriterion: reference must be positive, received ${reference}. A criterion whose ` +
        `full score is zero cannot discriminate between two layouts.`,
    );
  }
  const ratio = measured / reference;
  const raw = direction === 'maximise' ? ratio : 1 - ratio;
  return clamp01(raw);
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * The weight actually in play for a criterion.
 *
 * A `measuredOnly` criterion contributes nothing whatever its weight says. Both are checked rather
 * than only the flag, so that a later data edit which sets a weight but leaves the flag behind
 * cannot silently grant `drain_routing` influence: the flag wins, and the schema asserts the
 * contribution is zero.
 */
export function effectiveWeight(config: CriterionConfig): number {
  return config.measuredOnly === true ? 0 : config.weight;
}
