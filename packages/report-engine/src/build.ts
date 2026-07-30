import { DOCUMENT_VERSION, type MfdDocument, isCalibrated } from '@mfd/document-model';
import type { Catalog } from '@mfd/object-library';
import { EVALUATION_RESULT_VERSION, type RuleSet, evaluate } from '@mfd/rule-engine';

import { buildChecklist } from './checklist';
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
}

export function buildReport({
  document,
  catalog,
  ruleSet,
  checklistTemplate,
  generatedAt,
  mfdVersion,
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
