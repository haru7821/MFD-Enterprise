import { z } from 'zod';

/**
 * Where a piece of knowledge came from.
 *
 * > Owner decision: *"Treat this repository as a long-term engineering dataset, not as project
 * > source code … Extract reusable engineering knowledge rather than hard-coded layouts."*
 *
 * ## The distinction this whole package is built on
 *
 * **Observed practice is not a requirement.**
 *
 * `standards/` holds what a design *must* satisfy — thresholds with a document, a revision and a
 * section behind them, which the rule engine compares against and which decide RED and GREEN. This
 * package holds what real dialysis units *did*: the pitch a hospital actually used, the way a
 * particular RO room was laid out, how often a drain ran in the floor rather than overhead.
 *
 * Those are different kinds of fact and must never merge. Fifteen hospitals spacing their stations
 * at 1,800 mm does not make 1,800 mm a requirement — it may be what the equipment of the day needed,
 * or what the rooms happened to allow, or fifteen copies of one firm's template. Treated as a
 * requirement it would become a rule nobody wrote, cited to nothing, deciding whether a layout is
 * compliant. That is the failure this product exists to prevent, arriving through a side door.
 *
 * So the knowledge base is **descriptive and advisory**. The solver may take a starting pitch, a
 * candidate arrangement or a default allowance from it. The rule engine never reads it, no finding
 * is ever derived from it, and no compliance verdict can rest on it. Hard compliance stays a filter
 * on the rule set (AD-17); knowledge can only ever be a preference among layouts that already pass.
 *
 * ## What may be recorded
 *
 * {@link OBSERVATION_METHODS} is the enforcement. Every method on the list is a way of reading a
 * number that is actually *on* the drawing or measurable against a known scale. There is no
 * `estimate`, no `approximate`, no `visual` — because the moment one exists, a knowledge base
 * assembled under deadline fills with numbers somebody eyeballed off an uncalibrated PDF, and
 * nothing downstream can tell those from the ones read off a dimension line.
 *
 * If a drawing does not state it and it cannot be measured against a known scale, it is not
 * recorded. The gap is the honest answer, and `knowledgeFor` returns nothing rather than a guess.
 */

/**
 * How a figure was read off a drawing.
 *
 * Ordered by strength, and that order is used: {@link strongestMethod} picks the best evidence
 * behind an aggregated entry so a reader can see whether a range rests on printed dimensions or on
 * measurements someone took against a calibrated scale.
 *
 * | Method | What it means |
 * | --- | --- |
 * | `dimension_line` | A printed dimension on the drawing. The drawing states the number. |
 * | `schedule_table` | A room schedule, equipment schedule or legend on the sheet. |
 * | `annotation` | A written note — "RO ROOM", "1:100", "FFL +150". |
 * | `calibrated_measurement` | Measured on a drawing whose scale was established first. |
 *
 * `calibrated_measurement` is last because it inherits every uncertainty of the calibration. It is
 * still admissible: a plan calibrated from a dimension line and then measured is doing arithmetic
 * on a stated number. Measuring an **uncalibrated** drawing is not on this list and never will be —
 * that is pixels wearing a millimetre label.
 */
export const OBSERVATION_METHODS = [
  'dimension_line',
  'schedule_table',
  'annotation',
  'calibrated_measurement',
] as const;

export type ObservationMethod = (typeof OBSERVATION_METHODS)[number];

const METHOD_STRENGTH: Readonly<Record<ObservationMethod, number>> = {
  dimension_line: 4,
  schedule_table: 3,
  annotation: 2,
  calibrated_measurement: 1,
};

/** The strongest method among some observations, or null for none. */
export function strongestMethod(
  methods: readonly ObservationMethod[],
): ObservationMethod | null {
  let best: ObservationMethod | null = null;
  for (const method of methods) {
    if (best === null || METHOD_STRENGTH[method] > METHOD_STRENGTH[best]) best = method;
  }
  return best;
}

