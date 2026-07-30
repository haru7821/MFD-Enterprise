import type { EvaluationReport, EvaluationResult } from '@mfd/rule-engine';
import { reasonKind } from '@mfd/rule-engine';

import type { ExecutiveSummarySection, SummaryGround, Verdict } from './model';

/**
 * Section 2 — the executive summary, and the verdict.
 *
 * The one piece of judgement in this package, which is why it is its own file.
 *
 * ## Four verdicts, and why `inconclusive` is not `review_required`
 *
 * | Verdict | When |
 * | --- | --- |
 * | `not_acceptable` | Any RED |
 * | `review_required` | No RED, and at least one YELLOW came from a real comparison |
 * | `acceptable` | Every finding GREEN |
 * | `inconclusive` | **Every** YELLOW is "no threshold" or "not calibrated", or nothing was checked |
 *
 * "Review required" implies the assessment ran and raised questions. What actually happens
 * with today's data is that it could not run: the manual has not arrived, so there is
 * nothing true to compare against. Folding that into `review_required` would let a report
 * describing a page of "requirement unknown" read as a review that found some concerns —
 * and a TS engineer could sign it.
 *
 * With the shipped rule set and catalogue, **`inconclusive` is the honest output**, and
 * `conclusion.test.ts` asserts that no arrangement of draft data can produce `acceptable`.
 *
 * ## Grounds
 *
 * The verdict is always accompanied by the counts behind it, as label keys rather than
 * sentences. A verdict a reader cannot account for is one they will either over-trust or
 * ignore, and "inconclusive" in particular has to say *what* was missing.
 */

/**
 * Whether a YELLOW finding represents an actual concern about the layout.
 *
 * The distinction the verdict turns on, and it is not a hand-kept list: `reasonKind` comes
 * from the rule engine's catalogue, so a code added next sprint is classified where it is
 * defined rather than being silently misfiled here.
 *
 * A YELLOW is *not* a concern when it is:
 *
 * - **unevaluable** — no threshold, nothing drawn, no evaluator. Nothing was compared.
 * - **a pass downgraded for provenance** — the comparison ran and succeeded, and the figure
 *   behind it is not cited. The drawing is not the problem; the data is.
 *
 * It *is* a concern when a YELLOW-severity rule was actually violated. Reporting a page of
 * uncited passes as "review required" would tell a reader the layout has issues to review,
 * which is a different and wrong statement.
 */
function isConcern(result: EvaluationResult): boolean {
  return reasonKind(result.reasonCode) === 'violation';
}

export interface ConclusionInputs {
  readonly reports: readonly EvaluationReport[];
  readonly totalEquipment: number;
  readonly uncalibratedLevels: number;
  readonly draftFieldGroups: number;
}

export interface Conclusion {
  readonly verdict: Verdict;
  readonly grounds: readonly SummaryGround[];
}

export function decideVerdict({ reports, totalEquipment }: ConclusionInputs): Verdict {
  const results = reports.flatMap((report) => [...report.results]);

  // Nothing placed is not a pass. A report on an empty drawing has established nothing,
  // and `acceptable` on it would be the most misleading output this engine could produce.
  if (totalEquipment === 0 || results.length === 0) return 'inconclusive';

  if (results.some((result) => result.level === 'RED')) return 'not_acceptable';

  const yellows = results.filter((result) => result.level === 'YELLOW');
  if (yellows.length === 0) return 'acceptable';

  // No YELLOW is an actual concern about the layout: every one is either "nothing was
  // compared" or "the comparison passed against a figure nobody has cited". That is not a
  // review with concerns; it is a review that could not be completed.
  //
  // This is the verdict the shipped data produces today, and it is the honest one:
  // uncalibrated levels and uncited rules, not a drawing with problems.
  if (!yellows.some(isConcern)) return 'inconclusive';

  return 'review_required';
}

export function buildSummary(inputs: ConclusionInputs): ExecutiveSummarySection {
  const results = inputs.reports.flatMap((report) => [...report.results]);

  const counts = { GREEN: 0, YELLOW: 0, RED: 0 };
  for (const result of results) counts[result.level] += 1;

  const missingThreshold = results.filter(
    (result) => reasonKind(result.reasonCode) === 'unevaluable',
  ).length;

  const grounds: SummaryGround[] = [];
  if (counts.RED > 0) grounds.push({ label: 'ground_red_findings', count: counts.RED });
  if (counts.YELLOW > 0)
    grounds.push({ label: 'ground_yellow_findings', count: counts.YELLOW });
  if (missingThreshold > 0)
    grounds.push({ label: 'ground_missing_threshold', count: missingThreshold });
  if (inputs.uncalibratedLevels > 0)
    grounds.push({ label: 'ground_uncalibrated_levels', count: inputs.uncalibratedLevels });
  if (inputs.draftFieldGroups > 0)
    grounds.push({ label: 'ground_draft_groups', count: inputs.draftFieldGroups });
  if (inputs.totalEquipment === 0) grounds.push({ label: 'ground_no_equipment', count: 0 });

  return {
    totalEquipment: inputs.totalEquipment,
    green: counts.GREEN,
    yellow: counts.YELLOW,
    red: counts.RED,
    verdict: decideVerdict(inputs),
    grounds,
    hasDraftInputs: inputs.reports.some((report) => report.hasDraftInputs),
  };
}
