import type { DataStatus } from '@mfd/object-library';

import { type ReasonCode, type ReasonParams, renderReason } from './messages';
import type { RuleCategory, RuleSource, RuleStatus, ResultLevel } from './schema';
import type { ThresholdOrigin } from './threshold';

/**
 * Evaluation results.
 *
 * Per docs/rules/DIALYSIS_RULE_ENGINE_v0.1.md:
 *
 *   GREEN  — OK
 *   YELLOW — Review Required
 *   RED    — Not Acceptable
 *
 * A result is never stored in the project document. It is derived from the
 * placements, the catalogue and the rule set, and it goes stale the moment any of
 * those change — see docs/data-model/PROJECT_MODEL.md. A stale verdict inside a
 * feasibility report is worse than no verdict.
 */

/**
 * Version of the evaluation result contract.
 *
 * **Frozen in Sprint 3.5.** From here the shape below is a published interface:
 * Sprint 5's report generator, server-side re-evaluation, and any stored
 * comparison between the two all read it.
 *
 * Adding, removing or renaming a field on {@link EvaluationResult} or
 * {@link EvaluationReport} means bumping this number, and `result.shape.test.ts`
 * fails until you do. That test exists because a documented freeze is a promise
 * nobody is holding — a locked shape is one the build holds for you.
 *
 * Version 1 — Sprint 3.5.
 * Version 2 — Sprint 5. `reasonCode` and `reasonParams` added, so a finding can be
 * composed in Korean or English rather than being an English sentence. The owner's
 * bilingual report decision cannot be satisfied any other way: a translated sentence
 * drifts behind its original, and substituting words into English word order does not
 * produce Korean. See ./messages.ts.
 * Version 3 — the audit round. `category`'s domain gained `equipment_data`, for a finding that is
 * not about a rule at all: owner decision D5's *"identify the unevaluable placement"*. Widening a
 * published enum is a shape change even though no field was added — a consumer switching on
 * `category` meets a value its build has never heard of, which is exactly what a version exists to
 * warn it about. Caught by review: the first attempt widened the domain and *relaxed*
 * `result.shape.test.ts` to accept it, which is the freeze being unlocked rather than honoured.
 */
export const EVALUATION_RESULT_VERSION = 3;

/**
 * The domain of {@link EvaluationResult.category}, as data.
 *
 * Exported so `result.shape.test.ts` can lock the published enum against *this* rather than against
 * a hand-typed list beside it. A test carrying its own copy of the domain is one that can be edited
 * into agreement with a change instead of failing on it.
 */
export const RESULT_CATEGORIES = ['clearance', 'collision', 'equipment_data'] as const;

/**
 * What a finding is *about*.
 *
 * The two rule categories, plus one thing that is not a rule at all.
 *
 * > Owner decision D5: *"If one placement cannot be evaluated, the level cannot receive a PASS.
 * > Report: Inconclusive and identify the unevaluable placement."*
 *
 * `equipment_data` is what that finding carries. It is deliberately **not** a `RuleCategory`: no
 * rule may declare it, because nothing about it is a requirement somebody wrote down. It says the
 * engine had no record to apply a requirement to, which is a fact about the project's data rather
 * than about the layout — and filing it under `clearance` or `collision` would put it in a
 * standards table beside clauses that have documents behind them.
 */
export type ResultCategory = RuleCategory | 'equipment_data';

export interface EvaluationResult {
  readonly ruleId: string;
  readonly category: ResultCategory;
  readonly level: ResultLevel;
  /** One placement for clearance, two for a collision. */
  readonly placementIds: readonly string[];
  /** The measured value, or null when there was nothing to measure against. */
  readonly measured: number | null;
  /** The threshold actually applied. */
  readonly appliedValue: number | null;
  readonly thresholdOrigin: ThresholdOrigin;
  readonly unit: 'mm';
  /** The weakest provenance among the inputs actually used. */
  readonly dataStatus: DataStatus;
  /**
   * What was found, independent of language. `RC-101` means the same thing to a Korean
   * report, an English report and a support conversation six months from now.
   */
  readonly reasonCode: ReasonCode;
  /** Values the sentence interpolates — flat and JSON-safe, because this is persisted. */
  readonly reasonParams: ReasonParams;
  /**
   * The English sentence, rendered from `reasonCode` **at construction** so the live
   * editor panel needs no message lookup.
   *
   * Derived, not authored: it is `renderReason('en', reasonCode, reasonParams)`, which is
   * why it cannot drift from the Korean. Anything that needs another language calls
   * `renderReason` rather than trying to translate this string.
   */
  readonly reason: string;
  /**
   * A qualification that applies **on top of** the finding, or null.
   *
   * The calibration gate is the case that forced this: an uncalibrated plan turns a pass
   * from GREEN to YELLOW, and the reader needs to know it was the plan and not the
   * geometry. Before reason codes that clause was concatenated onto the English sentence,
   * which cannot work bilingually — the qualification has to be a code of its own so each
   * language composes it.
   *
   * A caveat never replaces the finding. `RC-102` with `RC-911` reads "the clearance is
   * satisfied, and the drawing it was measured on has no scale" — two facts, both true.
   */
  readonly caveatCode: ReasonCode | null;
  readonly source: RuleSource;
}

