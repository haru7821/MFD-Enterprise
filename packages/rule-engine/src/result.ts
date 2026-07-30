import type { DataStatus } from '@mfd/object-library';

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
 */
export const EVALUATION_RESULT_VERSION = 1;

export interface EvaluationResult {
  readonly ruleId: string;
  readonly category: RuleCategory;
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
  /** Plain sentence a TS engineer can read without opening the rule file. */
  readonly reason: string;
  readonly source: RuleSource;
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
