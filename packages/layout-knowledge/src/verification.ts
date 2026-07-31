import { z } from 'zod';

import { observerSchema } from './provenance';

/**
 * The record a drawing verification leaves behind.
 *
 * > Owner decision, Hospital_044: *"Record every measured value as an observation with its source
 * > and SHA-256 of the drawing. Do not invent any measurement. If any discrepancy is found between
 * > the drawing, calibration, optimisation and report, stop and report it before fixing it."*
 *
 * ## Why this is committed and the drawing is not
 *
 * The drawings are a hospital's property and live in `MFD-Hospital-Dataset`, outside this
 * repository. So a verification run has to leave something behind that outlives its inputs: every
 * measurement it took, the SHA-256 of the bytes it took them from, and what the pipeline then did
 * with them. `knowledge/verification/` holds that, and it is derived data — figures and hashes, no
 * drawing content.
 *
 * The practical consequence is that CI can check the verification without the dataset. It cannot
 * re-measure the drawing, but it can check that the record is internally coherent: that the
 * calibration follows from the dimension it names, that the mapping checks follow from the
 * calibration, and that nothing claims agreement it has not demonstrated. A record edited by hand
 * to make a verification look better fails those checks.
 *
 * ## Discrepancies are recorded, never resolved
 *
 * `discrepancies` is not a list of things that went wrong with the run. It is a list of things that
 * are wrong with the **drawing, or between the drawing and what the pipeline made of it** — and the
 * owner's instruction is to report them before fixing them. A record with entries here is a
 * successful verification that found something, which is the outcome the exercise is for.
 */

export const VERIFICATION_VERSION = 1;

/** What a printed dimension turned out to be worth once its geometry was measured. */
export const DIMENSION_ROLES = [
  /** The dimension the scale was taken from: the longest of the consistent set. */
  'primary',
  /** Agrees with the sheet's scale, so it is a check on the primary rather than a second source. */
  'consistent',
  /**
   * Does not agree.
   *
   * Kept, and kept visible. A label that disagrees with the line beneath it is usually a text
   * override — a draftsman typing a round number over an awkward one — and it is exactly the kind
   * of thing a person scaling off a drawing needs to be told about.
   */
  'inconsistent',
] as const;
export type DimensionRole = (typeof DIMENSION_ROLES)[number];

const finite = z.number().finite();
const positive = z.number().finite().positive();
const pixel = z.strictObject({ x: finite, y: finite });

export const verifiedDimensionSchema = z.strictObject({
  /** Exactly as printed, separators and all — `"17,600"` and `"3000"` are different evidence. */
  label: z.string().min(1),
  statedMm: positive,
  measuredPt: positive,
  /** Denominator of the implied scale: 100.03 means the geometry is drawn at 1 : 100.03. */
  impliedScale: positive,
  role: z.enum(DIMENSION_ROLES),
  /** The two measure points, in pixels of the rasterised page — where an engineer would click. */
  from: pixel,
  to: pixel,
});

export const verificationPageSchema = z.strictObject({
  widthPt: positive,
  heightPt: positive,
  /** The size the page actually is. Null when it matches no ISO sheet within tolerance. */
  sheetSize: z.string().nullable(),
  /** The size the title block claims, as a person read it. Null when the block is silent. */
  claimedSheetSize: z.string().nullable(),
  /** What the importer will rasterise this page at, and the pixel size it will produce. */
  renderDpi: positive,
  pixelWidth: z.number().int().positive(),
  pixelHeight: z.number().int().positive(),
});

export const verificationCalibrationSchema = z.strictObject({
  method: z.literal('two-point'),
  /** The dimension label the two points were taken from. */
  fromDimension: z.string().min(1),
  pointA: pixel,
  pointB: pixel,
  knownDistanceMm: positive,
  millimetresPerPixel: positive,
});

/**
 * The printed scale, run as a **secondary** check and never as the source.
 *
 * Owner decision, Q-4 and restated for Hospital_044: dimension-line calibration is primary, printed
 * scale is a cross-check only. Recording both and their difference is what turns "the drawing says
 * 1/100" from a claim into a measurement of how true that claim is for this file.
 */
export const verificationCrossCheckSchema = z.strictObject({
  statedRatio: z.string().min(1),
  millimetresPerPixel: positive,
  /** Signed fraction: +0.000267 means the calibrated scale is 0.0267 % larger than the printed one. */
  deviationFraction: finite,
  agrees: z.boolean(),
});

/**
 * A printed dimension put back through the finished mapping.
 *
 * The step that makes the calibration a *verification* rather than an assertion. One dimension sets
 * the scale; every other printed dimension is then a value the mapping has to reproduce without
 * having been shown it. A mapping that reproduces six of them to a few parts in ten thousand has
 * been tested, and one that reproduces only the dimension it was built from has not been.
 */
export const mappingCheckSchema = z.strictObject({
  label: z.string().min(1),
  statedMm: positive,
  /** What the mapping says the distance between the same two measure points is. */
  mappedMm: positive,
  deviationFraction: finite,
});

