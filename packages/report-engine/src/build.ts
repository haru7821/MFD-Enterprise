import type { InstallationPlan } from '@mfd/ai-contract';
import { DOCUMENT_VERSION, type MfdDocument, isCalibrated } from '@mfd/document-model';
import type { Catalog } from '@mfd/object-library';
import { EVALUATION_RESULT_VERSION, type RuleSet, evaluate } from '@mfd/rule-engine';

import { buildChecklist } from './checklist';
import { buildInstallation } from './installation';
import type { ChecklistTemplate } from './checklistTemplate';
import { buildSummary } from './conclusion';
import { buildDatasheet, buildEquipmentSchedule, equipmentUsage } from './equipment';
import { buildFloorPlan, isUncalibrated, placementNumbers } from './floorPlan';
import { REPORT_VERSION, type ReportModel } from './model';
import { buildNotice } from './notice';
import { buildStandards } from './standards';
import { buildValidation } from './validation';

/**
 * `buildReport` — document + catalogue + rule set → `ReportModel`.
 *
 * **Pure.** No clock, no filesystem, no DOM, no randomness. `generatedAt` and `mfdVersion`
 * are injected, which is what makes the same project produce byte-identical JSON twice and
 * what will let a server's report be compared against the browser's rather than merely
 * resembling it (AD-3).
 *
 * ## Every level, not the selected one
 *
 * Phase 4.5 made multi-level projects real, so the report evaluates **all** of them. A
 * report that silently covered whichever floor happened to be selected would omit a floor
 * without saying so.
 *
 * That is a real cost — roughly 6 ms per level at fifty machines — which is why the editor
 * keeps evaluating only the active level for live feedback. Two call sites, one `evaluate`.
 * "Just evaluate everything" would make dragging a machine cost sixty milliseconds on a
 * ten-storey project.
 *
 * ## Verification and the calibration gate are the engine's, not this package's
 *
 * A finding's `dataStatus` and its `caveatCode` arrive already decided by
 * `@mfd/rule-engine`. This package reads them; it never recomputes them. If it did, the
 * report and the screen could disagree about whether a result is provisional — which is
 * exactly the failure that freezing the evaluation contract exists to prevent.
 */

export interface BuildReportInput {
  readonly document: MfdDocument;
  readonly catalog: Catalog;
  readonly ruleSet: RuleSet;
  readonly checklistTemplate: ChecklistTemplate;
  /** ISO timestamp. Injected — see above. */
  readonly generatedAt: string;
  readonly mfdVersion: string;
  /**
   * The installation plan, when the layout has been planned.
   *
   * **Built by the caller**, with `@mfd/ai-planner`, and passed in — this package does not run the
   * planner. Two reasons, and the second is the one that matters:
   *
   * 1. The planner needs routed lengths, which come from `@mfd/ai-local`'s geometry. A report
   *    engine that reached for them would acquire a dependency on the solver.
   * 2. A plan is made from a layout an engineer **approved**. Building one here would produce a
   *    plan for whatever happened to be on the drawing when somebody pressed Export, which is
   *    exactly the "never plan directly from raw user drawings" the planner's input type exists to
   *    prevent.
   */
  readonly installationPlan?: InstallationPlan | null;
}