/**
 * One drawing in the dataset.
 *
 * The dataset is a **separate repository**, by the owner's decision, and it is referenced rather
 * than vendored: a large collection of hospital drawings does not belong in an application's source
 * tree, and copying sheets here would fork them from the set an engineer maintains.
 *
 * `sha256` is what makes an observation checkable. A drawing can be revised, and an observation
 * recorded against revision A is not evidence about revision B — so the hash of the bytes that were
 * actually read is part of the record. Nullable because it may be unknown for a sheet catalogued
 * before hashing was routine, and a nullable hash is better than a fabricated one.
 */
export const drawingRefSchema = z.strictObject({
  /** Which dataset this drawing belongs to, matching `dataset.json`. */
  datasetId: z.string().min(1),
  /** Stable id within the dataset. Survives a file being moved or renamed. */
  drawingId: z.string().min(1),
  /** Path within the dataset repository, for a human who wants to open it. */
  path: z.string().min(1),
  /** Sheet identifier printed on the drawing, e.g. "A-201". Null when the sheet is unnumbered. */
  sheet: z.string().min(1).nullable(),
  /** Revision printed on the drawing. A plan is true *at a revision*, like a clearance. */
  revision: z.string().min(1).nullable(),
  /** SHA-256 of the file's bytes, so an observation is tied to what was actually read. */
  sha256: z.string().regex(/^[a-f0-9]{64}$/, 'must be a lowercase hex SHA-256').nullable(),
});

export type DrawingRef = z.infer<typeof drawingRefSchema>;

/**
 * Who read it, from which drawing, and how.
 *
 * `observedBy` is a person. Not a model, not a tool, not "automatic" — the owner's instruction is
 * *"Do not start AI inference yet"*, and a named human is what makes an observation answerable. When
 * automated extraction arrives it will produce observations through this same shape and will have
 * to say what it is; that is a later decision, and the field is here so it cannot be skipped.
 */
export const observationSourceSchema = z.strictObject({
  drawing: drawingRefSchema,
  method: z.enum(OBSERVATION_METHODS),
  /** The engineer who read the drawing. */
  observedBy: z.string().min(1),
  /** ISO date. Supplied, never taken from a clock — this package reads none (AD-3). */
  observedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date (YYYY-MM-DD)'),
  /** Anything a later reader needs in order to trust or discount this reading. */
  note: z.string().min(1).nullable(),
});

export type ObservationSource = z.infer<typeof observationSourceSchema>;

/**
 * How much a piece of derived knowledge rests on.
 *
 * A range with no support count is a number pretending to be a pattern. This is carried on every
 * derived entry and printed wherever one is shown, because *"observed in 1 drawing"* and *"observed
 * in 14 drawings"* are different claims and an engineer choosing a starting pitch needs to know
 * which they are looking at.
 *
 * `drawings` counts **distinct drawings**, not observations: ten dimensions read off one sheet is
 * one drawing's practice recorded ten times, and counting it as ten would turn a single hospital's
 * template into a consensus.
 */
export const supportSchema = z.strictObject({
  /** Distinct drawings behind this entry. */
  drawings: z.number().int().positive(),
  /** Individual readings, which may exceed `drawings`. */
  observations: z.number().int().positive(),
  /** The best evidence behind it. */
  strongestMethod: z.enum(OBSERVATION_METHODS),
  /** Every drawing, so a reader can go and look. */
  sources: z.array(drawingRefSchema).min(1),
});

export type Support = z.infer<typeof supportSchema>;

/**
 * Below this many distinct drawings, an entry is a single site's choice rather than a pattern.
 *
 * Not a filter — nothing is discarded, because one real hospital's RO room is still worth having in
 * front of an engineer. It is a **label**: {@link isPattern} decides whether an entry may be
 * described as observed practice or must be shown as an individual case. The solver uses it to
 * decide whether an entry is fit to seed a default.
 *
 * Three, because two drawings agreeing is as likely to be one firm reusing a template as it is to
 * be a convention. This is a judgement, it is written down here rather than scattered, and it is a
 * decision the owner may overrule with a number rather than an argument.
 */
export const PATTERN_SUPPORT_THRESHOLD = 3;

export function isPattern(support: Support): boolean {
  return support.drawings >= PATTERN_SUPPORT_THRESHOLD;
}
