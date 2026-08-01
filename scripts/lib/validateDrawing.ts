import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { dialysisScoringModel } from '../../packages/ai-contract/scoring/index';
import { rankLayouts } from '../../packages/ai-local/src/rank';
import { pixelToModel } from '../../packages/cad-engine/src/planTransform';
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
} from '../../packages/document-model/src/index';
import { dialysisKnowledge } from '../../packages/layout-knowledge/knowledge/index';
import {
  readPrintedDimensions,
  readPrintedScale,
  reconcileScale,
  sheetSizeOf,
  type Observation,
  type PrintedDimension,
} from '../../packages/layout-knowledge/src/index';
import {
  VERIFICATION_VERSION,
  type DiscrepancyClass,
  type DrawingVerification,
  type VerificationDiscrepancy,
} from '../../packages/layout-knowledge/src/verification';
import { catalog } from '../../packages/object-library/catalog/index';
import { evaluate } from '../../packages/rule-engine/src/evaluate';
import { dialysisRuleSet } from '../../packages/rule-engine/rules/index';

import { measureRoomWidth } from './hallGeometry';
import { readPageGeometry } from './pdfGeometry';

/**
 * How far out a printed dimension may be and still be a **draughting** error rather than ours.
 *
 * > Owner decision, the five-way discrepancy taxonomy: a discrepancy is filed against the drawing
 * > or against this reader, never vaguely against both.
 *
 * Ten per cent. A draughtsman typing a round number over an awkward one is out by a few per cent;
 * a label an order of magnitude out is this reader having paired it with the wrong line, and filing
 * that against the drawing would blame a hospital for our own mistake.
 *
 * Extracted because the same `0.1` was written twice — once to exclude outliers from the
 * calibration and once to classify them — and two copies of a taxonomy boundary is one edit away
 * from a discrepancy being excluded under one rule and reported under another. The audit found the
 * classification unguarded: reclassifying every `drawing_error` as `extraction_error` left the
 * whole suite green.
 */
export const TEXT_OVERRIDE_TOLERANCE = 0.1;

export function isTextOverride(relativeError: number): boolean {
  return Math.abs(relativeError) <= TEXT_OVERRIDE_TOLERANCE;
}


/**
 * One drawing, all the way through, or as far as the evidence carries it.
 *
 * > Owner decision, validation programme: *"For every drawing: import the original PDF · perform
 * > calibration using dimension lines whenever available · use printed scale only as a fallback ·
 * > verify coordinate mapping · generate placements · run the rule engine · run the optimiser ·
 * > generate the planning workflow · generate the final report."*
 *
 * One implementation, two callers. `scripts/verify-drawing.ts` runs it on a single sheet and writes
 * the full record; `scripts/validate-corpus.ts` runs it on every sheet and writes a ledger row for
 * each. A second implementation would let the two disagree about what a drawing is worth, and the
 * one that ran less often would be the one that was wrong.
 *
 * ## Stopping is a result, not an error
 *
 * Most drawings do not reach the end, and that is the point of running them. Every stop names the
 * stage it happened at and carries a classified discrepancy, so *"58 sheets carry fewer than two
 * readable dimensions"* is a finding rather than a stack trace. Nothing here substitutes a default
 * for a measurement it could not take.
 */

/** The stages of the validation programme, in the order the owner listed them. */
export const VALIDATION_STAGES = [
  /** Read the file, confirm it is the one the catalogue hashed, and read its page. */
  'import',
  /** Establish a scale — dimension lines first, printed scale only as a fallback. */
  'calibrate',
  /** Reproduce the sheet's other printed dimensions through the finished mapping. */
  'verify_mapping',
  /** Establish the room the equipment goes in. */
  'room',
  /** Generate placements. */
  'place',
  'rules',
  'optimise',
  'plan',
  'report',
] as const;
export type ValidationStage = (typeof VALIDATION_STAGES)[number];

