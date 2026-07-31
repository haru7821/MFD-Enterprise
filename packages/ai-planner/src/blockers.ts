import type { ConnectionPlan, PlanBlocker, PlanInput, PlanRisk } from '@mfd/ai-contract';
import { unknownText } from '@mfd/ai-contract';

import type { ExcludedStage } from './stages';
import type { SequenceStage } from './sequenceSet';

/**
 * What stops this plan being executed, and what might go wrong while executing it.
 *
 * Two different statements, kept apart on purpose:
 *
 * | | A blocker | A risk |
 * | --- | --- | --- |
 * | Says | This cannot proceed | This could go wrong |
 * | Comes from | A RED finding, a missing prerequisite, an uncalibrated plan | The sequence data, a data gap, an unroutable service |
 * | An engineer's move | Resolve it before starting | Read it before starting |
 *
 * A plan with blockers is still produced. An engineer reasonably wants the sequence while resolving
 * findings, and refusing to show one would just move the work into a spreadsheet. What the plan may
 * not do is sequence past a violation silently — so the blockers lead.
 */

export function collectBlockers(
  input: PlanInput,
  excluded: readonly ExcludedStage[],
): PlanBlocker[] {
  const blockers: PlanBlocker[] = [];

  /*
   * A RED finding is a rule the layout breaks. Building it is a decision somebody has to make
   * knowingly, so it appears here by reason code — the same code the validation panel and the
   * report show, so the three cannot describe it differently.
   */
  for (const finding of input.evaluation.openFindings) {
    if (finding.level !== 'RED') continue;
    blockers.push({ kind: 'open_violation', ref: finding.reasonCode, stageId: null });
  }

  /*
   * An uncalibrated plan drawing makes every routed length a number of pixels wearing a millimetre
   * label. The connection plans below are built from those lengths, so this is a blocker on the
   * whole plan rather than a caveat on one section.
   */
  if (input.planStatus === 'uncalibrated') {
    blockers.push({ kind: 'uncalibrated_level', ref: input.levelId, stageId: null });
  }

  /*
   * Every excluded stage, with what was missing.
   *
   * This is the half that makes exclusion safe. A plan that silently dropped the pressure test
   * because nobody marked the RO supply reads as a simpler job; this says *"the RO loop pressure
   * test is not in this plan, because no ro_supply reference point is placed"*, which is a sentence
   * an engineer can act on in about ten seconds.
   */
  for (const entry of excluded) {
    blockers.push({
      kind: entry.missing === 'placements' ? 'missing_prerequisite' : 'missing_reference_point',
      ref: entry.missing,
      stageId: entry.stage.id,
    });
  }

  return blockers;
}

export function collectRisks(
  input: PlanInput,
  stages: readonly SequenceStage[],
  connections: readonly ConnectionPlan[],
): PlanRisk[] {
  const risks: PlanRisk[] = [];

  // Declared in the sequence file: things a customer's own engineers wrote down about their site.
  for (const stage of stages) {
    for (const risk of stage.risks) {
      risks.push({
        id: `${stage.id}:${risk.id}`,
        origin: 'sequence_set',
        ref: `sequence_set:${stage.id}.risks.${risk.id}`,
        title: risk.title,
        detail: {
          value: risk.detail,
          status: 'planning',
          source: { kind: 'sequence_set', ref: `${stage.id}.risks.${risk.id}`, citation: null },
        },
        stageId: stage.id,
      });
    }
  }

  /*
   * A YELLOW finding is the rule engine saying it could not establish something — overwhelmingly,
   * on this product today, a missing threshold. That is a risk to an installation rather than a
   * blocker to it: the work can start, and somebody will be standing in front of a machine with no
   * figure to check it against.
   */
  const seen = new Set<string>();
  for (const finding of input.evaluation.openFindings) {
    if (finding.level !== 'YELLOW' || seen.has(finding.reasonCode)) continue;
    seen.add(finding.reasonCode);
    risks.push({
      id: `finding:${finding.reasonCode}`,
      origin: 'data_gap',
      ref: finding.reasonCode,
      title: { ko: '확인 필요 항목', en: 'Requires Review' },
      // The prose belongs to the rule engine, which composes it bilingually from the reason code.
      // Repeating it here would give an engineer two wordings of one finding.
      detail: unknownText(`finding:${finding.reasonCode}`),
      stageId: null,
    });
  }

  /*
   * A machine the router could not reach from a service origin. Its pipe or cable cannot be
   * quantified, so somebody will find out on site — which is exactly what a risk item is for.
   */
  for (const plan of connections) {
    for (const run of plan.runs) {
      if (run.length.value !== null) continue;
      risks.push({
        id: `unroutable:${plan.service}:${run.placementId}`,
        origin: 'unroutable',
        ref: `route:${plan.service}:${run.placementId}`,
        title: { ko: '경로 산출 불가', en: 'No Route Established' },
        detail: unknownText(`route:${plan.service}:${run.placementId}`),
        stageId: null,
      });
    }
  }

  return risks;
}
