import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { dialysisScoringModel } from '../packages/ai-contract/scoring/index';
import { rankLayouts } from '../packages/ai-local/src/rank';
import { dialysisKnowledge } from '../packages/layout-knowledge/knowledge/index';
import {
  readPrintedDimensions,
  reconcileScale,
  sheetSizeOf,
  type PrintedDimension,
} from '../packages/layout-knowledge/src/index';
import type {
  DrawingVerification,
  VerificationDiscrepancy,
} from '../packages/layout-knowledge/src/verification';
import { VERIFICATION_VERSION } from '../packages/layout-knowledge/src/verification';
import {
  calibrateFromStatedRatio,
  calibrateFromTwoPoints,
  createDocument,
  planTransformOf,
  setCoordinateMapping,
  setPlanImage,
  type Boundary,
  type Level,
  type MfdDocument,
  type Placement,
} from '../packages/document-model/src/index';
import { catalog } from '../packages/object-library/catalog/index';
import { evaluate } from '../packages/rule-engine/src/evaluate';
import { dialysisRuleSet } from '../packages/rule-engine/rules/index';

import { measureRoomWidth } from './lib/hallGeometry';
import { readPageGeometry } from './lib/pdfGeometry';

/**
 * End-to-end verification of one real drawing.
 *
 * > Owner decision: *"Proceed with Hospital_044 as the first end-to-end verification drawing … 1.
 * > Import the original PDF. 2. Calibrate using the drawing dimension lines as the primary method.
 * > 3. Compare with the printed scale only as a secondary cross-check. 4. Verify coordinate mapping
 * > using real measurements. 5. Place AK98 equipment (planning footprint 800 × 800 mm) and 1000 ×
 * > 2100 mm beds. 6. Run the rule engine, optimiser and planning workflow. 7. Generate the final
 * > report. Record every measured value as an observation with its source and SHA-256 of the
 * > drawing. Do not invent any measurement."*
 *
 * ## Run it
 *
 * ```
 * pnpm verify:drawing                                   # Hospital_044/dialysis.pdf
 * pnpm verify:drawing --drawing Hospital_012/dialysis.pdf --dataset /path/to/dataset
 * ```
 *
 * The dataset lives outside this repository, so this cannot run in CI and is not meant to. What it
 * leaves behind — `knowledge/verification/<drawing>.json` — is committed, and the tests in
 * `packages/layout-knowledge/src/verification.test.ts` check that record's internal coherence on
 * every push. CI cannot re-measure the drawing; it can prove nobody edited the answer.
 *
 * ## The order the steps run in is the order they depend on each other
 *
 * Nothing downstream of the calibration is allowed to run if the calibration failed, and nothing is
 * allowed to substitute a default for a measurement that could not be taken. Where a value the
 * pipeline needs is not on the drawing, that is recorded as a discrepancy and the value is measured
 * against the established scale — never assumed, and never silently defaulted.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const DATASET_ROOT = argument('dataset', '/workspace/mfd-hospital-dataset');
const DRAWING_ID = argument('drawing', 'Hospital_044/dialysis.pdf');
/**
 * Supplied rather than read from a clock.
 *
 * Every engine in this repository takes its timestamps as arguments (AD-3), and a verification
 * record is the one artefact where that matters most: a run that stamped `Date.now()` could not be
 * repeated to check it, and the diff of a re-run would be noise.
 */
const NOW = argument('now', '2026-07-31T00:00:00.000Z');

/**
 * Who took these readings.
 *
 * > Owner decision: *"Do not represent them as human observations."* This harness is a program, it
 * says so, and every observation it writes carries this block.
 */
const verificationObserver = {
  type: 'ai' as const,
  name: 'MFD Drawing Verification Harness',
  version: '1.0',
};

/** The title block says `A3 : 1/100`, read off the drawing by a person. Not inferred. */
const TITLE_BLOCK = { claimedSheetSize: 'A3', statedRatio: '1:100' } as const;

/** The importer's constants, mirrored so this predicts exactly what the application will do. */
const PDF_RENDER_DPI = 150;
const MAX_PLAN_PIXELS = 4_096;

/** Beyond this the calibrated scale and the printed scale are reported as disagreeing. */
const CROSS_CHECK_TOLERANCE = 0.01;

const BED_ID = 'dialysis_bed';
const MACHINE_ID = 'vantive_ak98';