/**
 * What kind of thing a discrepancy *is*.
 *
 * > Owner decision, validation programme: *"Every discrepancy must be classified as one of: drawing
 * > error, extraction error, algorithm defect, unsupported drawing, insufficient evidence."*
 *
 * The classification decides who acts, and they are five different people. Sorting them by code
 * alone would not: `VD-2`, a calibrated scale that disagrees with the printed one, is a drawing
 * error when the sheet was replotted at a different size and an extraction error when this reader
 * paired a label with the wrong line — the same symptom, opposite owners.
 */
export const DISCREPANCY_CLASSES = [
  /** The drawing contradicts itself, or contradicts a document it cites. Ours to report, not fix. */
  'drawing_error',
  /** We read the drawing wrongly. The drawing is fine; the reader is not. */
  'extraction_error',
  /** The drawing was read correctly and one of our engines then got it wrong. */
  'algorithm_defect',
  /** A drawing of a kind this product cannot process at all — a scan, a photograph, a DWG. */
  'unsupported_drawing',
  /** The drawing simply does not carry what was needed. Nobody is at fault and nothing is broken. */
  'insufficient_evidence',
] as const;
export type DiscrepancyClass = (typeof DISCREPANCY_CLASSES)[number];

export const VERIFICATION_DISCREPANCY_CODES = [
  /** A printed dimension's label does not match the geometry beneath it. */
  'VD-1',
  /** The calibrated scale and the printed scale disagree beyond tolerance. */
  'VD-2',
  /** The title block claims a paper size the file is not. */
  'VD-3',
  /** A value the pipeline needed is not printed anywhere on the drawing. */
  'VD-4',
  /** The pipeline produced something the drawing contradicts. */
  'VD-5',
  /** The file is of a kind this product does not read at all. */
  'VD-6',
  /** The drawing does not carry something a later stage needed. */
  'VD-7',
] as const;
export type VerificationDiscrepancyCode = (typeof VERIFICATION_DISCREPANCY_CODES)[number];

export const verificationDiscrepancySchema = z.strictObject({
  code: z.enum(VERIFICATION_DISCREPANCY_CODES),
  /**
   * Which of the five kinds this is — see {@link DISCREPANCY_CLASSES}.
   *
   * Recorded per discrepancy rather than per code, because one code can be more than one kind and
   * only the run that found it knows which.
   */
  classification: z.enum(DISCREPANCY_CLASSES),
  /** What it is about — a dimension label, a field name, a stage of the pipeline. */
  subject: z.string().min(1),
  detail: z.string().min(1),
  /**
   * Whether anything was changed in response.
   *
   * `false` on every entry is the expected state, and the owner's instruction is the reason: a
   * discrepancy is reported before it is fixed, so a record written by the run that found it has
   * not fixed anything yet.
   */
  resolved: z.boolean(),
});

/** What the pipeline did once the level was calibrated. */
export const verificationPipelineSchema = z.strictObject({
  room: z.strictObject({
    /** Along the hall, millimetres. */
    lengthMm: positive,
    /** Wall face to wall face, millimetres. */
    widthMm: positive,
    /** How each of the two came to be known — a printed dimension, or a calibrated measurement. */
    lengthSource: z.string().min(1),
    widthSource: z.string().min(1),
    /**
     * How a person confirmed this rectangle is the room, and not something else on the sheet.
     *
     * Required, and it cannot be produced automatically — that is the whole point of it. No drawing
     * in the corpus states its treatment room's extent, and nothing in the pipeline can derive it:
     * the length is the sheet's longest printed dimension and the width is the outermost wall pair
     * on a cross-section, and on five sheets in six one or both of those is a dimension of the
     * building rather than the room.
     *
     * So the run measures and a person accepts. Until room understanding exists, a validation that
     * reached the engines without anyone confirming what it was measuring would be arithmetic on a
     * rectangle nobody chose.
     */
    corroboration: z.string().min(1),
  }),
  placements: z.array(
    z.strictObject({
      equipmentObjectId: z.string().min(1),
      count: z.number().int().nonnegative(),
      /** The footprint actually used for placement, millimetres. */
      footprint: z.strictObject({ width: positive, depth: positive }),
    }),
  ),
  evaluation: z.strictObject({
    red: z.number().int().nonnegative(),
    yellow: z.number().int().nonnegative(),
    green: z.number().int().nonnegative(),
    /** Every distinct reason code the run produced, sorted, so a change of behaviour is visible. */
    reasonCodes: z.array(z.string().min(1)),
  }),
  optimiser: z
    .strictObject({
      proposals: z.number().int().nonnegative(),
      resolvedCount: z.number().int().nonnegative(),
      emptyReason: z.string().nullable(),
    })
    .nullable(),
  installationPlan: z
    .strictObject({
      stages: z.number().int().nonnegative(),
      blockers: z.number().int().nonnegative(),
    })
    .nullable(),
  report: z
    .strictObject({
      reportVersion: z.number().int().positive(),
      overallVerdict: z.string().min(1),
      pdfBytes: z.number().int().positive(),
    })
    .nullable(),
});