export interface ValidationInput {
  readonly repo: string;
  readonly datasetRoot: string;
  readonly drawingId: string;
  readonly page?: number;
  readonly now: string;
  /**
   * What a person read in the title block, when a person has read it.
   *
   * Left undefined, both are read from the sheet's own text by {@link readPrintedScale} — which is
   * still the drawing speaking, not an inference. A person's reading overrides it, because a title
   * block plotted as geometry rather than as text cannot be read at all and only a person can say
   * what it shows.
   */
  readonly titleBlock?: {
    readonly claimedSheetSize: string | null;
    readonly statedRatio: string | null;
  };
  /**
   * How a person confirmed the measured rectangle is the treatment room.
   *
   * Without it the run stops at `room`. Nothing here can establish a room: the length is the
   * sheet's longest printed dimension and the width is the outermost wall pair across it, and on
   * most sheets one or both belongs to the building. Letting the pipeline proceed on that produced
   * six "completed" validations over rooms of 4.1 × 5.3 m and 15.6 × 14.2 m that no drawing states —
   * which is the same mistake as the room-width rule and the 41 % recommendation, arriving a third
   * time.
   *
   * The measurement stays automatic. The **acceptance** is a person's, because evidence beats
   * automation and there is no evidence here yet.
   */
  readonly roomCorroboration?: string;
}

export interface ValidationOutcome {
  readonly drawingId: string;
  readonly sha256: string;
  readonly page: number;
  /** The last stage that completed. */
  readonly reached: ValidationStage;
  /** Where it stopped, or null when the whole programme ran. */
  readonly stoppedAt: ValidationStage | null;
  readonly discrepancies: readonly VerificationDiscrepancy[];
  /** The full record — only when every stage completed. */
  readonly verification: DrawingVerification | null;
  /** Observations the run is prepared to stand behind. Empty unless it completed. */
  readonly observations: readonly Observation[];
}

/** The importer's constants, mirrored so this predicts exactly what the application will do. */
const PDF_RENDER_DPI = 150;
const MAX_PLAN_PIXELS = 4_096;

/** Beyond this the calibrated scale and the printed scale are reported as disagreeing. */
const CROSS_CHECK_TOLERANCE = 0.01;

/**
 * What a hemodialysis room's clear width can be, millimetres.
 *
 * A filter, never a value. `measureRoomWidth` takes the outermost wall pair on a cross-section,
 * which is the treatment room's own walls only where that room spans its building. Elsewhere it is
 * the building's exterior wall, and the answer is a real distance across the wrong thing — 11 to
 * 14 m where the one drawing with a known answer is 7.4 m. Readings outside this band are
 * **discarded and reported**, never adjusted towards it.
 *
 * The proper fix is room identification, which is the next engineering milestone. Until it exists
 * this band is what stops a building width entering the record wearing a room's name.
 */
const PLAUSIBLE_ROOM_WIDTH_MM = { minimum: 2_500, maximum: 15_000 } as const;

/**
 * What a hemodialysis room's clear length can be, millimetres.
 *
 * The counterpart the width band went without, and its absence was doing real damage. The room's
 * length is taken from the sheet's **longest printed dimension**, which is the room's own length on
 * a drawing where the room spans its building and is the *building's* length everywhere else. With
 * only the width guarded, sheets whose longest dimension was 3.9 m or 15.6 m reached placement with
 * a room rectangle that no drawing states; only the accident of the old pitch filter kept them out
 * of the ledger.
 *
 * A band is a filter and not a verification. What would actually establish the length is knowing
 * which walls end the room — the next milestone — and until then the run says so in a discrepancy
 * rather than printing an inference as a printed dimension.
 */
const PLAUSIBLE_ROOM_LENGTH_MM = { minimum: 4_000, maximum: 40_000 } as const;

const BED_ID = 'dialysis_bed';
const MACHINE_ID = 'vantive_ak98';
const STATIONS_PER_ROW = 5;

export const VALIDATION_OBSERVER = {
  type: 'ai' as const,
  name: 'MFD Drawing Verification Harness',
  version: '1.0',
};

interface DatasetDrawing {
  drawingId: string;
  path: string;
  format: string;
  role: string;
  sha256: string;
  classification: string;
  pageCount: number;
}

function stop(
  outcome: Omit<ValidationOutcome, 'verification' | 'observations' | 'stoppedAt'> & {
    stoppedAt: ValidationStage;
  },
): ValidationOutcome {
  return { ...outcome, verification: null, observations: [] };
}

function discrepancy(
  code: VerificationDiscrepancy['code'],
  classification: DiscrepancyClass,
  subject: string,
  detail: string,
): VerificationDiscrepancy {
  // `resolved` is always false: a run reports what it found, and reporting is not fixing.
  return { code, classification, subject, detail, resolved: false };
}

