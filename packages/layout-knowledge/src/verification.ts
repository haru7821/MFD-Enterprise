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

/** A person's act, on either kind of confirmation. */
const signatureSchema = z.strictObject({
  name: z.string().min(1),
  at: z.string().min(1),
  /** What they confirmed against — a record, a drawing, a conversation. */
  basis: z.string().min(1),
});

export const corpusRowSchema = z.strictObject({
  drawingId: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  page: z.number().int().nonnegative(),
  /** The last stage that completed. */
  reached: z.string().min(1),
  /** Where it stopped, or null when every batch stage ran. **Not the same as completed** — see below. */
  stoppedAt: z.string().min(1).nullable(),
  /**
   * Who confirmed the run, and when. Null until a person has.
   *
   * > Owner decision D7: *"The programme is complete only after a human-confirmed run. Batch
   * > execution alone is not completion."*
   *
   * The ledger could not express that before: `stoppedAt === null` meant "the batch reached the
   * end", and `totals.completed` counted exactly those, so a machine finishing its own stages was
   * recorded as the programme being complete. The `room` stage in particular asks whether the
   * region found is the dialysis room, which no batch can answer for itself.
   *
   * A row is complete when it ran to the end **and** carries this.
   */
  confirmedBy: signatureSchema.nullable(),
  /**
   * Who accepted that this run stopped where it should have — **owner decision D12**. Null until
   * somebody has.
   *
   * A different act from {@link confirmedBy} and counted separately, never summed with it. The
   * corpus's actual output today *is* its classification of 306 stops — 211 unsupported drawings,
   * 81 with insufficient evidence — and that is a machine's claim until a person has checked one.
   * D7 is untouched: this never joins `completed` or `batchComplete`, and is never presented as
   * progress towards completion.
   */
  stopConfirmedBy: signatureSchema.nullable(),
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
    /**
     * Runs that reached the end of the batch **and** were confirmed by a person — owner decision D7.
     *
     * Kept distinct from `batchComplete` deliberately. Collapsing the two is what let
     * `HOSPITAL_044_VERIFICATION.md` state that two drawings "complete all nine stages" while this
     * ledger said `completed: 0`.
     */
    completed: z.number().int().nonnegative(),
    /** Runs where every batch stage ran, confirmed or not. `completed` is a subset of this. */
    batchComplete: z.number().int().nonnegative(),
    stopped: z.number().int().nonnegative(),
    /**
     * Stops a person has accepted as correctly diagnosed — **owner decision D12**.
     *
     * Its own number, beside `stopped` rather than inside `completed`. D12's hard constraint is
     * that it is never summed with either completion count nor presented as progress towards one:
     * a correctly diagnosed failure to read a drawing is not a step towards reading it.
     */
    stopsConfirmed: z.number().int().nonnegative(),
    /** Where runs stopped, most common first. Sums to `stopped`. */
    byStage: z.array(countSchema),
    /** What kind the discrepancies were. One run can contribute more than one. */
    byClassification: z.array(countSchema),
  }),
  drawings: z.array(corpusRowSchema).min(1),
})
  .refine(
    (ledger) =>
      ledger.totals.batchComplete === ledger.drawings.filter((row) => row.stoppedAt === null).length,
    { message: '`totals.batchComplete` must equal the rows that ran every batch stage' },
  )
  .refine(
    (ledger) =>
      ledger.totals.completed ===
      ledger.drawings.filter((row) => row.stoppedAt === null && row.confirmedBy !== null).length,
    {
      /*
       * > Owner decision D7: *"The programme is complete only after a human-confirmed run. Batch
       * > execution alone is not completion."*
       *
       * Held in the contract rather than in the script that writes the ledger, and the difference
       * matters: `validate-corpus.ts` parses back what it has just written, so a builder that counts
       * completion any other way fails on its own output instead of shipping a number.
       *
       * That placement was chosen after the obvious one failed. With the count in the builder alone,
       * reverting it to `stoppedAt === null` was invisible — no row in the corpus reaches the end of
       * the batch, so both rules return 0 and no test over real data can tell them apart.
       */
      message:
        '`totals.completed` must equal the rows that ran every stage AND carry a confirmation ' +
        '(owner decision D7: batch execution alone is not completion)',
    },
  )
  .refine(
    (ledger) =>
      ledger.totals.stopsConfirmed ===
      ledger.drawings.filter((row) => row.stopConfirmedBy !== null).length,
    {
      // Owner decision D12. Re-derived from the rows like every other total, so a count cannot be
      // stated beside rows that do not support it.
      message: '`totals.stopsConfirmed` must equal the rows carrying a stop confirmation',
    },
  )
  .refine(
    (ledger) =>
      ledger.drawings.every((row) => row.stopConfirmedBy === null || row.stoppedAt !== null),
    {
      /*
       * The mirror of the invariant below — owner decision D12. A stop confirmation on a run that
       * did not stop is as meaningless as a completion confirmation on one that did.
       */
      message:
        'a row may not carry `stopConfirmedBy` unless it stopped — a stop confirmation accepts a ' +
        'stop, and there is none to accept',
    },
  )
  .refine(
    (ledger) => ledger.drawings.every((row) => row.stoppedAt !== null || row.reached === 'report'),
    {
      /*
       * A run that stopped nowhere reached the last stage. Definitional, and it lived as a loop in
       * `verification.test.ts` over a set the corpus leaves empty — so mutating the assertion inside
       * it left the suite green. Declaring the set empty made that visible but did not make the
       * property hold; only stating it where every ledger must satisfy it does.
       */
      message: '`stoppedAt: null` means the run reached the end, so `reached` must be `report`',
    },
  )
  .refine(
    (ledger) => ledger.drawings.every((row) => row.confirmedBy === null || row.stoppedAt === null),
    {
      /*
       * The converse of D7, and the ledger could express its negation until review pointed it out.
       * `confirmedBy` on a row that stopped at `import` parsed happily — a signature against a run
       * that did not happen. It was asserted in a test, over an empty set, and enforced nowhere.
       *
       * Not merely tidiness: with this state representable, `completed` and "rows carrying a
       * confirmation" are two different counts, and the test file was already using both as though
       * they were one.
       */
      message:
        'a row may not carry `confirmedBy` unless it ran every batch stage (`stoppedAt: null`) — ' +
        'a confirmation is given for a run that finished, not for one that stopped',
    },
  );