// ---------------------------------------------------------------------------
// 1 · The file
// ---------------------------------------------------------------------------

const drawingPath = join(DATASET_ROOT, DRAWING_ID);
const bytes = readFileSync(drawingPath);
const sha256 = createHash('sha256').update(bytes).digest('hex');

interface DatasetEntry {
  drawingId: string;
  sha256: string;
}
const dataset = JSON.parse(readFileSync(join(REPO, 'knowledge', 'dataset.json'), 'utf8')) as {
  drawings: DatasetEntry[];
};
const catalogued = dataset.drawings.find((entry) => entry.drawingId === DRAWING_ID);
if (!catalogued) throw new Error(`${DRAWING_ID} is not in knowledge/dataset.json`);
if (catalogued.sha256 !== sha256) {
  // The catalogue's hash and the file's hash are the only link between a measurement and the bytes
  // it was taken from. A mismatch means one of them moved, and continuing would attribute this
  // run's figures to a drawing it did not read.
  throw new Error(
    `${DRAWING_ID} has changed since it was catalogued:\n  catalogued ${catalogued.sha256}\n  actual     ${sha256}`,
  );
}

const page = await readPageGeometry(drawingPath);
const discrepancies: VerificationDiscrepancy[] = [];

// ---------------------------------------------------------------------------
// 2 · The dimensions the drawing prints, and the scale they agree on
// ---------------------------------------------------------------------------

const printed = readPrintedDimensions(page.segments, page.texts);
const agreement = reconcileScale(printed);
if (!agreement) {
  throw new Error(
    `${DRAWING_ID}: fewer than two of its printed dimensions could be read and reconciled, ` +
      'so no scale can be established from dimension lines. Calibration required.',
  );
}

for (const outlier of agreement.inconsistent) {
  const drawnMm = (outlier.measuredPt * 25.4 * agreement.scale) / 72;
  discrepancies.push({
    code: 'VD-1',
    subject: `printed dimension "${outlier.label}"`,
    detail:
      `The label states ${outlier.statedMm.toLocaleString('en')} mm; the geometry beneath it ` +
      `measures ${Math.round(drawnMm).toLocaleString('en')} mm at the sheet's scale of 1:${agreement.scale.toFixed(2)} ` +
      `(implied 1:${outlier.impliedScale.toFixed(2)}, ${((outlier.impliedScale / agreement.scale - 1) * 100).toFixed(2)} % out). ` +
      'Excluded from the calibration and from the knowledge base. Not corrected — a dimension ' +
      'text that disagrees with its own geometry is a question for whoever holds the CAD file.',
    resolved: false,
  });
}

// ---------------------------------------------------------------------------
// 3 · What the importer will make of this page
// ---------------------------------------------------------------------------

const baseWidthPx = (page.widthPt / 72) * PDF_RENDER_DPI;
const baseHeightPx = (page.heightPt / 72) * PDF_RENDER_DPI;
const cap = Math.min(1, MAX_PLAN_PIXELS / Math.max(baseWidthPx, baseHeightPx));
const renderDpi = PDF_RENDER_DPI * cap;
const pixelWidth = Math.round(baseWidthPx * cap);
const pixelHeight = Math.round(baseHeightPx * cap);
/** Page points → pixels of the rasterised image. */
const pxPerPt = renderDpi / 72;
const toPixel = (point: { x: number; y: number }) => ({
  x: point.x * pxPerPt,
  y: point.y * pxPerPt,
});

const actualSheetSize = sheetSizeOf(page.widthPt, page.heightPt);
if (actualSheetSize !== TITLE_BLOCK.claimedSheetSize) {
  discrepancies.push({
    code: 'VD-3',
    subject: 'title block paper size',
    detail:
      `The title block claims ${TITLE_BLOCK.claimedSheetSize}; the page is ` +
      `${actualSheetSize ?? 'no standard ISO size'}. The printed-scale route is refused.`,
    resolved: false,
  });
}

// ---------------------------------------------------------------------------
// 4 · Calibrate from a dimension line; cross-check against the printed scale
// ---------------------------------------------------------------------------

const primary = agreement.primary;
const pointA = toPixel(primary.from);
const pointB = toPixel(primary.to);

const calibration = calibrateFromTwoPoints({
  pointA,
  pointB,
  knownDistance: primary.statedMm,
  now: NOW,
});
if (!calibration) throw new Error('two-point calibration produced no mapping');

