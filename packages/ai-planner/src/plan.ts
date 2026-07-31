import type {
  AiPlanner,
  InstallationPlan,
  InstallationStage,
  PlanInput,
  PlanRisk,
} from '@mfd/ai-contract';

import { collectBlockers, collectRisks } from './blockers';
import { buildConnections } from './connections';
import {
  durationFor,
  manpowerFor,
  peakManpower,
  ratesAvailableFor,
  totalDuration,
} from './effort';
import { billOfMaterials, materialsFor, toolsFor } from './materials';
import { orderStages } from './order';
import { type SequenceSet, sequenceSetRef } from './sequenceSet';
import { resolveStages } from './stages';

/**
 * The deterministic installation planner.
 *
 * > Owner decision, Sprint 6: *"Sprint 6 is NOT an 'AI generation' sprint. It is an Engineering
 * > Planning Engine. The deterministic solver remains the source of truth."*
 *
 * Pure TypeScript. No model, no prompt, no network, no clock, no random source — the same inputs
 * produce a byte-identical plan, in this browser and in six months' time, which is the property a
 * document somebody builds from has to have.
 *
 * ## The one thing this function cannot be asked to do
 *
 * Plan from an unvalidated drawing. {@link PlanInput.evaluation} is a required field, so a caller
 * holding a raw layout **cannot construct the argument** — the owner's § 1 is a compile error
 * rather than a check somebody could forget. What comes out records which evaluation it was, in
 * `provenance`, so a plan found on a desk six months later can be checked against the layout it was
 * made for rather than assumed current.
 *
 * ## Where every number comes from
 *
 * | Output | Derived from |
 * | --- | --- |
 * | Stages and their order | The sequence set's declared dependencies, topologically sorted |
 * | Which stages apply | The project's own contents — placements, reference points |
 * | Checklist items | **The report's checklist ids.** Referenced, never re-authored |
 * | Connections | Routed lengths measured by the caller, from the reference points |
 * | Materials | The equipment record's `connections` group × the machine count |
 * | Tools | The sequence file, each naming the check that entails it |
 * | Manpower, duration | `InstallationRate` entries in the sequence file — **none supplied, so all `unknown`** (B-7) |
 * | Blockers | RED findings, excluded stages, an uncalibrated plan |
 *
 * Nothing in that table is a judgement made here. This file arranges; the rule engine judges, the
 * catalogue states, and the sequence file sequences.
 */
export function planInstallation(set: SequenceSet, input: PlanInput): InstallationPlan {
  const { included, excluded } = resolveStages(set, input);
  const ordered = orderStages(included);
  const stationCount = input.placements.length;

  const connections = buildConnections(input);
  const blockers = collectBlockers(input, excluded);
  const risks = collectRisks(input, ordered, connections);
  const risksByStage = groupRisks(risks);

  const stages: InstallationStage[] = ordered.map((stage, index) => ({
    id: stage.id,
    // 1-based, and the *printed* position rather than the file's. A reader following a plan counts
    // from the top of the page they are holding.
    order: index + 1,
    title: stage.title,
    dependsOn: stage.dependsOn,
    /*
     * Which machines this stage touches.
     *
     * Every placement, on any stage that applies because there are placements. A stage like
     * `handover` that applies `always` carries none — it is not about a machine, and listing all
     * twelve under it would suggest twelve handovers.
     */
    placementIds:
      stage.appliesWhen.kind === 'has_placements'
        ? input.placements.map((placement) => placement.placementId)
        : [],
    /*
     * The report's checklist ids, filtered to the ones this project's checklist actually has.
     *
     * Filtered rather than trusted: the sequence file and the checklist file are separate customer-
     * editable documents, and a stage naming an item a customer deleted would put an id in the plan
     * that resolves to nothing in the signed report. The filtering is silent here and loud in the
     * tests — {@link planInstallation} is not the place to discover a data mismatch, but a data
     * mismatch must not become a dangling reference either.
     */
    checklistItemIds: stage.checklistItemIds.filter((id) => input.checklistItemIds.includes(id)),
    tools: toolsFor(stage, stationCount),
    materials: materialsFor(stage, input),
    risks: risksByStage.get(stage.id) ?? [],
    manpower: manpowerFor(set, stage),
    duration: durationFor(set, stage, stationCount),
  }));

  return {
    sequenceSet: sequenceSetRef(set),
    stages,
    blockers,
    connections,
    materials: billOfMaterials(stages.map((stage) => stage.materials)),
    risks,
    manpower: peakManpower(stages.map((stage) => stage.manpower)),
    duration: totalDuration(stages.map((stage) => stage.duration)),
    /*
     * B-7. One flag rather than three renderers each working out why a figure is absent — the one
     * that got it wrong would print a blank where *"Planning rate data not available."* belongs.
     */
    ratesAvailable: ratesAvailableFor(set, ordered),
    provenance: {
      levelId: input.levelId,
      placementCount: stationCount,
      ruleSet: input.evaluation.ruleSet,
      evaluationVersion: input.evaluation.version,
      findingCounts: {
        red: input.evaluation.red,
        yellow: input.evaluation.yellow,
        green: input.evaluation.green,
      },
      optimisation: input.optimisation
        ? {
            candidateId: input.optimisation.candidateId,
            scoringModel: input.optimisation.score.scoringModel,
            total: input.optimisation.score.total,
            coverage: input.optimisation.score.coverage,
          }
        : null,
    },
  };
}

/**
 * The default planner, as an {@link AiPlanner}.
 *
 * > Owner decision, Sprint 6 § 7: *"The deterministic planner is the default implementation."*
 *
 * `requiresNetwork: false` is a literal type on the interface, so this object could not claim
 * otherwise and still compile. That is § 6 — *"must work completely offline"* — held by the type
 * system rather than by a note in a README.
 */
export function deterministicPlanner(set: SequenceSet): AiPlanner {
  return {
    id: `deterministic:${set.id}`,
    sequenceSet: sequenceSetRef(set),
    requiresNetwork: false,
    plan: (input) => planInstallation(set, input),
  };
}

function groupRisks(risks: readonly PlanRisk[]): Map<string, PlanRisk[]> {
  const byStage = new Map<string, PlanRisk[]>();
  for (const risk of risks) {
    if (risk.stageId === null) continue;
    byStage.set(risk.stageId, [...(byStage.get(risk.stageId) ?? []), risk]);
  }
  return byStage;
}