export function buildReport({
  document,
  catalog,
  ruleSet,
  checklistTemplate,
  generatedAt,
  mfdVersion,
  installationPlan = null,
}: BuildReportInput): ReportModel {
  const { project } = document;

  const reports = project.levels.map((level) =>
    evaluate({
      placements: level.placements,
      catalog,
      ruleSet,
      spatial: {
        boundaries: level.boundaries,
        planStatus:
          level.planImage === null ? 'none' : isCalibrated(level) ? 'calibrated' : 'uncalibrated',
      },
    }),
  );

  const allPlacements = project.levels.flatMap((level) => level.placements);
  const { usage, unknownEquipmentIds } = equipmentUsage(allPlacements, catalog);
  const equipmentInUse = usage.map((entry) => entry.object);

  const uncalibratedLevels = project.levels.filter(isUncalibrated);

  // Counted per group, not per record: the number an engineer needs is how many citations
  // are outstanding, and a record with five groups sourced is not five times better off
  // than one with none if the count says "1 record".
  const draftFieldGroups = equipmentInUse.reduce(
    (total, object) =>
      total +
      buildDatasheet(object).draft_data.length,
    0,
  );

  const floorPlans = project.levels.map((level) => buildFloorPlan(level, catalog));

  const validation = project.levels.map((level, index) =>
    buildValidation({
      level,
      // Index-matched to `project.levels` by construction above. Both arrays are mapped
      // from it, so a missing entry would be a programming error rather than missing data.
      report: reports[index] ?? emptyReport(ruleSet),
      ruleSet,
      numbers: placementNumbers(level),
    }),
  );

  return {
    reportVersion: REPORT_VERSION,
    generatedAt,
    renderMode: project.settings.reportRenderMode,
    cover: {
      hospital: project.customer.hospital,
      site: project.customer.site,
      contact: project.customer.contact,
      projectName: project.name,
      customerContact: project.customer.contact,
      tsEngineer: project.reviewedBy,
      date: generatedAt.slice(0, 10),
      mfdVersion,
    },
    summary: buildSummary({
      reports,
      totalEquipment: allPlacements.length,
      uncalibratedLevels: uncalibratedLevels.length,
      draftFieldGroups,
      draftRuleCount: ruleSet.draftRules.length,
    }),
    equipmentSchedule: buildEquipmentSchedule(usage, unknownEquipmentIds),
    floorPlans,
    validation,
    checklist: buildChecklist({
      template: checklistTemplate,
      reports,
      equipmentInUse,
      uncalibratedLevelNames: uncalibratedLevels.map((level) => level.name),
    }),
    installation: installationPlan
      ? buildInstallation({
          plan: installationPlan,
          checklistTemplate,
          /*
           * The numbers the floor plan prints, for the level the plan was made for — so the plan
           * and the drawing name the same machines. A plan saying "station 4" beside a drawing
           * labelling it 7 is worse than a plan with no numbers at all.
           */
          placementNumbers: numbersForPlannedLevel(project.levels, installationPlan),
        })
      : null,
    datasheets: equipmentInUse.map(buildDatasheet),
    standards: buildStandards(ruleSet, reports),
    notice: buildNotice({
      hasDraftInputs: reports.some((report) => report.hasDraftInputs),
      uncalibratedLevels: uncalibratedLevels.length,
    }),
    provenance: {
      reportVersion: REPORT_VERSION,
      documentVersion: document.documentVersion,
      evaluationResultVersion: EVALUATION_RESULT_VERSION,
      ruleSetId: ruleSet.id,
      ruleSetVersion: ruleSet.version,
      catalogueVersions: equipmentInUse.map((object) => ({
        id: object.id,
        version: object.version,
      })),
      mfdVersion,
      generatedAt,
    },
  };
}

/** Unreachable in practice; present so the index match above needs no non-null assertion. */
function emptyReport(ruleSet: RuleSet) {
  return {
    ruleSetId: ruleSet.id,
    ruleSetVersion: ruleSet.version,
    results: [],
    counts: { GREEN: 0, YELLOW: 0, RED: 0 },
    hasDraftInputs: false,
  };
}

/** The document contract this build was written against, for the provenance section. */
export { DOCUMENT_VERSION };

/**
 * The floor plan's numbering for the level the plan was made for.
 *
 * Empty when the document no longer holds that level — **not** the numbering of some other floor.
 * A plan whose level has been deleted is a stale plan, and numbering its stages against a different
 * floor would produce a document that looks consistent and names the wrong machines. No numbers is
 * a visible gap; wrong numbers are not.
 */
function numbersForPlannedLevel(
  levels: MfdDocument['project']['levels'],
  plan: InstallationPlan,
): ReadonlyMap<string, number> {
  const level = levels.find((entry) => entry.id === plan.provenance.levelId);
  return level ? placementNumbers(level) : new Map();
}