/*
 * The secondary check, and only ever secondary — Owner decision Q-4 and again for this drawing.
 * `paperSizeDisagrees` would refuse this route outright on a sheet whose title block lies about its
 * size; here the claim and the page agree, so the printed scale is a fair comparison rather than a
 * fallback we are relying on.
 */
const stated =
  actualSheetSize === TITLE_BLOCK.claimedSheetSize
    ? calibrateFromStatedRatio({
        statedRatio: TITLE_BLOCK.statedRatio,
        dotsPerInch: renderDpi,
        now: NOW,
      })
    : null;

const crossCheck = stated
  ? {
      statedRatio: TITLE_BLOCK.statedRatio,
      millimetresPerPixel: stated.millimetresPerPixel,
      deviationFraction:
        calibration.millimetresPerPixel / stated.millimetresPerPixel - 1,
      agrees:
        Math.abs(calibration.millimetresPerPixel / stated.millimetresPerPixel - 1) <=
        CROSS_CHECK_TOLERANCE,
    }
  : null;

if (crossCheck && !crossCheck.agrees) {
  discrepancies.push({
    code: 'VD-2',
    subject: 'calibrated scale versus printed scale',
    detail:
      `Dimension-line calibration gives ${calibration.millimetresPerPixel.toFixed(5)} mm/px; the ` +
      `printed ${TITLE_BLOCK.statedRatio} at ${renderDpi} dpi gives ${stated?.millimetresPerPixel.toFixed(5)} mm/px, ` +
      `a difference of ${(crossCheck.deviationFraction * 100).toFixed(2)} %.`,
    resolved: false,
  });
}

// ---------------------------------------------------------------------------
// 5 · Verify the mapping against every other printed dimension
// ---------------------------------------------------------------------------

/*
 * The step that makes this a verification. The mapping was built from one dimension; every other
 * printed dimension is now a measurement it has to reproduce without having been shown it.
 */
const mappingChecks = agreement.consistent
  .filter((dimension) => dimension.label !== primary.label)
  .map((dimension) => {
    const a = toPixel(dimension.from);
    const b = toPixel(dimension.to);
    const mappedMm = Math.hypot(b.x - a.x, b.y - a.y) * calibration.millimetresPerPixel;
    return {
      label: dimension.label,
      statedMm: dimension.statedMm,
      mappedMm,
      deviationFraction: mappedMm / dimension.statedMm - 1,
    };
  });

// ---------------------------------------------------------------------------
// 6 · The room. One dimension printed, one not.
// ---------------------------------------------------------------------------

const room = measureRoomWidth(page.segments, primary, agreement.scale);
if (!room) {
  throw new Error(
    `${DRAWING_ID}: the hall's width is not printed and no wall pair could be measured. ` +
      'Measurement unavailable — the pipeline cannot proceed without a room.',
  );
}

discrepancies.push({
  code: 'VD-4',
  subject: 'hall width',
  detail:
    'The drawing dimensions the hall along its length (17,600 mm) but not across it. The width ' +
    `used below, ${Math.round(room.widthMm).toLocaleString('en')} mm, is a calibrated measurement between the ` +
    `inner faces of the two walls (${room.wallThicknessMm.map((t) => Math.round(t)).join(' mm and ')} mm thick), ` +
    'not a printed dimension. It carries the weaker `calibrated_measurement` method wherever it ' +
    'is recorded, and a printed dimension would supersede it.',
  resolved: false,
});

/*
 * Square the drawing — step 4 of the plan wizard. The building is plotted at about 9° off the
 * sheet, so without this every clearance would be measured 9° out. Set as exact millidegrees; note
 * that `radiansToMillidegrees` in `@mfd/cad-engine` rounds to whole degrees, which on a 17.6 m hall
 * would leave 84 mm of skew.
 */
const hallAngle = Math.atan2(primary.to.y - primary.from.y, primary.to.x - primary.from.x);
const rotationMillidegrees = -Math.round((hallAngle * 180 * 1000) / Math.PI);

const mapping = {
  ...calibration,
  origin: pointA,
  rotation: rotationMillidegrees,
};

// ---------------------------------------------------------------------------
// 7 · Build the project on the calibrated level
// ---------------------------------------------------------------------------

