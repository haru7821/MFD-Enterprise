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
  'compliance_margin',
  'installation_feasibility',
  'maintenance_access',
  'ro_piping_length',
  'electrical_routing',
  'future_expansion',
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
  /** 0…1, the weighted sum over criteria that could be measured. */
  readonly total: number;
  /**
   * The fraction of the model's total weight that `total` was computed over. 1.0 when complete.
   *
   * Carried because a renormalised total and a complete one both read 0…1 and mean different
   * things. With the B-5a weights, a level with no reference points scores over 0.60 of the model,
   * and a reader shown only the number cannot tell which they have.
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