export type CorpusRow = z.infer<typeof corpusRowSchema>;
export type CorpusValidation = z.infer<typeof corpusValidationSchema>;

// ---------------------------------------------------------------------------
// Confirmations — owner decisions D9 and D10
// ---------------------------------------------------------------------------

/**
 * The signatures, kept in a file **no batch writes**.
 *
 * > Owner decision D9: *"A separate `knowledge/validation/confirmations.json`, keyed and merged in
 * > by the builder. Only that makes survival structural rather than procedural."*
 *
 * D7 gave a row a `confirmedBy` field and stopped there, and review found what that was worth:
 * nothing in the tree ever wrote a non-null one. `validate-corpus.ts` rebuilt every row from the
 * dataset with `confirmedBy: null` hardcoded and overwrote the ledger, so a signature — the one
 * datum in this artefact that cannot be regenerated — would have been destroyed by the next run,
 * silently, and `totals.completed` was structurally pinned at 0. The schema stated a rule the
 * product could not obey.
 *
 * The split is the fix. `corpus.json` is generated and may be deleted and rebuilt at any time; this
 * file is written by people and read by the builder, never the reverse.
 */
export const CONFIRMATIONS_VERSION = 1;

const rowOutcomeShape = {
  drawingId: z.string().min(1),
  page: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  reached: z.string().min(1),
  stoppedAt: z.string().min(1).nullable(),
  discrepancies: z.array(
    z.strictObject({
      code: z.enum(VERIFICATION_DISCREPANCY_CODES),
      classification: z.enum(DISCREPANCY_CLASSES),
      subject: z.string().min(1),
    }),
  ),
};

/**
 * What a person signed, written out in full rather than as a hash.
 *
 * The outcome fields are here because of **owner decision D10** — a confirmation binds to the run it
 * was given for, not to the drawing. Writing them out rather than storing an opaque fingerprint is
 * deliberate: a signer has to state what they confirmed, and a reader can see it without running
 * anything.
 */
export const confirmationSchema = z
  .strictObject({
    ...rowOutcomeShape,
    /**
     * Which act this is — **owner decision D12**.
     *
     * > *"Confirming that a stop was correctly diagnosed is a different act from confirming a
     * > completed run, and would say so."*
     *
     * `completion` accepts a run that reached the end. `stop` accepts that a run stopped where it
     * should have — *"yes, this sheet genuinely carries no dimension set a scale can be established
     * from"*. They are counted separately and **never summed**: `completed` keeps exactly D7's
     * meaning, and a stop confirmation is never presented as progress towards it.
     *
     * The discriminator is stated by the signer rather than inferred from the row, so signing the
     * wrong kind is a rejection rather than a silent reclassification.
     */
    kind: z.enum(['completion', 'stop']),
    name: z.string().min(1),
    at: z.string().min(1),
    /** What they confirmed against — a record, a drawing, a conversation. */
    basis: z.string().min(1),
  })
  .refine((entry) => (entry.kind === 'completion') === (entry.stoppedAt === null), {
    /*
     * The mirror invariants, D12's hard constraint, enforced **here** rather than on the ledger.
     *
     * Review found the failure this fixes: a confirmation naming a stopped run made the *ledger*
     * fail to parse, so `pnpm validate:corpus` aborted with `knowledge/validation/corpus.json: a
     * row may not carry confirmedBy…` — blaming the generated file for a fault in the
     * hand-authored one, and naming no row. A file people edit has to fail on its own terms.
     */
    message:
      'a `completion` confirmation requires `stoppedAt: null` and a `stop` confirmation requires ' +
      'a stage in `stoppedAt` — owner decision D12: the two are separate acts',
  });

export const confirmationsSchema = z.strictObject({
  version: z.literal(CONFIRMATIONS_VERSION),
  confirmations: z.array(confirmationSchema),
});