let document: MfdDocument = createDocument({
  projectId: 'hospital-044-verification',
  name: `${DRAWING_ID} verification`,
  now: NOW,
  levelName: '지상2층 / Level 2',
  ruleSetRef: { id: dialysisRuleSet.id, version: dialysisRuleSet.version },
});
const levelId = document.project.levels[0]!.id;

document = setPlanImage(document, levelId, {
  sourceFormat: 'pdf',
  sourceFileName: DRAWING_ID,
  pageIndex: 0,
  pixelWidth,
  pixelHeight,
  /*
   * A one-pixel placeholder, and it is deliberate.
   *
   * The drawings are a hospital's property and are not stored in this repository — so this document
   * is built to be measured against, not to be shipped or opened. Nothing downstream reads these
   * pixels: the rule engine asks only whether a plan exists and is calibrated, and the report
   * defaults to vector rendering. `tests/e2e/hospital044.spec.ts` imports the real PDF through the
   * application's own importer and checks that it produces the same page size, resolution and
   * scale as this run predicts, which is where the raster is actually exercised.
   */
  dataUrl:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgDTD2qgAAAAASUVORK5CYII=',
  renderDpi,
  importedAt: NOW,
});
document = setCoordinateMapping(document, levelId, mapping);

const transform = planTransformOf(document.project.levels[0]!);
if (!transform) throw new Error('the level did not come out calibrated');

/*
 * The room in model millimetres. Its length is the printed 17,600 mm dimension, which the
 * calibration makes exactly the x extent; its width is the measured wall-to-wall distance mapped
 * through the same transform. Both corners come from points on the drawing.
 */
const { pixelToModel } = await import('../packages/cad-engine/src/planTransform');
const wallLow = pixelToModel(transform, toPixel(room.from));
const wallHigh = pixelToModel(transform, toPixel(room.to));
const yLow = Math.min(wallLow.y, wallHigh.y);
const yHigh = Math.max(wallLow.y, wallHigh.y);
const roomLength = primary.statedMm;

const boundary: Boundary = {
  id: 'boundary-hall',
  kind: 'space_outline',
  vertices: [
    { x: 0, y: yLow },
    { x: roomLength, y: yLow },
    { x: roomLength, y: yHigh },
    { x: 0, y: yHigh },
  ],
  label: '투석실 / Dialysis hall',
  obstructionType: null,
};

// ---------------------------------------------------------------------------
// 8 · Place the beds and the machines
// ---------------------------------------------------------------------------

const bed = catalog.require(BED_ID);
const machine = catalog.require(MACHINE_ID);

/**
 * Ten stations in two rows of five facing each other across a central aisle, at the drawing's own
 * 2,000 mm bed pitch.
 *
 * The arrangement is the one the drawing shows and the pitch is the one it prints. Nothing here is
 * a measurement — where each machine sits is a design decision, and the optimiser is given the same
 * room afterwards to see what it would do instead. What *is* taken from the drawing is the pitch,
 * the station count and the room, and each of those is recorded with the method it came from.
 */
const STATIONS_PER_ROW = 5;
const pitchDimension = agreement.consistent.find((entry) => entry.statedMm === 2_000);
if (!pitchDimension) {
  throw new Error('the 2,000 mm bed pitch is not among the consistent printed dimensions');
}
const pitch = pitchDimension.statedMm;

const placements: Placement[] = [];
for (let row = 0; row < 2; row += 1) {
  for (let index = 0; index < STATIONS_PER_ROW; index += 1) {
    const x = index * pitch;
    // Row 0 against the low wall; row 1 against the high wall, turned to face the aisle.
    const bedY = row === 0 ? yLow : yHigh - bed.planningFootprint.depth;
    placements.push({
      id: `bed-${row}-${index}`,
      equipmentObjectId: bed.id,
      equipmentObjectVersion: bed.version,
      transform: { position: { x, y: bedY }, rotation: 0, mirrored: false },
      label: `Bed ${row * STATIONS_PER_ROW + index + 1}`,
      spaceId: 'space-hall',
    });
    // The machine stands in the gap between beds, at the head end beside its own bed.
    const machineY = row === 0 ? yLow : yHigh - machine.planningFootprint.depth;
    placements.push({
      id: `ak98-${row}-${index}`,
      equipmentObjectId: machine.id,
      equipmentObjectVersion: machine.version,
      transform: {
        position: { x: x + bed.planningFootprint.width, y: machineY },
        rotation: 0,
        mirrored: false,
      },
      label: `AK98 ${row * STATIONS_PER_ROW + index + 1}`,
      spaceId: 'space-hall',
    });
  }
}