export async function validateDrawing(input: ValidationInput): Promise<ValidationOutcome> {
  const pageIndex = input.page ?? 0;
  const dataset = JSON.parse(
    readFileSync(join(input.repo, 'knowledge', 'dataset.json'), 'utf8'),
  ) as { drawings: DatasetDrawing[] };
  const catalogued = dataset.drawings.find((entry) => entry.drawingId === input.drawingId);
  if (!catalogued) throw new Error(`${input.drawingId} is not in knowledge/dataset.json`);

  const base = { drawingId: input.drawingId, page: pageIndex };
  const discrepancies: VerificationDiscrepancy[] = [];

  // ── import ───────────────────────────────────────────────────────────────────
  const bytes = readFileSync(join(input.datasetRoot, catalogued.path));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== catalogued.sha256) {
    // The catalogue's hash and the file's hash are the only link between a measurement and the
    // bytes it was taken from. Continuing would attribute this run's figures to a drawing it did
    // not read.
    return stop({
      ...base,
      sha256,
      reached: 'import',
      stoppedAt: 'import',
      discrepancies: [
        discrepancy(
          'VD-5',
          'extraction_error',
          'file hash',
          `The file has changed since it was catalogued: catalogued ${catalogued.sha256}, actual ${sha256}.`,
        ),
      ],
    });
  }

  if (catalogued.format !== 'pdf' || catalogued.classification !== 'vector_cad_export') {
    return stop({
      ...base,
      sha256,
      reached: 'import',
      stoppedAt: 'import',
      discrepancies: [
        discrepancy(
          'VD-6',
          'unsupported_drawing',
          `${catalogued.format} / ${catalogued.classification}`,
          catalogued.format !== 'pdf'
            ? 'Native CAD is refused by name at import — reading DWG is a different product ' +
                'decision, not a missing feature.'
            : 'A scan carries no vector content: there is no dimension line to measure and no ' +
                'text to read. Rasterising it and measuring the pixels is not measuring.',
        ),
      ],
    });
  }

  let geometry;
  try {
    geometry = await readPageGeometry(join(input.datasetRoot, catalogued.path), pageIndex);
  } catch (cause) {
    return stop({
      ...base,
      sha256,
      reached: 'import',
      stoppedAt: 'import',
      discrepancies: [
        discrepancy(
          'VD-6',
          'unsupported_drawing',
          'page could not be read',
          cause instanceof Error ? cause.message : 'pdf.js refused the file',
        ),
      ],
    });
  }

  // ── calibrate ────────────────────────────────────────────────────────────────
  const printed = readPrintedDimensions(geometry.segments, geometry.texts);
  const agreement = reconcileScale(printed);
  if (!agreement) {
    return stop({
      ...base,
      sha256,
      reached: 'import',
      stoppedAt: 'calibrate',
      discrepancies: [
        discrepancy(
          'VD-7',
          'insufficient_evidence',
          'no scale can be established',
          `${printed.length} printed dimension(s) could be read, and reconciling a sheet needs at ` +
            'least two that agree. One dimension is not an agreement: it may itself be a text ' +
            'override, and nothing on the sheet would contradict it. Calibration required.',
        ),
      ],
    });
  }

  /*
   * How much of a sheet may disagree with its own median before its scale is not believed.
   *
   * Reconciling a sheet assumes it has **one** scale, and plenty do not: a plan at 1:100 beside a
   * detail at 1:20 gives two internally consistent groups, and the reconciler picks whichever is
   * larger and calls the other wrong. Two agreeing dimensions is enough to compute a median and
   * nowhere near enough to trust one.
   *
   * The threshold is what separates *one overridden dimension* from *a sheet this reader has not
   * understood*. Hospital_044 has one of seven out — 14 % — with everything else inside 0.06 %. The
   * sheets this rejects have a third of their dimensions out and implied scales spanning three
   * orders of magnitude, which is not a drawing disagreeing with itself.
   */
  const readable = agreement.consistent.length + agreement.inconsistent.length;
  const disagreeingFraction = agreement.inconsistent.length / readable;
  if (agreement.consistent.length < 4 || disagreeingFraction > 0.2) {
    /*
     * Whose fault it is depends on how far out the outliers are. A few per cent is a drawing that
     * disagrees with itself; an order of magnitude is this reader pairing labels with the wrong
     * lines. Classified by which of the two the majority of them are, rather than by a guess.
     */
    const wild = agreement.inconsistent.filter(
      (entry) => !isTextOverride(entry.impliedScale / agreement.scale - 1),
    ).length;
    return stop({
      ...base,
      sha256,
      reached: 'import',
      stoppedAt: 'calibrate',
      discrepancies: [
        discrepancy(
          'VD-7',
          wild > agreement.inconsistent.length / 2 ? 'extraction_error' : 'insufficient_evidence',
          'the sheet does not agree with itself on one scale',
          `${agreement.consistent.length} of ${readable} readable dimensions agree on 1:${agreement.scale.toFixed(2)}; ` +
            `${agreement.inconsistent.length} do not, ${wild} of them by more than 10 %. A scale is not established, ` +
            'and calibrating from one of two disagreeing groups would measure the whole sheet ' +
            'against a detail view. Calibration required.',
        ),
      ],
    });
  }

  for (const outlier of agreement.inconsistent) {
    const drawnMm = (outlier.measuredPt * 25.4 * agreement.scale) / 72;
    const outBy = outlier.impliedScale / agreement.scale - 1;
    /*
     * The same symptom with two different owners, and the magnitude tells them apart. A draftsman
     * typing a round number over an awkward one is out by a few per cent. A label reported an order
     * of magnitude out is this reader having paired it with the wrong line — a fact about the
     * reader, and it would be dishonest to file it against the drawing.
     */
    const isOverride = isTextOverride(outBy);
    discrepancies.push(
      discrepancy(
        'VD-1',
        isOverride ? 'drawing_error' : 'extraction_error',
        `printed dimension "${outlier.label}"`,
        `The label states ${outlier.statedMm.toLocaleString('en')} mm; the geometry beneath it measures ` +
          `${Math.round(drawnMm).toLocaleString('en')} mm at the sheet's scale of 1:${agreement.scale.toFixed(2)} ` +
          `(implied 1:${outlier.impliedScale.toFixed(2)}, ${(outBy * 100).toFixed(2)} % out). ` +
          (isOverride
            ? 'Consistent with a manual text override in the CAD file. Excluded from the ' +
              'calibration and from the knowledge base, and not corrected — a dimension text that ' +
              'disagrees with its own geometry is a question for whoever holds the drawing.'
            : 'Too far out to be an override: this reader has paired the label with the wrong ' +
              'line. Excluded, and recorded against the reader rather than against the drawing.'),
      ),
    );
  }

  const baseWidthPx = (geometry.widthPt / 72) * PDF_RENDER_DPI;
  const baseHeightPx = (geometry.heightPt / 72) * PDF_RENDER_DPI;
  const cap = Math.min(1, MAX_PLAN_PIXELS / Math.max(baseWidthPx, baseHeightPx));
  const renderDpi = PDF_RENDER_DPI * cap;
  const pixelWidth = Math.round(baseWidthPx * cap);
  const pixelHeight = Math.round(baseHeightPx * cap);
  const pxPerPt = renderDpi / 72;
  const toPixel = (point: { x: number; y: number }) => ({
    x: point.x * pxPerPt,
    y: point.y * pxPerPt,
  });

  const readScale = readPrintedScale(geometry.texts);
  const claimedSheetSize =
    input.titleBlock?.claimedSheetSize ?? readScale?.claimedSheetSize ?? null;
  const statedRatio = input.titleBlock?.statedRatio ?? (readScale ? `1:${readScale.ratio}` : null);
  const actualSheetSize = sheetSizeOf(geometry.widthPt, geometry.heightPt);

  if (
    claimedSheetSize !== null &&
    actualSheetSize !== null &&
    claimedSheetSize !== actualSheetSize
  ) {
    discrepancies.push(
      discrepancy(
        'VD-3',
        'drawing_error',
        'title block paper size',
        `The title block claims ${claimedSheetSize}; the page is ${actualSheetSize}. The ` +
          'printed-scale route is refused for this sheet — the ratio describes a different sheet ' +
          'from the file in front of us.',
      ),
    );
  }
  const paperSizeAgrees =
    claimedSheetSize === null || actualSheetSize === null || claimedSheetSize === actualSheetSize;

  /*
   * Dimension line first, always — Owner decision Q-4 and the validation programme both. The printed
   * scale is run afterwards as a comparison, never as the source, and is refused outright on a sheet
   * whose title block names a paper size the file is not.
   */
  const primary = agreement.primary;
  const pointA = toPixel(primary.from);
  const pointB = toPixel(primary.to);
  const calibration = calibrateFromTwoPoints({
    pointA,
    pointB,
    knownDistance: primary.statedMm,
    now: input.now,
  });
  if (!calibration) {
    return stop({
      ...base,
      sha256,
      reached: 'import',
      stoppedAt: 'calibrate',
      discrepancies: [
        ...discrepancies,
        discrepancy(
          'VD-7',
          'insufficient_evidence',
          'degenerate calibration',
          'The primary dimension produced no usable scale.',
        ),
      ],
    });
  }

  const stated =
    statedRatio !== null && paperSizeAgrees
      ? calibrateFromStatedRatio({ statedRatio, dotsPerInch: renderDpi, now: input.now })
      : null;
  const crossCheck = stated
    ? {
        statedRatio: statedRatio!,
        millimetresPerPixel: stated.millimetresPerPixel,
        deviationFraction: calibration.millimetresPerPixel / stated.millimetresPerPixel - 1,
        agrees:
          Math.abs(calibration.millimetresPerPixel / stated.millimetresPerPixel - 1) <=
          CROSS_CHECK_TOLERANCE,
      }
    : null;
  if (crossCheck && !crossCheck.agrees) {
    discrepancies.push(
      discrepancy(
        'VD-2',
        // The calibration rests on dimensions that agree with each other; if they and the title
        // block disagree, it is the title block that is wrong about this file.
        'drawing_error',
        'calibrated scale versus printed scale',
        `Dimension-line calibration gives ${calibration.millimetresPerPixel.toFixed(5)} mm/px; the ` +
          `printed ${crossCheck.statedRatio} at ${renderDpi} dpi gives ` +
          `${crossCheck.millimetresPerPixel.toFixed(5)} mm/px, a difference of ` +
          `${(crossCheck.deviationFraction * 100).toFixed(2)} %.`,
      ),
    );
  }

  // ── verify_mapping ───────────────────────────────────────────────────────────
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

  // ── room ─────────────────────────────────────────────────────────────────────
  const measured = measureRoomWidth(geometry.segments, primary, agreement.scale);
  const roomWidthMm = measured ? Math.round(measured.widthMm) : null;
  if (
    !measured ||
    roomWidthMm === null ||
    roomWidthMm < PLAUSIBLE_ROOM_WIDTH_MM.minimum ||
    roomWidthMm > PLAUSIBLE_ROOM_WIDTH_MM.maximum
  ) {
    return stop({
      ...base,
      sha256,
      reached: 'verify_mapping',
      stoppedAt: 'room',
      discrepancies: [
        ...discrepancies,
        discrepancy(
          'VD-4',
          'insufficient_evidence',
          'treatment room could not be established',
          measured === null
            ? 'No pair of parallel same-colour lines at a plausible wall thickness crosses the ' +
              'sheet at mid-room, so the room has no measurable width. Measurement unavailable.'
            : `The measured width, ${roomWidthMm} mm, is outside what a treatment room can be. The ` +
              'outermost wall pair on this sheet is the building\'s exterior wall rather than the ' +
              'room\'s, which is what happens wherever the treatment room does not span its ' +
              'building. Discarded rather than used. Room identification is the missing piece.',
        ),
      ],
    });
  }

  if (!input.roomCorroboration) {
    return stop({
      ...base,
      sha256,
      reached: 'verify_mapping',
      stoppedAt: 'room',
      discrepancies: [
        ...discrepancies,
        discrepancy(
          'VD-4',
          'insufficient_evidence',
          'the treatment room’s extent is not established',
          'The sheet does not state its treatment room\'s extent, and nothing in this pipeline can ' +
            "derive it: the length would be the sheet's longest printed dimension and the width the " +
            'outermost wall pair across it, and on most sheets one or both is a dimension of the ' +
            'building rather than the room. A person must confirm the rectangle before anything is ' +
            'placed in it. Room identification is the next engineering milestone; until it exists ' +
            'this is where a drawing stops.',
        ),
      ],
    });
  }

  const roomLengthMm = primary.statedMm;
  if (
    roomLengthMm < PLAUSIBLE_ROOM_LENGTH_MM.minimum ||
    roomLengthMm > PLAUSIBLE_ROOM_LENGTH_MM.maximum
  ) {
    return stop({
      ...base,
      sha256,
      reached: 'verify_mapping',
      stoppedAt: 'room',
      discrepancies: [
        ...discrepancies,
        discrepancy(
          'VD-4',
          'insufficient_evidence',
          'treatment room could not be established',
          `The sheet's longest printed dimension is ${roomLengthMm.toLocaleString('en')} mm, which is not a ` +
            'length a treatment room has. It is a dimension of something else on the sheet, and ' +
            'nothing here knows which walls end the room. Discarded rather than used.',
        ),
      ],
    });
  }

  discrepancies.push(
    discrepancy(
      'VD-4',
      'insufficient_evidence',
      'the room’s extent is inferred, not stated',
      `Neither the room's length nor its width is printed as such. The length used below, ` +
        `${roomLengthMm.toLocaleString('en')} mm, is the sheet's **longest printed dimension taken as the ` +
        "room's extent** — true of the reference drawing, where that dimension's extension lines do " +
        'bound the hall, and unverified on any other sheet. Establishing it needs to know which ' +
        'walls end the room, which is the room-understanding milestone. Recorded so that no reader ' +
        'takes the rectangle below for something the drawing states.',
    ),
  );

  discrepancies.push(
    discrepancy(
      'VD-4',
      'insufficient_evidence',
      'room width is not printed',
      `The drawing dimensions the room along its length (${primary.statedMm.toLocaleString('en')} mm) but ` +
        `not across it. The width used below, ${roomWidthMm.toLocaleString('en')} mm, is a calibrated ` +
        `measurement between the inner faces of the two walls ` +
        `(${measured.wallThicknessMm.map((t) => Math.round(t)).join(' mm and ')} mm thick), not a printed ` +
        'dimension. It carries the weaker `calibrated_measurement` method wherever it is recorded, ' +
        'and a printed dimension would supersede it.',
    ),
  );

  // ── place ────────────────────────────────────────────────────────────────────
  const bed = catalog.require(BED_ID);
  const machine = catalog.require(MACHINE_ID);

  /*
   * The spacing the demonstration layout is built on — **derived from the two planning footprints,
   * and nothing else.**
   *
   * It was the literal 2,000 mm, used twice: as a filter deciding whether a sheet could proceed, and
   * then written back out as an observed `station_pitch`. That made the observation circular — a
   * drawing could only complete if it already printed 2,000, so the reading could never have come
   * out otherwise — and it put an engineering figure in the source, which `CLAUDE.md` forbids.
   *
   * Taking the corpus's observed median instead was tried and is worse: 1,700 mm is narrower than a
   * 1,000 mm bed beside an 800 mm machine, so the layout collided with itself and the engines spent
   * their time reporting an artefact of the harness. It would also have dressed a descriptive figure
   * as a design decision, which is the one thing `knowledge/` must never become.
   *
   * So the pitch is the width the two footprints occupy side by side. It is not a requirement, not
   * an observation, and not a recommendation — it is the smallest spacing at which the equipment
   * this run places physically fits, computed from the catalogue records themselves. Nothing is
   * recorded about pitch in return.
   */
  const pitchMm = bed.planningFootprint.width + machine.planningFootprint.width;

  /*
   * Square the drawing — step 4 of the plan wizard. Plans are plotted at an angle far more often
   * than not; without this every clearance would be measured at that angle. Exact millidegrees,
   * because `radiansToMillidegrees` in `@mfd/cad-engine` rounds to whole degrees, which on a 17.6 m
   * room would leave about 84 mm of skew.
   */
  const angle = Math.atan2(primary.to.y - primary.from.y, primary.to.x - primary.from.x);
  const rotation = -Math.round((angle * 180 * 1000) / Math.PI);

  let document: MfdDocument = createDocument({
    projectId: `${input.drawingId.replace(/[^\w-]/g, '-')}-validation`,
    name: `${input.drawingId} validation`,
    now: input.now,
    ruleSetRef: { id: dialysisRuleSet.id, version: dialysisRuleSet.version },
  });
  const levelId = document.project.levels[0]!.id;
  document = setPlanImage(document, levelId, {
    sourceFormat: 'pdf',
    sourceFileName: input.drawingId,
    pageIndex,
    pixelWidth,
    pixelHeight,
    /*
     * A one-pixel placeholder, and it is deliberate.
     *
     * The drawings are a hospital's property and are not stored in this repository, so this document
     * is built to be measured against rather than shipped. Nothing downstream reads these pixels:
     * the rule engine asks only whether a plan exists and is calibrated, and the report defaults to
     * vector rendering. `tests/e2e/hospital044.spec.ts` puts the real PDF through the application's
     * own importer and checks it produces the page size, resolution and scale this predicts, which
     * is where the raster is actually exercised.
     */
    dataUrl:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgDTD2qgAAAAASUVORK5CYII=',
    renderDpi,
    importedAt: input.now,
  });
  document = setCoordinateMapping(document, levelId, {
    ...calibration,
    origin: pointA,
    rotation,
  });

  const transform = planTransformOf(document.project.levels[0]!);
  if (!transform) throw new Error('the level did not come out calibrated');

  const wallLow = pixelToModel(transform, toPixel(measured.from));
  const wallHigh = pixelToModel(transform, toPixel(measured.to));
  const yLow = Math.min(wallLow.y, wallHigh.y);
  const yHigh = Math.max(wallLow.y, wallHigh.y);

  const boundary: Boundary = {
    id: 'boundary-room',
    kind: 'space_outline',
    vertices: [
      { x: 0, y: yLow },
      { x: roomLengthMm, y: yLow },
      { x: roomLengthMm, y: yHigh },
      { x: 0, y: yHigh },
    ],
    label: '투석실 / Dialysis room',
    obstructionType: null,
  };

  const placements: Placement[] = [];
  for (let row = 0; row < 2; row += 1) {
    for (let index = 0; index < STATIONS_PER_ROW; index += 1) {
      const x = index * pitchMm;
      placements.push({
        id: `bed-${row}-${index}`,
        equipmentObjectId: bed.id,
        equipmentObjectVersion: bed.version,
        transform: {
          position: { x, y: row === 0 ? yLow : yHigh - bed.planningFootprint.depth },
          rotation: 0,
          mirrored: false,
        },
        label: `Bed ${row * STATIONS_PER_ROW + index + 1}`,
        spaceId: 'space-room',
      });
      placements.push({
        id: `ak98-${row}-${index}`,
        equipmentObjectId: machine.id,
        equipmentObjectVersion: machine.version,
        transform: {
          position: {
            x: x + bed.planningFootprint.width,
            y: row === 0 ? yLow : yHigh - machine.planningFootprint.depth,
          },
          rotation: 0,
          mirrored: false,
        },
        label: `AK98 ${row * STATIONS_PER_ROW + index + 1}`,
        spaceId: 'space-room',
      });
    }
  }

  const level: Level = {
    ...document.project.levels[0]!,
    boundaries: [boundary],
    spaces: [
      {
        id: 'space-room',
        name: '투석실 / Dialysis room',
        function: 'hemodialysis_treatment',
        boundaryId: boundary.id,
      },
    ],
    placements,
  };
  document = { ...document, project: { ...document.project, levels: [level] } };

  // ── rules ────────────────────────────────────────────────────────────────────
  const evaluation = evaluate({
    placements: level.placements,
    catalog,
    ruleSet: dialysisRuleSet,
    spatial: { boundaries: level.boundaries, planStatus: 'calibrated' },
  });

  /*
   * A self-check on the rule engine's own output, and it is here because it once fired.
   *
   * A finding that says a machine extends beyond the room is checkable: if every corner of its
   * footprint is inside the room, the finding contradicts itself. Recomputing that from the same
   * geometry the evaluator used is what turns "the report says RED" into something a validation run
   * can challenge rather than transcribe. It caught the containment defect (VD-5, fixed by owner
   * decision A-4) and it stays because the next one will not announce itself either.
   */
  const { polygonContains } = await import('../../packages/cad-engine/src/index');
  const { footprintCorners } = await import('../../packages/object-library/src/geometry');
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
    discrepancies.push(
      discrepancy(
        'VD-5',
        'algorithm_defect',
        'rule engine — containment contradicts its own geometry',
        `${contradicted.length} of ${evaluation.results.length} findings report equipment as extending ` +
          'beyond the room outline while every corner of that equipment is inside the outline.',
      ),
    );
  }

  // ── optimise ─────────────────────────────────────────────────────────────────
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

  // ── plan ─────────────────────────────────────────────────────────────────────
  const { runPlanner } = await import('../../apps/web/src/features/planning/runPlanner');
  const installationPlan = runPlanner({
    projectId: document.project.id,
    document,
    level,
    spaceId: 'space-room',
    catalog,
    ruleSet: dialysisRuleSet,
    evaluation,
    optimisation: null,
    generatedAt: input.now,
  });

  // ── report ───────────────────────────────────────────────────────────────────
  const { buildReport } = await import('../../packages/report-engine/src/build');
  const { dialysisChecklistTemplate } = await import(
    '../../packages/report-engine/checklists/index'
  );
  const reportModel = buildReport({
    document,
    catalog,
    ruleSet: dialysisRuleSet,
    checklistTemplate: dialysisChecklistTemplate,
    generatedAt: input.now,
    mfdVersion: 'validation',
    installationPlan,
  });
  const { renderPdf } = await import('../../packages/report-engine/src/render/pdf');
  const fonts = join(input.repo, 'packages', 'report-engine', 'assets', 'fonts');
  const pdf = await renderPdf(reportModel, {
    fonts: {
      regular: new Uint8Array(readFileSync(join(fonts, 'Pretendard-Regular.ttf'))),
      bold: new Uint8Array(readFileSync(join(fonts, 'Pretendard-Bold.ttf'))),
    },
  });

  // ── the record ───────────────────────────────────────────────────────────────
  const roleOf = (dimension: PrintedDimension) =>
    dimension.label === primary.label
      ? ('primary' as const)
      : agreement.inconsistent.includes(dimension)
        ? ('inconsistent' as const)
        : ('consistent' as const);

  const verification: DrawingVerification = {
    version: VERIFICATION_VERSION,
    drawingId: input.drawingId,
    sha256,
    verifiedAt: input.now,
    observer: VALIDATION_OBSERVER,
    page: {
      widthPt: geometry.widthPt,
      heightPt: geometry.heightPt,
      sheetSize: actualSheetSize,
      claimedSheetSize,
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
        lengthMm: roomLengthMm,
        widthMm: yHigh - yLow,
        // Named for what it is. It is *a* printed dimension; that it is the **room's** length is an
        // inference this run cannot check, and VD-4 above says so.
        lengthSource: `longest printed dimension "${primary.label}", taken as the room's extent (inferred)`,
        widthSource: 'calibrated measurement between wall inner faces',
        corroboration: input.roomCorroboration,
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

  /*
   * The observations, and the difference between the two is the point: the station pitch is printed
   * on the sheet, so it carries `dimension_line` and high confidence; the room width is not printed
   * anywhere, so it carries `calibrated_measurement`, medium confidence, and a stated uncertainty.
   * Nothing that could not be justified directly from the drawing is stored at all.
   */
  const drawingRef = {
    datasetId: 'dialysis-drawings',
    drawingId: input.drawingId,
    path: catalogued.path,
    page: pageIndex,
    sheet: null,
    revision: null,
    sha256,
  };
  const worstDeviation = mappingChecks.reduce(
    (worst, check) => Math.max(worst, Math.abs(check.deviationFraction)),
    0,
  );
  /*
   * One observation, and there used to be two.
   *
   * `station_pitch` was dropped because it was circular: the run accepted a drawing only if it
   * printed 2,000 mm, then recorded 2,000 mm as what it had observed. A reading that could not have
   * come out otherwise is not evidence. The corpus already holds the pitch from 117 drawing files —
   * 24 facilities, which is the number that counts since owner decision D6 — whose
   * dimensions are *annotated* as a bed spacing — geometry alone cannot tell a pitch from any other
   * 2,000 mm dimension, and that naming is what makes those readings mean something.
   */
  const observations: Observation[] = [
    {
      id: `${input.drawingId}#treatment_room_width`,
      source: {
        drawing: drawingRef,
        method: 'calibrated_measurement',
        observer: VALIDATION_OBSERVER,
        observationDate: input.now.slice(0, 10),
        // Medium, and it cannot honestly be higher: nothing on the drawing states this number.
        confidence: 'medium',
        note:
          'Not printed on the drawing. Measured between the inner faces of the two ' +
          `${measured.wallThicknessMm.map((t) => Math.round(t)).join(' mm and ')} mm walls on a ` +
          "cross-section at mid-room, against the scale established from the sheet's own dimension " +
          `lines. Good to about ±${Math.ceil((yHigh - yLow) * worstDeviation)} mm — the worst deviation any ` +
          'printed dimension showed against that scale, applied at this width.',
      },
      value: {
        kind: 'common_dimension',
        name: 'treatment_room_width',
        millimetres: Math.round(yHigh - yLow),
        roomFunction: 'hemodialysis_treatment',
      },
    },
  ];

  return {
    ...base,
    sha256,
    reached: 'report',
    stoppedAt: null,
    discrepancies,
    verification,
    observations,
  };
}