export type Confirmation = z.infer<typeof confirmationSchema>;
export type Confirmations = z.infer<typeof confirmationsSchema>;

export function parseConfirmations(raw: unknown, fileName: string): Confirmations {
  const result = confirmationsSchema.safeParse(raw);
  if (!result.success) {
    throw new VerificationParseError(
      fileName,
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
    );
  }
  return result.data;
}

/** Everything a confirmation is bound to — {@link rowFingerprint}'s input, and a row satisfies it. */
export type RowOutcome = {
  readonly [K in keyof typeof rowOutcomeShape]: z.infer<(typeof rowOutcomeShape)[K]>;
};

/**
 * What a confirmation is bound to — **owner decision D10**.
 *
 * > *"A confirmation binds to `drawingId`, `page`, `sha256` **and** the row's outcome (`reached`,
 * > `stoppedAt`, `discrepancies`). If any differs, it does not apply and the row is unconfirmed."*
 *
 * The outcome is in the key, not just the drawing, and that is the whole decision. Binding to the
 * hash alone would keep a signature alive across a change in what the pipeline *made* of those same
 * bytes — and this corpus has already done exactly that, `byStage.room` moving 8 → 15 under review
 * without a single row's identity changing. "Confirmed" has to mean something about the run being
 * reported, not about a run that once existed.
 *
 * A confirmation whose subject has moved is **not deleted**. It stays in the file, unmatched: a
 * person's act is evidence, and it simply stops asserting anything.
 */
export function rowFingerprint(outcome: RowOutcome): string {
  /*
   * **`JSON.stringify`, not a delimiter.** Two defects in one line, both found by review.
   *
   * The first version joined the parts with `|` and `~` and escaped neither, and one of the
   * subjects this receives is `the harness threw: ${cause.message}` — arbitrary text. Measured
   * collision: a single discrepancy whose subject reads `a~VD-7|insufficient_evidence|b` produces
   * exactly the string two separate discrepancies with subjects `a` and `b` produce. Under D10 a
   * collision means a signature applying to a run it was not given for, which is the one thing the
   * binding exists to prevent. Latent rather than live — no subject in today's corpus contains
   * either character — but the harness message is unbounded, so it is one thrown error away.
   *
   * The second was the repair: joining with a NUL byte made it the only tracked text file
   * containing one, and `git grep` and `rg` skip a file they think is binary. The whole module went
   * invisible to search to fix a problem that was really about structure.
   *
   * `JSON.stringify` over the parts as an array is unambiguous for these types by construction —
   * it escapes what it must and the nesting carries the field boundaries — so there is no separator
   * to collide with and nothing unprintable in the file.
   */
  return JSON.stringify([
    outcome.drawingId,
    outcome.page,
    outcome.sha256,
    outcome.reached,
    outcome.stoppedAt,
    outcome.discrepancies
      .map((entry) => [entry.code, entry.classification, entry.subject])
      .sort((a, b) => (a.join() < b.join() ? -1 : 1)),
  ]);
}

/**
 * The signature for a row, or null — the merge D9 asks the builder to perform.
 *
 * Exported and used by `scripts/lib/corpusLedger.ts` rather than reimplemented there, so the rule
 * that decides whether a confirmation applies exists once. A test asserting its own copy of this
 * would pass while the builder used a different rule, which is a failure this project has shipped.
 */
export function confirmationsMatching(
  row: RowOutcome,
  confirmations: readonly Confirmation[],
  kind: Confirmation['kind'],
): Confirmation[] {
  const key = rowFingerprint(row);
  return confirmations
    .filter((entry) => entry.kind === kind && rowFingerprint(entry) === key)
    .sort((a, b) => a.at.localeCompare(b.at) || a.name.localeCompare(b.name));
}

/**
 * The signature that applies to a row, or null — the merge D9 asks the builder to perform.
 *
 * > **Owner decision D11**: *"the row takes the earliest matching confirmation by (`at`, `name`) —
 * > a deterministic order, so a re-run produces the same bytes — and every further confirmation on
 * > the same fingerprint is reported by the run as a duplicate."*
 *
 * This was `.find()`, which took whichever entry happened to come first in the file and dropped the
 * rest without counting or reporting them. Review measured it: two signatures on one row, and the
 * second vanished — the one datum D9 exists to protect, disappearing silently. Ordering by (`at`,
 * `name`) rather than by file position also means the ledger's bytes do not depend on how somebody
 * chose to append to the JSON.
 *
 * Exported and used by `scripts/lib/corpusLedger.ts` rather than reimplemented there, so the rule
 * that decides whether a confirmation applies exists once. A test asserting its own copy of this
 * would pass while the builder used a different rule, which is a failure this project has shipped.
 */
export function confirmationFor(
  row: RowOutcome,
  confirmations: readonly Confirmation[],
  kind: Confirmation['kind'] = 'completion',
): CorpusRow['confirmedBy'] {
  const match = confirmationsMatching(row, confirmations, kind)[0];
  return match ? { name: match.name, at: match.at, basis: match.basis } : null;
}

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