const level: Level = {
  ...document.project.levels[0]!,
  boundaries: [boundary],
  spaces: [
    {
      id: 'space-hall',
      name: '투석실 / Dialysis hall',
      function: 'hemodialysis_treatment',
      boundaryId: boundary.id,
    },
  ],
  placements,
};
document = {
  ...document,
  project: { ...document.project, levels: [level] },
};

// ---------------------------------------------------------------------------
// 9 · Rule engine, optimiser, planner, report
// ---------------------------------------------------------------------------

const evaluation = evaluate({
  placements: level.placements,
  catalog,
  ruleSet: dialysisRuleSet,
  spatial: { boundaries: level.boundaries, planStatus: 'calibrated' },
});

/*
 * A self-check on the rule engine's own output, and the reason it exists is that it fired.
 *
 * A finding that says a machine extends beyond the room is checkable: if every corner of its
 * footprint is inside the room outline, the finding contradicts itself. Recomputing that here — from
 * the same footprint geometry the evaluator used — is what turns "the report says RED" into
 * something the verification can either confirm or challenge. Without it a false RED would have been
 * written into the record as an engineering result.
 */
const { polygonContains } = await import('../packages/cad-engine/src/index');
const { footprintCorners } = await import('../packages/object-library/src/geometry');
const contradicted = evaluation.results.filter((result) => {
  if (result.reasonCode !== 'RC-302' && result.reasonCode !== 'RC-301') return false;
  return result.placementIds.every((placementId) => {
    const placement = level.placements.find((entry) => entry.id === placementId);
    const object = placement ? catalog.get(placement.equipmentObjectId) : undefined;
    if (!placement || !object) return false;
    return footprintCorners(object, placement.transform).every((corner) =>
      polygonContains(boundary.vertices, corner),
    );
  });
});

if (contradicted.length > 0) {
  discrepancies.push({
    code: 'VD-5',
    subject: 'rule engine — equipment flush against a room wall',
    detail:
      `${contradicted.length} of ${evaluation.results.length} findings report equipment as extending ` +
      'beyond the room outline while every corner of that equipment is inside the outline. The ' +
      'cause is a T-junction: an edge of the footprint ends on the interior of a room edge, and ' +
      '`segmentIntersectionPoint` in @mfd/cad-engine reports that touch as a proper crossing, so ' +
      '`polygonContainsPolygon` refuses containment. Its own documentation says shared endpoints ' +
      'and collinear overlap are not crossings; an endpoint touching the interior of another ' +
      'segment is neither of those cases and is not excluded. Equipment stood against a wall is ' +
      'the ordinary layout — it is what this drawing shows — so every such machine reports RED. ' +
      'Reported, not fixed, per the owner instruction to stop and report a discrepancy first.',
    resolved: false,
  });
}

const ranked = rankLayouts({
  room: boundary.vertices,
  obstructions: [],
  boundaries: [],
  object: machine,
  catalog,
  ruleSet: dialysisRuleSet,
  planStatus: 'calibrated',
  stationTarget: STATIONS_PER_ROW * 2,
  pitchPadding: 0,
  knowledge: dialysisKnowledge,
  existing: [],
  referencePoints: [],
  scoring: dialysisScoringModel,
});

const { runPlanner } = await import('../apps/web/src/features/planning/runPlanner');
const installationPlan = runPlanner({
  projectId: document.project.id,
  document,
  level,
  spaceId: 'space-hall',
  catalog,
  ruleSet: dialysisRuleSet,
  evaluation,
  optimisation: null,
  generatedAt: NOW,
});

const { buildReport } = await import('../packages/report-engine/src/build');
const { dialysisChecklistTemplate } = await import(
  '../packages/report-engine/checklists/index'
);
const reportModel = buildReport({
  document,
  catalog,
  ruleSet: dialysisRuleSet,
  checklistTemplate: dialysisChecklistTemplate,
  generatedAt: NOW,
  mfdVersion: 'verification',
  installationPlan,
});

const { renderPdf } = await import('../packages/report-engine/src/render/pdf');
const fontDirectory = join(REPO, 'packages', 'report-engine', 'assets', 'fonts');
const pdf = await renderPdf(reportModel, {
  fonts: {
    regular: new Uint8Array(readFileSync(join(fontDirectory, 'Pretendard-Regular.ttf'))),
    bold: new Uint8Array(readFileSync(join(fontDirectory, 'Pretendard-Bold.ttf'))),
  },
});