export const drawingVerificationSchema = z.strictObject({
  version: z.literal(VERIFICATION_VERSION),
  /** `Hospital_044/dialysis.pdf` — the same id `knowledge/dataset.json` catalogues it under. */
  drawingId: z.string().min(1),
  /** Ties every figure below to the bytes they were taken from, not to a filename. */
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  verifiedAt: z.string().min(1),
  observer: observerSchema,
  page: verificationPageSchema,
  dimensions: z.array(verifiedDimensionSchema).min(1),
  calibration: verificationCalibrationSchema,
  crossCheck: verificationCrossCheckSchema.nullable(),
  mappingChecks: z.array(mappingCheckSchema),
  discrepancies: z.array(verificationDiscrepancySchema),
  pipeline: verificationPipelineSchema,
});

export type VerifiedDimension = z.infer<typeof verifiedDimensionSchema>;
export type MappingCheck = z.infer<typeof mappingCheckSchema>;
export type VerificationDiscrepancy = z.infer<typeof verificationDiscrepancySchema>;
export type DrawingVerification = z.infer<typeof drawingVerificationSchema>;

export class VerificationParseError extends Error {
  override readonly name = 'VerificationParseError';
  constructor(
    readonly fileName: string,
    readonly issues: string,
  ) {
    super(`${fileName}: ${issues}`);
  }
}

export function parseDrawingVerification(raw: unknown, fileName: string): DrawingVerification {
  const result = drawingVerificationSchema.safeParse(raw);
  if (!result.success) {
    throw new VerificationParseError(
      fileName,
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
    );
  }
  return result.data;
}

/**
 * Exactly one dimension may be the primary, and it must be the longest consistent one.
 *
 * Both halves matter. Two primaries would mean two scales; a primary that is not the longest means
 * somebody calibrated from a short dimension when a long one was available, and a short dimension
 * multiplies the click error by the ratio of the two lengths. On this drawing that is the
 * difference between calibrating on 499 pt and on 57 pt — a factor of nine in every measurement
 * taken afterwards.
 */
export function primaryDimensionIsSound(verification: DrawingVerification): boolean {
  const primaries = verification.dimensions.filter((entry) => entry.role === 'primary');
  const primary = primaries[0];
  if (primaries.length !== 1 || !primary) return false;

  const longestConsistent = verification.dimensions
    .filter((entry) => entry.role !== 'inconsistent')
    .reduce((best, next) => (next.measuredPt > best.measuredPt ? next : best), primary);

  return longestConsistent.label === primary.label;
}

// ---------------------------------------------------------------------------
// The corpus ledger
// ---------------------------------------------------------------------------

/**
 * Every drawing in the corpus, and how far the validation programme carried it.
 *
 * > Owner decision, validation programme: *"Continue validating against the real drawing corpus. For
 * > every drawing: …"* — and **for every drawing** is the part this exists for. A programme that
 * recorded only the drawings that worked would report a corpus of six and call it coverage.
 *
 * So a row is written for all three hundred, whether they reached the report or stopped at import,
 * and every stop names its stage and carries a classified discrepancy. The interesting number is not
 * how many completed; it is which of the five classes the rest fall into, because that says whether
 * the next engineering effort belongs in the reader, in the engines, or in asking for better
 * drawings.
 *
 * Derived data only — an identifier, a hash and an outcome per drawing. No drawing content.
 */
export const CORPUS_VALIDATION_VERSION = 1;

export const corpusRowSchema = z.strictObject({
  drawingId: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  page: z.number().int().nonnegative(),
  /** The last stage that completed. */
  reached: z.string().min(1),
  /** Where it stopped, or null when the whole programme ran. */
  stoppedAt: z.string().min(1).nullable(),
  discrepancies: z.array(
    z.strictObject({
      code: z.enum(VERIFICATION_DISCREPANCY_CODES),
      classification: z.enum(DISCREPANCY_CLASSES),
      subject: z.string().min(1),
    }),
  ),
});

const countSchema = z.strictObject({ key: z.string().min(1), count: z.number().int().nonnegative() });

export const corpusValidationSchema = z.strictObject({
  version: z.literal(CORPUS_VALIDATION_VERSION),
  datasetId: z.string().min(1),
  validatedAt: z.string().min(1),
  observer: observerSchema,
  totals: z.strictObject({
    drawings: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    stopped: z.number().int().nonnegative(),
    /** Where runs stopped, most common first. Sums to `stopped`. */
    byStage: z.array(countSchema),
    /** What kind the discrepancies were. One run can contribute more than one. */
    byClassification: z.array(countSchema),
  }),
  drawings: z.array(corpusRowSchema).min(1),
});

export type CorpusRow = z.infer<typeof corpusRowSchema>;
export type CorpusValidation = z.infer<typeof corpusValidationSchema>;

export function parseCorpusValidation(raw: unknown, fileName: string): CorpusValidation {
  const result = corpusValidationSchema.safeParse(raw);
  if (!result.success) {
    throw new VerificationParseError(
      fileName,
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
    );
  }
  return result.data;
}