/**
 * Build the language-carrying part of a finding from its code.
 *
 * Every evaluator goes through this, so no evaluator writes a sentence and the English
 * text is always the same function of the code. Spreading the result into a finding is
 * what keeps `reason`, `reasonCode` and `reasonParams` in agreement by construction
 * rather than by review.
 */
export function reasonOf(
  reasonCode: ReasonCode,
  reasonParams: ReasonParams = {},
): Pick<EvaluationResult, 'reasonCode' | 'reasonParams' | 'reason' | 'caveatCode'> {
  return {
    reasonCode,
    reasonParams,
    reason: renderReason('en', reasonCode, reasonParams),
    // No caveat by default. The calibration gate in ./evaluate.ts adds one.
    caveatCode: null,
  };
}

export interface EvaluationReport {
  readonly ruleSetId: string;
  readonly ruleSetVersion: string;
  readonly results: readonly EvaluationResult[];
  readonly counts: Readonly<Record<ResultLevel, number>>;
  /** True when any result rests on provisional data. */
  readonly hasDraftInputs: boolean;
}

/**
 * The weakest provenance among the inputs a finding actually used.
 *
 * ## Why "actually used" is load-bearing
 *
 * Equipment data is verified **per field group**, not per record. So a finding is
 * provisional only when a group *it read* is provisional — never because some unrelated
 * group of the same record is still unknown.
 *
 * Concretely: an overlap check reads footprints and no manufacturer figure at all, so an
 * unknown service clearance cannot make "these two machines overlap by 500 mm" a
 * provisional statement. It is a fact about two rectangles.
 *
 * Passing an empty list is therefore meaningful, not a degenerate case: it says the
 * finding used no manufacturer data, and its provenance is the rule's alone.
 */
export function weakestStatus(
  ruleStatus: RuleStatus,
  ...equipmentStatuses: readonly DataStatus[]
): DataStatus {
  if (ruleStatus === 'draft') return 'draft';
  return equipmentStatuses.some((status) => status === 'draft') ? 'draft' : 'verified';
}

export interface LevelInputs {
  /** Null when the rule could not be evaluated at all. */
  readonly violated: boolean | null;
  readonly severity: 'RED' | 'YELLOW';
  readonly dataStatus: DataStatus;
}

/**
 * Decide a result level.
 *
 * Three rules, in order:
 *
 * 1. **Nothing to compare against → YELLOW.** No fourth status is introduced; the
 *    specification defines three, and "Review Required" is exactly what an
 *    unknown threshold calls for.
 *
 * 2. **A violation reports at the rule's severity, whatever the provenance.**
 *    Downgrading a breach because the figure behind it is provisional would make
 *    poor data *hide* problems, which is the wrong direction to fail in. The
 *    result carries `dataStatus` so it reads as "breaches a provisional figure".
 *
 * 3. **A pass needs verified inputs to reach GREEN.** Otherwise YELLOW. This is
 *    architecture decision AD-6a: a placeholder must never be able to sign
 *    something off.
 */
export function decideLevel({ violated, severity, dataStatus }: LevelInputs): ResultLevel {
  if (violated === null) return 'YELLOW';
  if (violated) return severity;
  return dataStatus === 'verified' ? 'GREEN' : 'YELLOW';
}

export function summarise(
  results: readonly EvaluationResult[],
  ruleSetId: string,
  ruleSetVersion: string,
): EvaluationReport {
  const counts: Record<ResultLevel, number> = { GREEN: 0, YELLOW: 0, RED: 0 };
  for (const result of results) counts[result.level] += 1;

  return {
    ruleSetId,
    ruleSetVersion,
    results,
    counts,
    hasDraftInputs: results.some((result) => result.dataStatus === 'draft'),
  };
}
