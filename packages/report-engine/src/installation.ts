import type {
  ConnectionPlan,
  EvidenceStatus,
  InstallationPlan,
  PlanRisk,
  SourcedNumber,
  SourcedText,
} from '@mfd/ai-contract';
import type { Bilingual } from '@mfd/rule-engine';

import type { ChecklistTemplate } from './checklistTemplate';
import type {
  BomRow,
  ConnectionRunRow,
  ConnectionSectionRow,
  InstallationBlockerRow,
  InstallationSection,
  InstallationStageRow,
  RiskRow,
  SourcedFigure,
} from './model';

/**
 * The installation plan, as report sections.
 *
 * > Owner decision, Sprint 6 § 9: *"Planner output must automatically feed PDF, BOM,
 * > Installation Plan, Commissioning Checklist without duplicate implementations."*
 *
 * ## What "without duplicate implementations" means here
 *
 * The plan is built once, by `@mfd/ai-planner`, from a validated layout. This file **translates**
 * it into the report's own vocabulary — resolving placement ids to the numbers the drawing prints,
 * checklist ids to the text the checklist section already holds — and computes nothing.
 *
 * There is exactly one thing this file is allowed to decide: how a `SourcedNumber` renders when its
 * value is null. Everything else is a lookup.
 *
 * | The report already has | So this section carries |
 * | --- | --- |
 * | Checklist item text, grouped by trade | The **ids**, per stage. One source, two views |
 * | Finding sentences, from reason codes | The **reason code** on a risk. Never the sentence |
 * | Placement labels and numbers | The **number**, resolved once here |
 *
 * A section that re-authored any of those would give an engineer two versions of one thing, and the
 * one they followed on site would be the one that is not in the signed report.
 */

export interface BuildInstallationInput {
  readonly plan: InstallationPlan;
  readonly checklistTemplate: ChecklistTemplate;
  /** Placement id → the number the floor plan prints, so the plan and the drawing agree. */
  readonly placementNumbers: ReadonlyMap<string, number>;
}

export function buildInstallation({
  plan,
  checklistTemplate,
  placementNumbers,
}: BuildInstallationInput): InstallationSection {
  const checklistText = new Map<string, Bilingual>(
    checklistTemplate.categories.flatMap((category) =>
      category.items.map((item) => [item.id, item.text] as const),
    ),
  );

  const stages: InstallationStageRow[] = plan.stages.map((stage) => ({
    id: stage.id,
    order: stage.order,
    title: stage.title,
    dependsOn: stage.dependsOn,
    placementNumbers: stage.placementIds
      .map((id) => placementNumbers.get(id) ?? null)
      .filter((entry): entry is number => entry !== null)
      .sort((a, b) => a - b),
    checks: stage.checklistItemIds.map((id) => ({
      id,
      /*
       * Null when the checklist template does not have the id.
       *
       * Kept as a row rather than dropped: the planner already filters against the ids it was
       * given, so a null here means the report was built with a different checklist than the plan
       * was — which a reader should see as an unresolved reference rather than as an absence.
       */
      text: checklistText.get(id) ?? null,
    })),
    tools: stage.tools.map(toBomRow),
    materials: stage.materials.map(toBomRow),
    manpower: figureOf(stage.manpower),
    duration: figureOf(stage.duration),
  }));

  return {
    sequenceSet: plan.sequenceSet,
    stages,
    connections: plan.connections.map(toConnectionRow),
    bom: plan.materials.map(toBomRow),
    risks: plan.risks.map(toRiskRow),
    blockers: plan.blockers.map(
      (blocker): InstallationBlockerRow => ({
        kind: blocker.kind,
        ref: blocker.ref,
        stageId: blocker.stageId,
      }),
    ),
    manpower: figureOf(plan.manpower),
    duration: figureOf(plan.duration),
    provenance: {
      levelId: plan.provenance.levelId,
      placementCount: plan.provenance.placementCount,
      ruleSet: plan.provenance.ruleSet,
      optimisationCandidateId: plan.provenance.optimisation?.candidateId ?? null,
    },
  };
}

/**
 * A sourced number, ready to print.
 *
 * **`value: null` becomes `null`, not `'0'` and not `'—'`.** The renderer prints the
 * `not_supplied` label for it, in both languages, so an unknown reads as a statement rather than as
 * a formatting artefact — which is the whole point of the owner's *"unknown values remain
 * Unknown"*. The status and the source ride along so a reader can see **why** it is unknown and
 * what would answer it.
 */
function figureOf(figure: SourcedNumber): SourcedFigure {
  return {
    value: figure.value,
    unit: figure.unit,
    status: figure.status,
    sourceRef: figure.source.ref,
    /*
     * The inputs of a calculated figure, so the arithmetic is checkable in the signed document.
     * Empty for everything else, and empty is correct — a stated figure has no arithmetic to show.
     */
    inputs: figure.source.inputs,
  };
}

function toBomRow(resource: {
  readonly id: string;
  readonly title: Bilingual;
  readonly quantity: SourcedNumber;
}): BomRow {
  return { id: resource.id, title: resource.title, quantity: figureOf(resource.quantity) };
}

function toConnectionRow(plan: ConnectionPlan): ConnectionSectionRow {
  return {
    service: plan.service,
    originPointId: plan.originPointId,
    total: figureOf(plan.totalLength),
    runs: plan.runs.map(
      (run): ConnectionRunRow => ({
        placementId: run.placementId,
        length: figureOf(run.length),
        requirement: textStatusOf(run.requirement),
      }),
    ),
  };
}

function toRiskRow(risk: PlanRisk): RiskRow {
  return {
    id: risk.id,
    origin: risk.origin,
    ref: risk.ref,
    title: risk.title,
    /*
     * The detail, or null.
     *
     * Null on every risk that came from a finding, deliberately: the rule engine composes that
     * sentence bilingually from the reason code, and the validation section already prints it. The
     * risk row carries `ref` so a reader can find it there.
     */
    detail: risk.detail.value,
    stageId: risk.stageId,
  };
}

function textStatusOf(text: SourcedText): {
  readonly value: Bilingual | null;
  readonly status: EvidenceStatus;
  readonly sourceRef: string;
} {
  return { value: text.value, status: text.status, sourceRef: text.source.ref };
}
