import type { Level, Placement } from '@mfd/document-model';
import type { EvaluationReport, EvaluationResult, RuleSet } from '@mfd/rule-engine';

import type { LabelKey } from './labels';
import type { FindingRow, ValidationSection } from './model';

/**
 * Section 5 — the validation report.
 *
 * Every row carries what the owner asked for: severity, rule id, rule name in both
 * languages, the finding in both languages, the applied threshold, where that threshold
 * came from, and the verification status.
 *
 * ## The finding is not stored as text
 *
 * A row carries `reasonCode` and `reasonParams`, and each renderer composes the sentence in
 * each language. That is what makes the section bilingual rather than translated: there is
 * no English original for a Korean version to fall behind.
 *
 * ## Threshold source is the column that matters
 *
 * A TS engineer asked "why 1,200 mm?" in front of a customer has to be able to answer from
 * this table. So the row states both *which kind* of source supplied the figure — the rule,
 * the equipment record, or neither — and the clause itself. When there is no document, the
 * cell says so rather than being blank: an empty cell reads as an oversight, and "no source
 * document" is a finding about the finding.
 *
 * ## Ordering
 *
 * Worst first, as the engine already orders results. A reader who stops after one page has
 * seen the problems.
 */

const THRESHOLD_ORIGIN_LABELS: Readonly<Record<string, LabelKey>> = {
  rule: 'origin_rule',
  equipment: 'origin_equipment',
  none: 'origin_none',
};

/** The clause behind a threshold, or null when the rule cites nothing. */
function thresholdSource(result: EvaluationResult): string | null {
  const { document, revision, section } = result.source;
  if (!document) return null;
  return [document, revision, section].filter(Boolean).join(' · ');
}

export interface ValidationInputs {
  readonly level: Level;
  readonly report: EvaluationReport;
  readonly ruleSet: RuleSet;
  /** Placement numbers from the floor plan, so a finding points at the drawing. */
  readonly numbers: Map<string, number>;
}

export function buildValidation({
  level,
  report,
  ruleSet,
  numbers,
}: ValidationInputs): ValidationSection {
  const labels = new Map<string, string>(
    level.placements.map((placement: Placement) => [placement.id, placement.label]),
  );

  const findings: FindingRow[] = report.results.map((result) => {
    const rule = ruleSet.get(result.ruleId);

    return {
      severity: result.level,
      ruleId: result.ruleId,
      // From the rule file. A report holding its own copy of rule names would let the two
      // drift, inside a signed document — so an unknown rule shows its id in both
      // languages rather than a name this package invented.
      ruleName: rule?.name ?? { ko: result.ruleId, en: result.ruleId },
      reasonCode: result.reasonCode,
      reasonParams: result.reasonParams,
      caveatCode: result.caveatCode,
      appliedThreshold: result.appliedValue,
      unit: result.unit,
      thresholdOrigin: THRESHOLD_ORIGIN_LABELS[result.thresholdOrigin] ?? 'origin_none',
      thresholdSource: thresholdSource(result),
      measured: result.measured,
      verification: result.dataStatus,
      placementNumbers: result.placementIds.flatMap((id) => {
        const number = numbers.get(id);
        return number === undefined ? [] : [number];
      }),
      placementLabels: result.placementIds.map((id) => labels.get(id) ?? id),
    };
  });

  return {
    levelId: level.id,
    levelName: level.name,
    ruleSetId: report.ruleSetId,
    ruleSetVersion: report.ruleSetVersion,
    findings,
    counts: report.counts,
  };
}