// ---------------------------------------------------------------------------
// 10 · The record
// ---------------------------------------------------------------------------

const roleOf = (dimension: PrintedDimension): 'primary' | 'consistent' | 'inconsistent' =>
  dimension.label === primary.label
    ? 'primary'
    : agreement.inconsistent.includes(dimension)
      ? 'inconsistent'
      : 'consistent';

const verification: DrawingVerification = {
  version: VERIFICATION_VERSION,
  drawingId: DRAWING_ID,
  sha256,
  verifiedAt: NOW,
  observer: verificationObserver,
  page: {
    widthPt: page.widthPt,
    heightPt: page.heightPt,
    sheetSize: actualSheetSize,
    claimedSheetSize: TITLE_BLOCK.claimedSheetSize,
    renderDpi,
    pixelWidth,
    pixelHeight,
  },
  dimensions: printed.map((dimension) => ({
    label: dimension.label,
    statedMm: dimension.statedMm,
    measuredPt: dimension.measuredPt,
    impliedScale: dimension.impliedScale,
    role: roleOf(dimension),
    from: toPixel(dimension.from),
    to: toPixel(dimension.to),
  })),
  calibration: {
    method: 'two-point',
    fromDimension: primary.label,
    pointA,
    pointB,
    knownDistanceMm: primary.statedMm,
    millimetresPerPixel: calibration.millimetresPerPixel,
  },
  crossCheck,
  mappingChecks,
  discrepancies,
  pipeline: {
    room: {
      lengthMm: roomLength,
      widthMm: yHigh - yLow,
      lengthSource: `printed dimension "${primary.label}"`,
      widthSource: 'calibrated measurement between wall inner faces',
    },
    placements: [
      {
        equipmentObjectId: bed.id,
        count: placements.filter((entry) => entry.equipmentObjectId === bed.id).length,
        footprint: { width: bed.planningFootprint.width, depth: bed.planningFootprint.depth },
      },
      {
        equipmentObjectId: machine.id,
        count: placements.filter((entry) => entry.equipmentObjectId === machine.id).length,
        footprint: {
          width: machine.planningFootprint.width,
          depth: machine.planningFootprint.depth,
        },
      },
    ],
    evaluation: {
      red: evaluation.counts.RED ?? 0,
      yellow: evaluation.counts.YELLOW ?? 0,
      green: evaluation.counts.GREEN ?? 0,
      reasonCodes: [...new Set(evaluation.results.map((result) => result.reasonCode))].sort(),
    },
    optimiser: {
      proposals: ranked.layouts.length,
      resolvedCount: ranked.resolvedStationCount,
      emptyReason:
        ranked.layouts.length > 0
          ? null
          : ranked.rejected.length > 0
            ? 'no_position_satisfies_rules'
            : 'room_too_small',
    },
    installationPlan: {
      stages: installationPlan.stages.length,
      blockers: installationPlan.blockers.length,
    },
    report: {
      reportVersion: reportModel.reportVersion,
      overallVerdict: reportModel.summary.verdict,
      pdfBytes: pdf.length,
    },
  },
};

// ---------------------------------------------------------------------------
// 11 · The observations, so the knowledge base learns from the verification
// ---------------------------------------------------------------------------

/*
 * > Owner decision: *"Record every measured value as an observation with its source and SHA-256 of
 * > the drawing."*
 *
 * Two readings survive into the knowledge base, and the difference between them is the point:
 *
 * - the **station pitch** is printed on the drawing, so it carries `dimension_line` and high
 *   confidence — the drawing states it and the geometry agrees with it to 0.004 %;
 * - the **hall width** is not printed anywhere, so it carries `calibrated_measurement` and medium
 *   confidence, and its note says how far it can be trusted.
 *
 * The `3000` label contributes nothing. A dimension whose text disagrees with its own geometry is
 * not evidence of anything, and a knowledge base is exactly where a wrong number does the most
 * quiet damage.
 */
const drawing = {
  datasetId: 'dialysis-drawings',
  drawingId: DRAWING_ID,
  path: DRAWING_ID,
  sheet: null,
  revision: null,
  sha256,
};
const observedBy = {
  drawing,
  observer: verificationObserver,
  observationDate: NOW.slice(0, 10),
} as const;

