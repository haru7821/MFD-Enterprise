import type { EvaluationReport, RuleSet } from '@mfd/rule-engine';

import type { StandardRow, StandardsSection } from './model';

/**
 * Section 8 — every applied standard.
 *
 * Owner instruction: *"List every applied standard."* Taken literally — **every rule in the
 * set**, not only the ones that produced a finding.
 *
 * That choice is the whole value of the section. A rule that fired on nothing is exactly
 * what a reviewer needs to see: it means either that nothing on this drawing was governed by
 * it, or that its `appliesTo` selects nothing and it has been silently passing. Listing only
 * the rules that produced findings would make those two indistinguishable, which is the same
 * failure the engine avoids by never letting a rule quietly produce zero results.
 *
 * So `findingCount` is a column, and a zero in it is information rather than an omission.
 *
 * Each row carries its citation — document, revision, section — because a threshold is true
 * *at a revision*. Six months on, "which manual said 1,200 mm?" has to be answerable from
 * the page.
 */

export function buildStandards(
  ruleSet: RuleSet,
  reports: readonly EvaluationReport[],
): StandardsSection {
  const findingCounts = new Map<string, number>();
  for (const report of reports) {
    for (const result of report.results) {
      findingCounts.set(result.ruleId, (findingCounts.get(result.ruleId) ?? 0) + 1);
    }
  }

  const rules: StandardRow[] = ruleSet.rules.map((rule) => ({
    ruleId: rule.ruleId,
    ruleName: rule.name,
    category: rule.category,
    threshold: rule.threshold,
    unit: rule.unit,
    status: rule.status,
    document: rule.source.document,
    revision: rule.source.revision,
    section: rule.source.section,
    sourceType: rule.source.type,
    lastUpdated: rule.source.lastUpdated,
    findingCount: findingCounts.get(rule.ruleId) ?? 0,
  }));

  return { ruleSetId: ruleSet.id, ruleSetVersion: ruleSet.version, rules };
}