/** Half the worst mapping-check deviation, in millimetres at this room's width — a real bound. */
const worstDeviation = mappingChecks.reduce(
  (worst, check) => Math.max(worst, Math.abs(check.deviationFraction)),
  0,
);
const widthUncertaintyMm = Math.ceil((yHigh - yLow) * worstDeviation);

const observations = {
  datasetId: 'dialysis-drawings',
  observations: [
    {
      id: `${DRAWING_ID}#station_pitch`,
      source: {
        ...observedBy,
        method: 'dimension_line' as const,
        confidence: 'high' as const,
        note:
          `Printed as "${pitchDimension.label}" (베드 간격). Its geometry measures ` +
          `${(pitchDimension.measuredPt * 25.4 * agreement.scale / 72).toFixed(0)} mm at the sheet's ` +
          `established scale, so the label and the line agree.`,
      },
      value: {
        kind: 'common_dimension' as const,
        name: 'station_pitch' as const,
        millimetres: pitchDimension.statedMm,
        roomFunction: 'hemodialysis_treatment' as const,
      },
    },
    {
      id: `${DRAWING_ID}#treatment_room_width`,
      source: {
        ...observedBy,
        method: 'calibrated_measurement' as const,
        // Medium, and it cannot honestly be higher: nothing on the drawing states this number.
        confidence: 'medium' as const,
        note:
          'Not printed on the drawing. Measured between the inner faces of the two ' +
          `${room.wallThicknessMm.map((thickness) => Math.round(thickness)).join(' mm and ')} mm walls on a ` +
          "cross-section at mid-hall, against the scale established from the sheet's own dimension " +
          `lines. Good to about ±${widthUncertaintyMm} mm — the worst deviation any printed dimension ` +
          'showed against that scale, applied at this width.',
      },
      value: {
        kind: 'common_dimension' as const,
        name: 'treatment_room_width' as const,
        millimetres: Math.round(yHigh - yLow),
        roomFunction: 'hemodialysis_treatment' as const,
      },
    },
  ],
};

writeFileSync(
  join(REPO, 'knowledge', 'observations', 'hospital-044-verification.json'),
  `${JSON.stringify(observations, null, 2)}\n`,
);

const outputDirectory = join(REPO, 'knowledge', 'verification');
mkdirSync(outputDirectory, { recursive: true });
const outputPath = join(
  outputDirectory,
  `${DRAWING_ID.replace(/[/\\]/g, '-').replace(/\.pdf$/i, '')}.json`,
);
writeFileSync(outputPath, `${JSON.stringify(verification, null, 2)}\n`);

console.log(`${DRAWING_ID}  sha256 ${sha256.slice(0, 12)}…`);
console.log(`  scale from "${primary.label}": 1:${agreement.scale.toFixed(3)}  (${calibration.millimetresPerPixel.toFixed(5)} mm/px)`);
if (crossCheck) {
  console.log(
    `  printed ${crossCheck.statedRatio}: ${crossCheck.millimetresPerPixel.toFixed(5)} mm/px  ` +
      `→ ${(crossCheck.deviationFraction * 100).toFixed(3)} %  ${crossCheck.agrees ? 'agrees' : 'DISAGREES'}`,
  );
}
for (const check of mappingChecks) {
  console.log(
    `  mapping check ${check.label.padStart(7)} → ${check.mappedMm.toFixed(1).padStart(9)} mm  ` +
      `(${(check.deviationFraction * 100).toFixed(3)} %)`,
  );
}
console.log(`  room ${roomLength} × ${Math.round(yHigh - yLow)} mm`);
console.log(
  `  evaluation  RED ${verification.pipeline.evaluation.red}  YELLOW ${verification.pipeline.evaluation.yellow}  GREEN ${verification.pipeline.evaluation.green}`,
);
console.log(`  optimiser   ${ranked.layouts.length} proposals for ${ranked.resolvedStationCount} stations`);
console.log(
  `  plan        ${installationPlan.stages.length} stages, ${installationPlan.blockers.length} blockers`,
);
console.log(`  report      ${reportModel.summary.verdict}, ${pdf.length} bytes of PDF`);
for (const discrepancy of discrepancies) {
  console.log(`\n  ${discrepancy.code}  ${discrepancy.subject}\n    ${discrepancy.detail}`);
}
console.log(`\nwritten: ${outputPath.slice(REPO.length + 1)}`);
